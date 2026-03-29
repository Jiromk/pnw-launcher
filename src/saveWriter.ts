/**
 * saveWriter.ts — Fonctions pour modifier une save PSDK et sérialiser un Pokémon pour le GTS.
 *
 * IMPORTANT : La re-sérialisation via `dump()` de @hyrious/marshal corrompt les saves
 * car elle perd les hash entries avec clés non-primitives et reconstruit la table de références.
 *
 * Solution : on utilise le **patching binaire chirurgical** — on modifie directement les bytes
 * bruts de la save pour remplacer un slot par `nil` (0x30), sans toucher au reste.
 *
 * Workflow dépôt GTS :
 *  1. Charger la save brute (bytes) avec loadSaveForEdit()
 *  2. Extraire le Pokémon de la boîte avec extractPokemonFromBox() (lecture seule)
 *  3. Sérialiser le Pokémon pour le GTS avec encodePokemonForGts()
 *  4. Patcher les bytes bruts pour remplacer le slot par nil via patchSlotToNil()
 *  5. Écrire les bytes patchés via cmd_write_save_blob (backup automatique)
 */
import { load, dump } from "@hyrious/marshal";
import { zlibSync, gunzipSync, unzlibSync } from "fflate";

type AnyObj = Record<string | symbol, unknown>;

const k2s = (k: string | symbol) =>
  typeof k === "symbol" ? String(k).slice(7, -1) : String(k);

function getIvar(obj: unknown, names: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of Reflect.ownKeys(obj as object)) {
    const n = k2s(k as string | symbol);
    if (names.includes(n)) return (obj as AnyObj)[k as keyof typeof obj];
  }
  return undefined;
}

/* ---------- Décompression / localisation Marshal ---------- */

function maybeDecompress(buf: Uint8Array): Uint8Array {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return gunzipSync(buf); } catch { /* ignore */ }
  }
  if (buf.length >= 2 && buf[0] === 0x78) {
    try { return unzlibSync(buf); } catch { /* ignore */ }
  }
  return buf;
}

function findMarshalOffset(bytes: Uint8Array): number {
  const lim = Math.min(bytes.length - 1, 512);
  for (let off = 0; off < lim; off++) {
    if (bytes[off] === 0x04 && bytes[off + 1] === 0x08) return off;
  }
  return 0;
}

/* =====================================================================
 *  Marshal binary scanner — parcourt les bytes bruts Marshal sans
 *  modifier quoi que ce soit, et retourne les offsets (start, end)
 *  de chaque élément dans un tableau.
 * ===================================================================== */

/** Lit un entier "packed" Marshal (format w_long de Ruby). */
function readMarshalInt(buf: Uint8Array, pos: number): [value: number, newPos: number] {
  const b = buf[pos];
  if (b === 0) return [0, pos + 1];
  const signed = b > 127 ? b - 256 : b;
  if (signed > 0 && signed <= 4) {
    // 1..4 bytes, little-endian positive
    const n = signed;
    let val = 0;
    for (let i = 0; i < n; i++) val |= buf[pos + 1 + i] << (8 * i);
    return [val, pos + 1 + n];
  }
  if (signed < 0 && signed >= -4) {
    // 1..4 bytes, little-endian negative
    const n = -signed;
    let val = -1; // start with all 1s
    for (let i = 0; i < n; i++) {
      val &= ~(0xff << (8 * i));
      val |= buf[pos + 1 + i] << (8 * i);
    }
    return [val, pos + 1 + n];
  }
  // Small integer shortcut: value = signed - (signed > 0 ? 5 : -5) ?
  // Actually: if 5 <= b <= 127 -> value = b - 5; if -128 <= signed <= -5 -> value = signed + 5
  if (signed > 4) return [signed - 5, pos + 1];
  return [signed + 5, pos + 1];
}

/**
 * Saute un objet Marshal complet dans les bytes bruts, en retournant la position après l'objet.
 * On ne parse pas la valeur, on saute juste les bytes.
 */
