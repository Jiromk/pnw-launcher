// src/shinyDetect.ts
// Logique partagée de détection chromatique (shiny) pour PSDK / PNW.

type AnyObj = Record<string | symbol, unknown>;

const k2s = (k: string | symbol) =>
  typeof k === "symbol" ? String(k).slice(7, -1) : String(k);

const asInt = (v: unknown) =>
  typeof v === "number" ? (v | 0) : typeof v === "bigint" ? Number(v) : undefined;

export const toUInt32 = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "bigint") return Number(v & 0xffffffffn) >>> 0;
  if (typeof v === "number") return v >>> 0;
  return undefined;
};

function getIvar(obj: unknown, names: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of Reflect.ownKeys(obj as object)) {
    const n = k2s(k as string | symbol);
    if (names.includes(n)) return (obj as AnyObj)[k as keyof typeof obj];
  }
  return undefined;
}

/**
 * Formule PNW (PSDK 6413, override 08960 shiny.rb) :
 *   shiny? → (@code & 0xFFFF) < shiny_rate || @shiny
 * PNW override shiny_rate à 128 (≈ 1/512 chance).
 */
export const PNW_SHINY_RATE = 128;

export function pnwShinyFromCode(code: number, rate = PNW_SHINY_RATE): boolean {
  return (code & 0xffff) < rate;
}

/**
 * Fallback XOR (Pokémon Essentials / anciens forks PSDK).
 */
export function shinyFromPidXorTid(personalId: number, trainerId: number, threshold = 16): boolean {
  const a = (personalId >>> 0) ^ (trainerId >>> 0);
  const b = a & 0xffff;
  const c = (a >>> 16) & 0xffff;
  const d = (b ^ c) & 0xffff;
  return d < threshold;
}

/**
 * Fallback Gen 3-4 XOR.
 */
export function gen34StyleShinyFromPidAndOt(pid: number, trainerId32: number, threshold = 8): boolean {
  const tid = trainerId32 & 0xffff;
  const sid = (trainerId32 >>> 16) & 0xffff;
  const p1 = pid & 0xffff;
  const p2 = (pid >>> 16) & 0xffff;
  const v = (tid ^ sid ^ p1 ^ p2) & 0xffff;
  return v < threshold;
}

/** Dernier recours : tout ivar dont le nom contient « shiny » / « chrom » et valeur vraie. */
export function ivarTruthyShinyByName(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const k of Reflect.ownKeys(obj as object)) {
    const n = k2s(k as string | symbol).toLowerCase();
    if (!n.includes("shiny") && !n.includes("chrom")) continue;
    const v = (obj as AnyObj)[k as keyof typeof obj];
    if (v === true || v === 1 || (typeof v === "bigint" && v === 1n)) return true;
  }
  return false;
}

/**
 * Détecte si un objet Marshal Pokémon PSDK est chromatique.
 *
 * Ordre de détection :
 *  1. @shiny explicite
 *  2. @rareness / @shiny_rate PSDK (mécanisme legacy)
 *  3. Formule PNW : (@code & 0xFFFF) < 128
 *  4. Fallback XOR (compatibilité autres moteurs)
 *  5. Fallback par nom d'ivar contenant « shiny » / « chrom »
 *
 * @param root   Objet Marshal désérialisé du Pokémon
 * @param speciesId  ID interne de l'espèce (pour éviter confusion @code == speciesId)
 */
export function detectShinyFromMarshal(root: unknown, speciesId: number): boolean {
  if (!root || typeof root !== "object") return false;

  const shinyIvar = getIvar(root, ["@shiny", "@is_shiny"]);
  const superShiny = getIvar(root, ["@super_shiny"]);
  const rare = getIvar(root, ["@rareness"]);
  const shinyRate = getIvar(root, ["@shiny_rate"]);
  const rareU = toUInt32(rare);
  const rateU = toUInt32(shinyRate);

  const personalId =
    toUInt32(getIvar(root, ["@personal_id", "@personalID", "@pid", "@encryption"])) ??
    (() => {
      const code = toUInt32(getIvar(root, ["@code"]));
      if (code === undefined) return undefined;
      if (speciesId > 0 && code === (speciesId >>> 0)) return undefined;
      return code;
    })();

  let trainerForXor = asInt(getIvar(root, ["@trainer_id"])) ?? 0;
  const owner = getIvar(root, ["@owner"]);
  if (owner && typeof owner === "object") {
    const oid = asInt(getIvar(owner, ["@id", "@trainer_id", "@id_boy", "@id_girl"]));
    if (oid != null) trainerForXor = oid;
  }

  let isShiny =
    shinyIvar === true ||
    shinyIvar === 1 ||
    (typeof shinyIvar === "bigint" && shinyIvar === 1n) ||
    superShiny === true ||
    superShiny === 1;

  if (!isShiny && rareU !== undefined && rateU !== undefined) {
    if (rateU === 0) {
      /* jamais chromatique via ce mécanisme */
    } else if (rateU === 0xffff && rareU === 0xffff) {
      isShiny = true;
    } else if (rateU > 0 && rateU < 0xffff && rareU < rateU) {
      isShiny = true;
    } else if (rateU > 0 && rateU < 0xffff && rareU === rateU) {
      isShiny = true;
    }
  } else if (!isShiny && rareU !== undefined) {
    if (rareU === 0xffff) isShiny = true;
  }

  /* Formule PNW : (@code & 0xFFFF) < shiny_rate (128) */
  if (!isShiny && personalId !== undefined) {
    isShiny = pnwShinyFromCode(personalId, PNW_SHINY_RATE);
  }

  /* Fallback XOR (compatibilité autres moteurs) */
  if (!isShiny && personalId !== undefined) {
    const tid32 = trainerForXor >>> 0;
    const tid16 = trainerForXor & 0xffff;
    if (personalId !== 0 || tid32 !== 0 || tid16 !== 0) {
      isShiny =
        shinyFromPidXorTid(personalId, tid32, 16) ||
        shinyFromPidXorTid(personalId, tid16, 16) ||
        gen34StyleShinyFromPidAndOt(personalId, tid32, 8) ||
        gen34StyleShinyFromPidAndOt(personalId, tid16, 8);
    }
  }

  if (!isShiny) isShiny = ivarTruthyShinyByName(root);

  return isShiny;
}