function skipMarshalObject(buf: Uint8Array, pos: number, depth = 0): number {
  if (depth > 200) throw new Error("Marshal: profondeur max dépassée");
  if (pos >= buf.length) throw new Error("Marshal: fin inattendue");

  const type = buf[pos];
  pos++;

  switch (type) {
    case 0x30: // '0' — nil
    case 0x54: // 'T' — true
    case 0x46: // 'F' — false
      return pos;

    case 0x69: { // 'i' — integer
      const [, np] = readMarshalInt(buf, pos);
      return np;
    }

    case 0x6c: { // 'l' — bignum (référençable)
      _objCount++;
      pos++; // sign byte (+/-)
      const [wordCount, np] = readMarshalInt(buf, pos);
      return np + wordCount * 2;
    }

    case 0x66: { // 'f' — float (référençable)
      _objCount++;
      const [len, np] = readMarshalInt(buf, pos);
      return np + len;
    }

    case 0x22: // '"' — string (référençable)
    case 0x2f: { // '/' — regexp (référençable)
      _objCount++;
      const [len, np] = readMarshalInt(buf, pos);
      let p = np + len;
      if (type === 0x2f) p++; // regexp flags byte
      return p;
    }

    case 0x3a: { // ':' — symbol
      const [len, np] = readMarshalInt(buf, pos);
      // Register in symbol table for symlink resolution
      const symName = new TextDecoder().decode(buf.slice(np, np + len));
      registerSymbol(symName);
      return np + len;
    }

    case 0x3b: { // ';' — symbol link
      const [, np] = readMarshalInt(buf, pos);
      return np;
    }

    case 0x40: { // '@' — object link
      const [, np] = readMarshalInt(buf, pos);
      return np;
    }

    case 0x5b: { // '[' — array (référençable)
      _objCount++;
      const [count, np] = readMarshalInt(buf, pos);
      let p = np;
      for (let i = 0; i < count; i++) p = skipMarshalObject(buf, p, depth + 1);
      return p;
    }

    case 0x7b: { // '{' — hash (référençable)
      _objCount++;
      const [count, np] = readMarshalInt(buf, pos);
      let p = np;
      for (let i = 0; i < count; i++) {
        p = skipMarshalObject(buf, p, depth + 1); // key
        p = skipMarshalObject(buf, p, depth + 1); // value
      }
      return p;
    }

    case 0x7d: { // '}' — hash with default (référençable)
      _objCount++;
      const [count, np] = readMarshalInt(buf, pos);
      let p = np;
      for (let i = 0; i < count; i++) {
        p = skipMarshalObject(buf, p, depth + 1); // key
        p = skipMarshalObject(buf, p, depth + 1); // value
      }
      p = skipMarshalObject(buf, p, depth + 1); // default value
      return p;
    }

    case 0x6f: { // 'o' — object (référençable)
      _objCount++;
      pos = skipMarshalObject(buf, pos, depth + 1); // class name (symbol or symlink)
      const [ivarCount, np] = readMarshalInt(buf, pos);
      let p = np;
      for (let i = 0; i < ivarCount; i++) {
        p = skipMarshalObject(buf, p, depth + 1); // ivar name
        p = skipMarshalObject(buf, p, depth + 1); // ivar value
      }
      return p;
    }

    case 0x49: { // 'I' — instance variables wrapper (e.g. String with encoding)
      let p = skipMarshalObject(buf, pos, depth + 1); // inner object
      const [ivarCount, np2] = readMarshalInt(buf, p);
      p = np2;
      for (let i = 0; i < ivarCount; i++) {
        p = skipMarshalObject(buf, p, depth + 1); // ivar name
        p = skipMarshalObject(buf, p, depth + 1); // ivar value
      }
      return p;
    }

    case 0x43: { // 'C' — user class (subclass of core type)
      pos = skipMarshalObject(buf, pos, depth + 1); // class name
      return skipMarshalObject(buf, pos, depth + 1); // wrapped object
    }

    case 0x65: { // 'e' — extended (module included)
      pos = skipMarshalObject(buf, pos, depth + 1); // module name
      return skipMarshalObject(buf, pos, depth + 1); // wrapped object
    }

    case 0x75: { // 'u' — user marshal (référençable)
      _objCount++;
      pos = skipMarshalObject(buf, pos, depth + 1); // class name
      const [len, np] = readMarshalInt(buf, pos);
      return np + len;
    }

    case 0x55: { // 'U' — user marshal via marshal_load (référençable)
      _objCount++;
      pos = skipMarshalObject(buf, pos, depth + 1); // class name
      return skipMarshalObject(buf, pos, depth + 1); // data object
    }

    case 0x64: { // 'd' — Data (référençable)
      _objCount++;
      pos = skipMarshalObject(buf, pos, depth + 1); // class name
      return skipMarshalObject(buf, pos, depth + 1); // data
    }

    case 0x53: { // 'S' — Struct (référençable)
      _objCount++;
      pos = skipMarshalObject(buf, pos, depth + 1); // struct name
      const [memberCount, np] = readMarshalInt(buf, pos);
      let p = np;
      for (let i = 0; i < memberCount; i++) {
        p = skipMarshalObject(buf, p, depth + 1); // member name
        p = skipMarshalObject(buf, p, depth + 1); // member value
      }
      return p;
    }

    case 0x4d: { // 'M' — module/class old format (référençable)
      _objCount++;
      const [len, np] = readMarshalInt(buf, pos);
      return np + len;
    }

    case 0x63: // 'c' — class ref (référençable)
    case 0x6d: { // 'm' — module ref (référençable)
      _objCount++;
      const [len, np] = readMarshalInt(buf, pos);
      return np + len;
    }

    default:
      throw new Error(`Marshal: type inconnu 0x${type.toString(16)} à l'offset ${pos - 1}`);
  }
}

/**
 * Trouve les offsets de début et fin d'un élément dans un tableau Marshal.
 * Chemin : root → @storage → @boxes → [boxIndex] → @content → [slotIndex]
 *
 * Retourne [startOffset, endOffset] dans les bytes bruts (relatif au début du buffer).
 */
function findSlotOffsets(
  buf: Uint8Array,
  marshalStart: number,
  boxIndex: number,
  slotIndex: number,
): [number, number] {
  // Reset symbol table for fresh scan
  resetSymbolTable();

  // Skip Marshal header (0x04 0x08)
  let pos = marshalStart + 2;

  // Navigate to @storage, then @boxes, then content[slot]
  pos = navigateToIvar(buf, pos, "@storage");
  pos = navigateToIvar(buf, pos, "@boxes");

  // @boxes is an array — skip to element [boxIndex]
  if (buf[pos] !== 0x5b) throw new Error(`Expected array for @boxes, got 0x${buf[pos].toString(16)}`);
  pos++;
  const [boxCount, boxArrayPos] = readMarshalInt(buf, pos);
  pos = boxArrayPos;
  if (boxIndex >= boxCount) throw new Error(`Box index ${boxIndex} hors limites (${boxCount} boîtes)`);
  for (let i = 0; i < boxIndex; i++) pos = skipMarshalObject(buf, pos);

  // Now at boxes[boxIndex] — navigate to @content
  pos = navigateToIvar(buf, pos, "@content");

  // @content is an array — skip to element [slotIndex]
  if (buf[pos] !== 0x5b) throw new Error(`Expected array for @content, got 0x${buf[pos].toString(16)}`);
  pos++;
  const [slotCount, slotArrayPos] = readMarshalInt(buf, pos);
  pos = slotArrayPos;
  if (slotIndex >= slotCount) throw new Error(`Slot index ${slotIndex} hors limites (${slotCount} slots)`);
  for (let i = 0; i < slotIndex; i++) pos = skipMarshalObject(buf, pos);

  // pos = start of the slot object
  const slotStart = pos;
  const slotEnd = skipMarshalObject(buf, pos);
  return [slotStart, slotEnd];
}

/**
 * Table de symboles globale pour résoudre les symlinks Marshal.
 * Reconstruite à chaque appel de findSlotOffsets / findFirstEmptySlot.
 */
let _symTable: string[] = [];
let _objCount = 0; // compteur d'objets référençables (pour @N, 1-based dans Marshal)

/** Enregistre un nouveau symbole dans la table (appel lors du parsing). */
function registerSymbol(name: string): void {
  _symTable.push(name);
}

/** Résout un symlink (index → nom). */
function resolveSymlink(index: number): string | null {
  return index < _symTable.length ? _symTable[index] : null;
}

/** Reset complet des compteurs avant un scan. */
function resetCounters(): void {
  _symTable = [];
  _objCount = 0;
}

/** @deprecated Alias pour resetCounters */
function resetSymbolTable(): void {
  resetCounters();
}

/**
 * Lit un symbole ou symlink à `pos` et retourne [nom, nouvelle_pos].
 * Met à jour la table de symboles si c'est un nouveau symbole.
 */
function readSymbolAt(buf: Uint8Array, pos: number): [string, number] {
  const type = buf[pos];
  if (type === 0x3a) {
    // Symbol: ':' + length + bytes
    pos++;
    const [len, np] = readMarshalInt(buf, pos);
    const name = new TextDecoder().decode(buf.slice(np, np + len));
    registerSymbol(name);
    return [name, np + len];
  } else if (type === 0x3b) {
    // Symlink: ';' + index
    pos++;
    const [idx, np] = readMarshalInt(buf, pos);
    const name = resolveSymlink(idx);
    if (name === null) {
      return [`__unknown_sym_${idx}`, np];
    }
    return [name, np];
  }
  throw new Error(`Expected symbol (:) or symlink (;), got 0x${type.toString(16)} at offset ${pos}`);
}

/**
 * Dans un objet Marshal (type 'o'), cherche un ivar par nom et retourne la position
 * juste après le nom de l'ivar (= début de la valeur).
 * Gère les symlinks grâce à la table de symboles globale.
 */
function navigateToIvar(buf: Uint8Array, pos: number, ivarName: string): number {
  const type = buf[pos];

  // Handle wrapped types: 'I' (instance vars on string/etc)
  if (type === 0x49) {
    pos++;
    return navigateToIvar(buf, pos, ivarName);
  }

  if (type !== 0x6f) {
    throw new Error(`Expected object 'o' (0x6f), got 0x${type.toString(16)} at offset ${pos}`);
  }
  pos++; // skip 'o'

  // Read class name (symbol or symlink) — registers in table
  const [_className, classEnd] = readSymbolAt(buf, pos);
  pos = classEnd;

  // Read ivar count
  const [ivarCount, ivarPos] = readMarshalInt(buf, pos);
  pos = ivarPos;

  for (let i = 0; i < ivarCount; i++) {
    // Read ivar name (symbol or symlink)
    const [name, nameEnd] = readSymbolAt(buf, pos);
    pos = nameEnd;

    if (name === ivarName) {
      // pos is at the start of the value
      return pos;
    }

    // Skip the value
    pos = skipMarshalObject(buf, pos);
  }

  throw new Error(`Ivar "${ivarName}" introuvable dans l'objet`);
}

/* ---------- Marshal int writer ---------- */

/** Encode un entier au format w_long de Ruby Marshal. */
function writeMarshalInt(value: number): Uint8Array {
  if (value === 0) return new Uint8Array([0]);
  if (value > 0 && value < 123) return new Uint8Array([value + 5]);
  if (value < 0 && value > -124) return new Uint8Array([(value - 5) & 0xff]);

  // Multi-byte encoding
  const bytes: number[] = [];
  if (value > 0) {
    let v = value;
    while (v > 0) { bytes.push(v & 0xff); v >>>= 8; }
    return new Uint8Array([bytes.length, ...bytes]);
  } else {
    let v = value;
    const n = value >= -0x80 ? 1 : value >= -0x8000 ? 2 : value >= -0x800000 ? 3 : 4;
    for (let i = 0; i < n; i++) { bytes.push(v & 0xff); v >>= 8; }
    return new Uint8Array([(-n) & 0xff, ...bytes]);
  }
}

/* ---------- Comptage d'entités Marshal dans une plage de bytes ---------- */

interface MarshalEntityCounts {
  symDefs: number;  // Nombre de ':' symbol definitions
  objDefs: number;  // Nombre d'objets référençables (entrées dans la table @)
}

/**
 * Compte les définitions de symboles (:) et les objets référençables dans un
 * objet Marshal unique commençant à `pos`. Utilise un comptage isolé (ne modifie
 * pas _symTable/_objCount globaux).
 */
function countMarshalEntities(buf: Uint8Array, pos: number): MarshalEntityCounts {
  const counts: MarshalEntityCounts = { symDefs: 0, objDefs: 0 };

  function walk(p: number, depth: number): number {
    if (depth > 200) throw new Error("countEntities: profondeur max");
    if (p >= buf.length) throw new Error("countEntities: fin inattendue");
    const type = buf[p]; p++;

    switch (type) {
      case 0x30: case 0x54: case 0x46: return p; // nil/true/false
      case 0x69: { const [, np] = readMarshalInt(buf, p); return np; } // int
      case 0x3a: { // symbol def
        counts.symDefs++;
        const [len, np] = readMarshalInt(buf, p);
        return np + len;
      }
      case 0x3b: { const [, np] = readMarshalInt(buf, p); return np; } // symlink
      case 0x40: { const [, np] = readMarshalInt(buf, p); return np; } // objlink

      // --- Tous les types ci-dessous sont référençables ---
      case 0x66: { counts.objDefs++; const [len, np] = readMarshalInt(buf, p); return np + len; } // float
      case 0x6c: { counts.objDefs++; p++; const [wc, np] = readMarshalInt(buf, p); return np + wc * 2; } // bignum
      case 0x22: { counts.objDefs++; const [len, np] = readMarshalInt(buf, p); return np + len; } // string
      case 0x2f: { counts.objDefs++; const [len, np] = readMarshalInt(buf, p); return np + len + 1; } // regexp

      case 0x5b: { // array
        counts.objDefs++;
        const [count, np] = readMarshalInt(buf, p); let pp = np;
        for (let i = 0; i < count; i++) pp = walk(pp, depth + 1);
        return pp;
      }
      case 0x7b: { // hash
        counts.objDefs++;
        const [count, np] = readMarshalInt(buf, p); let pp = np;
        for (let i = 0; i < count; i++) { pp = walk(pp, depth + 1); pp = walk(pp, depth + 1); }
        return pp;
      }
      case 0x7d: { // hash with default
        counts.objDefs++;
        const [count, np] = readMarshalInt(buf, p); let pp = np;
        for (let i = 0; i < count; i++) { pp = walk(pp, depth + 1); pp = walk(pp, depth + 1); }
        return walk(pp, depth + 1); // default
      }
      case 0x6f: { // object
        counts.objDefs++;
        let pp = walk(p, depth + 1); // class name
        const [ic, np] = readMarshalInt(buf, pp); pp = np;
        for (let i = 0; i < ic; i++) { pp = walk(pp, depth + 1); pp = walk(pp, depth + 1); }
        return pp;
      }
      case 0x49: { // I — wrapper, inner gets counted, not wrapper
        let pp = walk(p, depth + 1); // inner object (will count itself)
        const [ic, np] = readMarshalInt(buf, pp); pp = np;
        for (let i = 0; i < ic; i++) { pp = walk(pp, depth + 1); pp = walk(pp, depth + 1); }
        return pp;
      }
      case 0x43: { // C — user class wrapper, inner gets counted
        let pp = walk(p, depth + 1); // class name
        return walk(pp, depth + 1); // inner
      }
      case 0x65: { // e — extended wrapper, inner gets counted
        let pp = walk(p, depth + 1);
        return walk(pp, depth + 1);
      }
      case 0x75: { // u — user marshal
        counts.objDefs++;
        let pp = walk(p, depth + 1); // class name
        const [len, np] = readMarshalInt(buf, pp);
        return np + len;
      }
      case 0x55: { // U — user marshal via marshal_load
        counts.objDefs++;
        let pp = walk(p, depth + 1);
        return walk(pp, depth + 1);
      }
      case 0x64: { // d — Data
        counts.objDefs++;
        let pp = walk(p, depth + 1);
        return walk(pp, depth + 1);
      }
      case 0x53: { // S — Struct
        counts.objDefs++;
        let pp = walk(p, depth + 1); // name
        const [mc, np] = readMarshalInt(buf, pp); pp = np;
        for (let i = 0; i < mc; i++) { pp = walk(pp, depth + 1); pp = walk(pp, depth + 1); }
        return pp;
      }
      case 0x4d: { counts.objDefs++; const [len, np] = readMarshalInt(buf, p); return np + len; }
      case 0x63: case 0x6d: { counts.objDefs++; const [len, np] = readMarshalInt(buf, p); return np + len; }
      default:
        throw new Error(`countEntities: type inconnu 0x${type.toString(16)} à ${p - 1}`);
    }
  }

  walk(pos, 0);
  return counts;
}

/* ---------- Ajustement des références ;N et @N après splice ---------- */

/**
 * Parcourt des bytes Marshal (fragment de stream) et ajuste les indices :
 *   - ';N' (symlink) : si N >= symThreshold → N += symDelta
 *   - '@N' (objlink) : si N > objThreshold → N += objDelta  (@ est 1-based)
 *
 * Retourne les bytes réécrits. Les longueurs des entiers packés peuvent changer,
 * donc on ne fait pas de modification in-place.
 */
function adjustMarshalRefs(
  input: Uint8Array,
  symThreshold: number,
  symDelta: number,
  objThreshold: number,
  objDelta: number,
): Uint8Array {
  if (symDelta === 0 && objDelta === 0) return input; // rien à faire

  const chunks: Uint8Array[] = [];
  function emit(data: Uint8Array | number[]) {
    chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  function walk(pos: number, depth: number): number {
    if (depth > 200) throw new Error("adjustRefs: profondeur max");
    if (pos >= input.length) return pos; // fin du fragment
    const type = input[pos];

    switch (type) {
      case 0x30: case 0x54: case 0x46: emit([type]); return pos + 1;

      case 0x69: { // int — copie verbatim
        emit([0x69]);
        const [, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        return np;
      }

      case 0x3a: { // symbol def — copie verbatim
        emit([0x3a]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      case 0x3b: { // symlink — AJUSTER
        const [idx, np] = readMarshalInt(input, pos + 1);
        const newIdx = idx >= symThreshold ? idx + symDelta : idx;
        emit([0x3b]);
        emit(writeMarshalInt(newIdx));
        return np;
      }

      case 0x40: { // objlink — AJUSTER (1-based)
        const [idx, np] = readMarshalInt(input, pos + 1);
        const newIdx = idx > objThreshold ? idx + objDelta : idx;
        emit([0x40]);
        emit(writeMarshalInt(newIdx));
        return np;
      }

      case 0x66: { // float
        emit([0x66]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      case 0x6c: { // bignum
        emit([0x6c, input[pos + 1]]); // type + sign
        const [wc, np] = readMarshalInt(input, pos + 2);
        emit(input.slice(pos + 2, np));
        emit(input.slice(np, np + wc * 2));
        return np + wc * 2;
      }

      case 0x22: { // string
        emit([0x22]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      case 0x2f: { // regexp
        emit([0x2f]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len + 1));
        return np + len + 1;
      }

      case 0x5b: { // array
        emit([0x5b]);
        const [count, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        let p = np;
        for (let i = 0; i < count; i++) p = walk(p, depth + 1);
        return p;
      }

      case 0x7b: case 0x7d: { // hash / hash with default
        emit([type]);
        const [count, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        let p = np;
        for (let i = 0; i < count; i++) { p = walk(p, depth + 1); p = walk(p, depth + 1); }
        if (type === 0x7d) p = walk(p, depth + 1);
        return p;
      }

      case 0x6f: { // object
        emit([0x6f]);
        let p = walk(pos + 1, depth + 1); // class name
        const [ic, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < ic; i++) { p = walk(p, depth + 1); p = walk(p, depth + 1); }
        return p;
      }

      case 0x49: { // I — instance variables wrapper
        emit([0x49]);
        let p = walk(pos + 1, depth + 1);
        const [ic, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < ic; i++) { p = walk(p, depth + 1); p = walk(p, depth + 1); }
        return p;
      }

      case 0x43: { // C — user class
        emit([0x43]);
        let p = walk(pos + 1, depth + 1);
        return walk(p, depth + 1);
      }

      case 0x65: { // e — extended
        emit([0x65]);
        let p = walk(pos + 1, depth + 1);
        return walk(p, depth + 1);
      }

      case 0x75: { // u — user marshal
        emit([0x75]);
        let p = walk(pos + 1, depth + 1); // class name
        const [len, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      case 0x55: { // U — user marshal via marshal_load
        emit([0x55]);
        let p = walk(pos + 1, depth + 1);
        return walk(p, depth + 1);
      }

      case 0x64: { // d — Data
        emit([0x64]);
        let p = walk(pos + 1, depth + 1);
        return walk(p, depth + 1);
      }

      case 0x53: { // S — Struct
        emit([0x53]);
        let p = walk(pos + 1, depth + 1);
        const [mc, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < mc; i++) { p = walk(p, depth + 1); p = walk(p, depth + 1); }
        return p;
      }

      case 0x4d: case 0x63: case 0x6d: {
        emit([type]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      default:
        throw new Error(`adjustRefs: type inconnu 0x${type.toString(16)} à ${pos}`);
    }
  }

  // Le fragment `after` est une séquence d'objets Marshal (éléments de tableau,
  // ivars, etc.) — on les parcourt un par un.
  let pos = 0;
  while (pos < input.length) {
    pos = walk(pos, 0);
  }

  // Concaténer les chunks
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

/* ---------- Compression de symboles Marshal ---------- */

/**
 * Parcourt des bytes Marshal et réécrit les symboles pour matcher une table cible.
 *
 * Les symboles (:name) déjà présents dans targetSymTable sont convertis en
 * symlinks (;N). Les nouveaux symboles sont gardés comme :name et ajoutés à la table.
 *
 * Cela permet d'insérer des bytes self-contained dans un stream Marshal existant
 * sans décaler la table de symboles (= zéro corruption).
 */
function compressSymbolsInBytes(
  input: Uint8Array,
  targetSymTable: string[],
): Uint8Array {
  const localTable: string[] = []; // table interne des bytes d'entrée
  const chunks: Uint8Array[] = [];

  function emit(data: Uint8Array | number[]) {
    chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  /** Encode un symbole pour la sortie : symlink si déjà dans targetSymTable, sinon :name */
  function emitSymbol(name: string): void {
    const targetIdx = targetSymTable.indexOf(name);
    if (targetIdx >= 0) {
      // Symlink vers la table de la save
      emit([0x3b]); // ';'
      emit(writeMarshalInt(targetIdx));
    } else {
      // Nouveau symbole — garder comme :name et l'ajouter à targetSymTable
      const nameBytes = new TextEncoder().encode(name);
      emit([0x3a]); // ':'
      emit(writeMarshalInt(nameBytes.length));
      emit(nameBytes);
      targetSymTable.push(name);
    }
  }

  function walk(pos: number, depth: number): number {
    if (depth > 200) throw new Error("compressSymbols: profondeur max");
    if (pos >= input.length) throw new Error("compressSymbols: fin inattendue");

    const type = input[pos];

    switch (type) {
      case 0x30: // nil
      case 0x54: // true
      case 0x46: // false
        emit([type]);
        return pos + 1;

      case 0x69: { // integer
        emit([0x69]);
        const [, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np)); // copy the int encoding as-is
        return np;
      }

      case 0x6c: { // bignum
        emit([0x6c]);
        const signByte = input[pos + 1];
        emit([signByte]);
        const [wordCount, np] = readMarshalInt(input, pos + 2);
        emit(input.slice(pos + 2, np)); // count encoding
        emit(input.slice(np, np + wordCount * 2)); // data words
        return np + wordCount * 2;
      }

      case 0x66: { // float
        emit([0x66]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np)); // length encoding
        emit(input.slice(np, np + len)); // float string
        return np + len;
      }

      case 0x22: { // string
        emit([0x22]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np)); // length encoding
        emit(input.slice(np, np + len)); // string data
        return np + len;
      }

      case 0x2f: { // regexp
        emit([0x2f]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len + 1)); // data + flags byte
        return np + len + 1;
      }

      case 0x3a: { // symbol — register locally + compress for output
        const [len, np] = readMarshalInt(input, pos + 1);
        const name = new TextDecoder().decode(input.slice(np, np + len));
        localTable.push(name);
        emitSymbol(name);
        return np + len;
      }

      case 0x3b: { // symlink — resolve from local table, compress for output
        const [idx, np] = readMarshalInt(input, pos + 1);
        const name = idx < localTable.length ? localTable[idx] : `__unknown_${idx}`;
        emitSymbol(name);
        return np;
      }

      case 0x40: { // object link — copy as-is
        emit([0x40]);
        const [, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        return np;
      }

      case 0x5b: { // array
        emit([0x5b]);
        const [count, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        let p = np;
        for (let i = 0; i < count; i++) p = walk(p, depth + 1);
        return p;
      }

      case 0x7b: { // hash
        emit([0x7b]);
        const [count, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        let p = np;
        for (let i = 0; i < count; i++) {
          p = walk(p, depth + 1); // key
          p = walk(p, depth + 1); // value
        }
        return p;
      }

      case 0x7d: { // hash with default
        emit([0x7d]);
        const [count, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        let p = np;
        for (let i = 0; i < count; i++) {
          p = walk(p, depth + 1);
          p = walk(p, depth + 1);
        }
        p = walk(p, depth + 1); // default
        return p;
      }

      case 0x6f: { // object
        emit([0x6f]);
        let p = walk(pos + 1, depth + 1); // class name (symbol/symlink)
        const [ivarCount, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < ivarCount; i++) {
          p = walk(p, depth + 1); // ivar name
          p = walk(p, depth + 1); // ivar value
        }
        return p;
      }

      case 0x49: { // instance variables wrapper
        emit([0x49]);
        let p = walk(pos + 1, depth + 1); // inner object
        const [ivarCount, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < ivarCount; i++) {
          p = walk(p, depth + 1); // ivar name
          p = walk(p, depth + 1); // ivar value
        }
        return p;
      }

      case 0x43: { // user class
        emit([0x43]);
        let p = walk(pos + 1, depth + 1); // class name
        p = walk(p, depth + 1); // wrapped object
        return p;
      }

      case 0x65: { // extended
        emit([0x65]);
        let p = walk(pos + 1, depth + 1); // module name
        p = walk(p, depth + 1); // wrapped object
        return p;
      }

      case 0x75: { // user marshal
        emit([0x75]);
        let p = walk(pos + 1, depth + 1); // class name
        const [len, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      case 0x55: { // user marshal via marshal_load
        emit([0x55]);
        let p = walk(pos + 1, depth + 1); // class name
        p = walk(p, depth + 1); // data object
        return p;
      }

      case 0x64: { // Data
        emit([0x64]);
        let p = walk(pos + 1, depth + 1); // class name
        p = walk(p, depth + 1); // data
        return p;
      }

      case 0x53: { // Struct
        emit([0x53]);
        let p = walk(pos + 1, depth + 1); // struct name
        const [memberCount, np] = readMarshalInt(input, p);
        emit(input.slice(p, np));
        p = np;
        for (let i = 0; i < memberCount; i++) {
          p = walk(p, depth + 1); // member name
          p = walk(p, depth + 1); // member value
        }
        return p;
      }

      case 0x4d: // module/class old format
      case 0x63: // class ref
      case 0x6d: { // module ref
        emit([type]);
        const [len, np] = readMarshalInt(input, pos + 1);
        emit(input.slice(pos + 1, np));
        emit(input.slice(np, np + len));
        return np + len;
      }

      default:
        throw new Error(`compressSymbols: type Marshal inconnu 0x${type.toString(16)} à l'offset ${pos}`);
    }
  }

  walk(0, 0);

  // Concatenate all chunks
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Insère un Pokémon dans un slot nil de la save, avec réécriture des symboles
 * pour matcher la table de la save au point d'insertion.
 *
 * selfContainedBytes = bytes Marshal SANS header 0x04 0x08, avec tous les
 * symboles en tant que définitions complètes (:name). Typiquement produits par
 * dump().slice(2) ou décodés d'un blob GTS.
 */
export function insertPokemonIntoSave(
  rawBytes: Uint8Array,
  marshalOffset: number,
  boxIndex: number,
  slotIndex: number,
  selfContainedBytes: Uint8Array,
): Uint8Array {
  // Approche : patching binaire chirurgical avec ajustement des références.
  //
  //  1. Scanner les bytes bruts pour trouver le slot nil (0x30)
  //  2. Collecter la table de symboles/objets de la save jusqu'au point d'insertion
  //  3. Re-dump le blob Pokémon seul (petit objet isolé → dump() fiable)
  //  4. Réécrire les symboles du blob pour matcher la table de la save
  //  5. Compter les NOUVELLES entités ajoutées par le blob
  //  6. Ajuster les références dans la partie 'after'
  //  7. Splice binaire

  // 1. Trouver le slot nil (peuple _symTable et _objCount)
  const [slotStart, slotEnd] = findSlotOffsets(rawBytes, marshalOffset, boxIndex, slotIndex);

  if (rawBytes[slotStart] !== 0x30) {
    throw new Error(
      `Le slot [${boxIndex}][${slotIndex}] n'est pas nil (type 0x${rawBytes[slotStart].toString(16)}). ` +
      `Impossible d'insérer un Pokémon dans un slot occupé.`
    );
  }

  // 2. Sauvegarder les compteurs AVANT l'insertion
  const symBefore = _symTable.length;
  const objBefore = _objCount;
  const saveSymTable = [..._symTable];

  console.info(
    `[SaveWriter] insertPokemonIntoSave: slot [${boxIndex}][${slotIndex}] ` +
    `à l'offset ${slotStart} (nil). ` +
    `Table avant: ${symBefore} sym, ${objBefore} obj.`
  );

  // 3. Re-dump le blob Pokémon seul pour obtenir des bytes propres.
  const fullBlob = new Uint8Array(2 + selfContainedBytes.length);
  fullBlob[0] = 0x04; fullBlob[1] = 0x08;
  fullBlob.set(selfContainedBytes, 2);
  const pokemon = load(fullBlob);
  const redumped: Uint8Array = dump(pokemon);
  const redumpedBody = redumped.slice(2);

  // 4. Réécrire les symboles pour matcher la table de la save.
  //    compressSymbolsInBytes ajoute les nouveaux symboles à saveSymTable.
  const compressed = compressSymbolsInBytes(redumpedBody, saveSymTable);

  // 5. Compter les NOUVELLES entités ajoutées
  const addedSyms = saveSymTable.length - symBefore;
  const compressedCounts = countMarshalEntities(compressed, 0);
  const addedObjs = compressedCounts.objDefs;

  console.info(
    `[SaveWriter] Blob compressé: ${compressed.length} bytes. ` +
    `Ajout de ${addedSyms} symboles, ${addedObjs} objets.`
  );

  // 6. Ajuster les références dans 'after' pour compenser les entités ajoutées
  const before = rawBytes.slice(0, slotStart);
  const rawAfter = rawBytes.slice(slotStart + 1); // sauter le 0x30 (nil)
  const adjustedAfter = adjustMarshalRefs(
    rawAfter,
    symBefore,     // ';N' où N >= symBefore pointe vers des symboles après le slot
    addedSyms,     // décaler vers le haut (insertion)
    objBefore,     // '@N' où N > objBefore pointe vers des objets après le slot
    addedObjs,     // décaler vers le haut (insertion)
  );

  // 7. Splice binaire
  const newBytes = new Uint8Array(before.length + compressed.length + adjustedAfter.length);
  newBytes.set(before, 0);
  newBytes.set(compressed, before.length);
  newBytes.set(adjustedAfter, before.length + compressed.length);

  console.info(
    `[SaveWriter] Save patchée: ${rawBytes.length} → ${newBytes.length} bytes ` +
    `(+${newBytes.length - rawBytes.length} bytes)`
  );

  return newBytes;
}

/**
 * Décode un blob GTS (Base64 → Zlib → Marshal bytes SANS header 0x04 0x08).
 * Les bytes retournés sont self-contained (tous les symboles sont des définitions complètes).
 */
export function decodePokemonFromGts(b64: string): Uint8Array {
  const compressed = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const marshalBytes = unzlibSync(compressed);
  // Strip le header Marshal standalone (0x04 0x08)
  if (marshalBytes.length >= 2 && marshalBytes[0] === 0x04 && marshalBytes[1] === 0x08) {
    return marshalBytes.slice(2);
  }
  return marshalBytes;
}

/* ---------- API publique ---------- */

export interface SaveEditContext {
  /** Objet Marshal racine (lecture seule — pour extraire des données). */
  root: unknown;
  /** Bytes bruts de la save (pas modifiés). */
  rawBytes: Uint8Array;
  /** Offset du header Marshal dans les bytes bruts. */
  marshalOffset: number;
}

/** Charge une save brute pour édition. */
export function loadSaveForEdit(raw: Uint8Array): SaveEditContext {
  const offset = findMarshalOffset(raw);
  const marshalBytes = raw.slice(offset);
  const root = load(marshalBytes);
  return {
    root,
    rawBytes: raw,
    marshalOffset: offset,
  };
}

/** Navigue vers le Pokémon dans storage → boxes[boxIdx] → content[slotIdx] (lecture seule). */
export function extractPokemonFromBox(
  root: unknown,
  boxIndex: number,
  slotIndex: number,
): unknown {
  const storage = getIvar(root, ["@storage"]) ?? bfs(root, "@storage");
  if (!storage) throw new Error("@storage introuvable dans la save");
  const boxes = getIvar(storage, ["@boxes"]);
  if (!Array.isArray(boxes)) throw new Error("@boxes n'est pas un tableau");
  const box = boxes[boxIndex];
  if (!box) throw new Error(`Boîte ${boxIndex} introuvable`);
  const content = getIvar(box, ["@content"]);
  if (!Array.isArray(content)) throw new Error("@content n'est pas un tableau");
  const pokemon = content[slotIndex];
  if (!pokemon || typeof pokemon !== "object") {
    throw new Error(`Slot ${slotIndex} vide dans la boîte ${boxIndex}`);
  }
  return pokemon;
}

/** Encode un Pokémon pour l'API GTS : Marshal.dump → Zlib.deflate → Base64. */
export function encodePokemonForGts(pokemon: unknown): string {
  const marshalBytes = dump(pokemon);
  const compressed = zlibSync(marshalBytes);
  return btoa(String.fromCharCode(...compressed));
}

/**
 * Patche les bytes bruts de la save pour remplacer un slot par nil.
 * Ne touche à RIEN d'autre dans le fichier — 100% chirurgical.
 *
 * Retourne les nouveaux bytes de la save.
 */
export function patchSlotToNil(
  rawBytes: Uint8Array,
  marshalOffset: number,
  boxIndex: number,
  slotIndex: number,
): Uint8Array {
  // findSlotOffsets peuple _symTable et _objCount avec les entités AVANT le slot
  const [slotStart, slotEnd] = findSlotOffsets(rawBytes, marshalOffset, boxIndex, slotIndex);
  const slotSize = slotEnd - slotStart;

  if (slotSize <= 0) throw new Error("Slot introuvable ou taille invalide");

  const symBefore = _symTable.length;
  const objBefore = _objCount;

  // Compter les entités DANS le slot qu'on va supprimer
  const slotCounts = countMarshalEntities(rawBytes, slotStart);

  console.info(
    `[SaveWriter] patchSlotToNil: offset ${slotStart}–${slotEnd} (${slotSize} bytes) → nil. ` +
    `Suppression de ${slotCounts.symDefs} symboles, ${slotCounts.objDefs} objets. ` +
    `Table avant: ${symBefore} sym, ${objBefore} obj.`
  );

  // Construire before + nil
  const before = rawBytes.slice(0, slotStart);

  // Ajuster les références dans la partie 'after' pour compenser les entités supprimées
  const rawAfter = rawBytes.slice(slotEnd);
  const adjustedAfter = adjustMarshalRefs(
    rawAfter,
    symBefore,              // ';N' où N >= symBefore+slotSyms pointe vers des symboles après le slot
    -slotCounts.symDefs,    // décaler vers le bas (suppression)
    objBefore,              // '@N' où N > objBefore+slotObjs pointe vers des objets après le slot
    -slotCounts.objDefs,    // décaler vers le bas (suppression)
  );

  const newBytes = new Uint8Array(before.length + 1 + adjustedAfter.length);
  newBytes.set(before, 0);
  newBytes[before.length] = 0x30; // Marshal nil
  newBytes.set(adjustedAfter, before.length + 1);

  console.info(`[SaveWriter] Save patchée: ${rawBytes.length} → ${newBytes.length} bytes`);

  return newBytes;
}

/**
 * Extrait les bytes bruts d'un slot de la save (pour sauvegarde avant dépôt GTS).
 * Ces bytes sont les VRAIS bytes Marshal Ruby — seuls eux peuvent être réinsérés
 * sans corrompre la save. NE PAS utiliser dump() de JS qui produit des bytes incompatibles.
 */
export function extractRawSlotBytes(
  rawBytes: Uint8Array,
  marshalOffset: number,
  boxIndex: number,
  slotIndex: number,
): Uint8Array {
  const [slotStart, slotEnd] = findSlotOffsets(rawBytes, marshalOffset, boxIndex, slotIndex);
  return rawBytes.slice(slotStart, slotEnd);
}

/**
 * Parcourt les bytes bruts de la save pour trouver le premier slot nil (0x30)
 * dans @storage → @boxes[i] → @content[j].
 *
 * Retourne { boxIndex, slotIndex } ou null si toutes les boîtes sont pleines.
 */
export function findFirstEmptySlot(
  rawBytes: Uint8Array,
  marshalOffset: number,
): { boxIndex: number; slotIndex: number } | null {
  resetSymbolTable();
  let pos = marshalOffset + 2; // skip Marshal header

  pos = navigateToIvar(rawBytes, pos, "@storage");
  pos = navigateToIvar(rawBytes, pos, "@boxes");

  if (rawBytes[pos] !== 0x5b) throw new Error(`Expected array for @boxes, got 0x${rawBytes[pos].toString(16)}`);
  pos++;
  const [boxCount, boxArrayPos] = readMarshalInt(rawBytes, pos);
  pos = boxArrayPos;

  for (let b = 0; b < boxCount; b++) {
    // On doit naviguer dans chaque boîte → @content pour checker les slots
    // Mais navigateToIvar avance dans l'objet — on doit sauvegarder la pos de fin pour passer à la boîte suivante
    const boxStart = pos;
    try {
      let cPos = navigateToIvar(rawBytes, boxStart, "@content");
      if (rawBytes[cPos] !== 0x5b) { pos = skipMarshalObject(rawBytes, boxStart); continue; }
      cPos++;
      const [slotCount, slotArrayPos] = readMarshalInt(rawBytes, cPos);
      cPos = slotArrayPos;

      for (let s = 0; s < slotCount; s++) {
        if (rawBytes[cPos] === 0x30) {
          return { boxIndex: b, slotIndex: s };
        }
        cPos = skipMarshalObject(rawBytes, cPos);
      }
    } catch {
      // Si on ne peut pas naviguer cette boîte, on la saute
    }
    // Sauter toute la boîte pour passer à la suivante
    pos = skipMarshalObject(rawBytes, boxStart);
  }

  return null;
}

/**
 * Inverse de patchSlotToNil : remplace un slot nil par les bytes Marshal d'un Pokémon.
 * Le slot ciblé DOIT être nil (0x30).
 *
 * IMPORTANT : pokemonBytes DOIT être les bytes originaux extraits via extractRawSlotBytes()
 * lors du dépôt. NE JAMAIS utiliser les bytes de dump() JS — ils corrompent la save.
 */
export function patchNilToData(
  rawBytes: Uint8Array,
  marshalOffset: number,
  boxIndex: number,
  slotIndex: number,
  pokemonBytes: Uint8Array,
): Uint8Array {
  // findSlotOffsets peuple _symTable et _objCount
  const [slotStart, slotEnd] = findSlotOffsets(rawBytes, marshalOffset, boxIndex, slotIndex);
  const slotSize = slotEnd - slotStart;

  if (slotSize !== 1 || rawBytes[slotStart] !== 0x30) {
    throw new Error(`Le slot [${boxIndex}][${slotIndex}] n'est pas nil (taille=${slotSize}, byte=0x${rawBytes[slotStart].toString(16)})`);
  }

  const symBefore = _symTable.length;
  const objBefore = _objCount;

  // Compter les entités dans les bytes du Pokémon qu'on insère
  const insertCounts = countMarshalEntities(pokemonBytes, 0);

  console.info(
    `[SaveWriter] patchNilToData: offset ${slotStart} (nil) → ${pokemonBytes.length} bytes. ` +
    `Ajout de ${insertCounts.symDefs} symboles, ${insertCounts.objDefs} objets.`
  );

  // Ajuster les références dans la partie 'after'
  const before = rawBytes.slice(0, slotStart);
  const rawAfter = rawBytes.slice(slotEnd);
  const adjustedAfter = adjustMarshalRefs(
    rawAfter,
    symBefore,
    insertCounts.symDefs,
    objBefore,
    insertCounts.objDefs,
  );

  const newBytes = new Uint8Array(before.length + pokemonBytes.length + adjustedAfter.length);
  newBytes.set(before, 0);
  newBytes.set(pokemonBytes, before.length);
  newBytes.set(adjustedAfter, before.length + pokemonBytes.length);

  return newBytes;
}

// Legacy aliases kept for compatibility (but dumpSave is NO LONGER USED for save writing)
/** @deprecated Use patchSlotToNil instead */
export function removePokemonFromBox(
  root: unknown,
  boxIndex: number,
  slotIndex: number,
): void {
  // No-op — patching is done at the binary level now
  console.warn("[SaveWriter] removePokemonFromBox est obsolète, utiliser patchSlotToNil");
}

/** @deprecated Use patchSlotToNil instead */
export function dumpSave(ctx: SaveEditContext): Uint8Array {
  throw new Error("dumpSave est obsolète et corrompt les saves. Utiliser patchSlotToNil.");
}

/** Convertit des bytes en base64 pour envoi via Tauri. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let result = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

/** Récupère l'online_id du joueur depuis la save. */
export function getOnlineId(root: unknown): number | null {
  const oid = bfs(root, "@online_id");
  if (typeof oid === "number" && oid > 0) return oid;
  if (typeof oid === "bigint") return Number(oid);
  return null;
}

/* ---------- Helper BFS ---------- */

function bfs(root: unknown, targetKey: string): unknown {
  const q = [root];
  const seen = new Set<unknown>();
  while (q.length) {
    const cur = q.shift()!;
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    for (const k of Reflect.ownKeys(cur as object)) {
      const name = k2s(k as string | symbol);
      const val = (cur as AnyObj)[k as keyof typeof cur];
      if (name === targetKey) return val;
      if (val && typeof val === "object") q.push(val);
    }
  }
  return undefined;
}
