#!/usr/bin/env node
/**
 * Inspecte la structure d'un fichier de save PNW (Ruby Marshal)
 * Usage: node scripts/inspect-save.mjs "C:\...\Saves\Pokemon_Party-4"
 */
import { readFile } from "fs/promises";
import { load } from "@hyrious/marshal";
import { gunzipSync, unzlibSync } from "fflate";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/inspect-save.mjs <chemin_fichier_save>");
  process.exit(1);
}

function maybeDecompress(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return gunzipSync(new Uint8Array(buf)); } catch {}
  }
  if (buf.length >= 2 && buf[0] === 0x78) {
    try { return unzlibSync(new Uint8Array(buf)); } catch {}
  }
  return new Uint8Array(buf);
}

function findMarshalStart(bytes) {
  const lim = Math.min(bytes.length - 1, 512);
  for (let off = 0; off < lim; off++) {
    if (bytes[off] === 0x04 && bytes[off + 1] === 0x08) return bytes.slice(off);
  }
  try {
    const d2 = unzlibSync(bytes);
    for (let off = 0; off < Math.min(d2.length - 1, 512); off++) {
      if (d2[off] === 0x04 && d2[off + 1] === 0x08) return d2.slice(off);
    }
  } catch {}
  return bytes;
}

function keyStr(k) {
  if (typeof k === "symbol") return String(k);
  return String(k);
}

function listKeys(obj, depth = 0, maxDepth = 3) {
  if (depth > maxDepth || obj == null || typeof obj !== "object") return [];
  const keys = [...Object.getOwnPropertyNames(obj), ...(Object.getOwnPropertySymbols(obj) || [])];
  const lines = [];
  for (const k of keys) {
    const v = obj[k];
    const type = Array.isArray(v) ? "Array" : v && typeof v === "object" ? "Object" : typeof v;
    const preview = type === "string" ? `"${String(v).slice(0, 40)}${String(v).length > 40 ? "…" : ""}"`
      : type === "number" ? v
      : type === "Array" ? `[${v.length}]`
      : type === "Object" ? `{…}` : String(v).slice(0, 30);
    lines.push({ key: keyStr(k), type, preview, value: v });
  }
  return lines;
}

function collectIdsOrNames(val, out, seen) {
  if (!val || seen.has(val)) return;
  seen.add(val);
  if (Array.isArray(val)) {
    for (const x of val) {
      if (typeof x === "number" && x > 0 && x < 2000) out.ids.push(x);
      if (typeof x === "string") out.names.push(x);
      if (typeof x === "symbol") out.names.push(String(x).replace(/^Symbol\(|\)$/g, ""));
    }
    return;
  }
  if (typeof val === "object" && val !== null) {
    if (typeof val.keys === "function") {
      try {
        for (const k of val.keys()) {
          if (typeof k === "number") out.ids.push(k);
          if (typeof k === "string") out.names.push(k);
        }
      } catch {}
    }
    for (const k of Object.keys(val)) {
      if (/captured|caught|owned|seen|species|creature|has_/i.test(k))
        collectIdsOrNames(val[k], out, seen);
    }
  }
}

async function main() {
  let buf;
  try {
    buf = await readFile(path);
  } catch (e) {
    console.error("Erreur lecture fichier:", e.message);
    process.exit(1);
  }
  let bytes = maybeDecompress(buf);
  bytes = findMarshalStart(bytes);
  let root;
  try {
    root = load(bytes);
  } catch (e) {
    console.error("Erreur Marshal.load:", e.message);
    process.exit(1);
  }

  const allKeys = (o) => [...Object.getOwnPropertyNames(o), ...(Object.getOwnPropertySymbols(o) || []).map(String)];

  console.log("=== RACINE ===\n");
  console.log("  Type:", Array.isArray(root) ? "Array" : typeof root);
  if (root && typeof root === "object" && !Array.isArray(root)) {
    const rk = allKeys(root);
    console.log("  Clés racine:", rk.slice(0, 30).join(", "), rk.length > 30 ? `… (${rk.length})` : "");
  }
  if (Array.isArray(root)) {
    console.log("  Longueur:", root.length);
    if (root.length) console.log("  Premier élément type:", typeof root[0], root[0] && typeof root[0] === "object" ? allKeys(root[0]).slice(0, 10) : "");
  }

  const queue = [root];
  const seen = new Set();
  let trainer = null;
  let dex = null;
  const candidates = [];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    const keys = [...Object.getOwnPropertyNames(cur), ...(Object.getOwnPropertySymbols(cur) || [])];
    if (keys.some(k => /trainer_name|player_name|@name/.test(keyStr(k))) && keys.some(k => /pokedex|party|money/.test(keyStr(k))))
      trainer = cur;
    for (const k of keys) {
      const v = cur[k];
      if (v && typeof v === "object") {
        queue.push(v);
        const vKeys = allKeys(v);
        if (vKeys.some(x => /pokedex|dex|captured|caught|seen|has_captured/.test(String(x)))) candidates.push({ name: keyStr(k), obj: v });
      }
    }
  }
  const rootKeys = [...Object.getOwnPropertyNames(root), ...(Object.getOwnPropertySymbols(root) || [])];
  for (const k of rootKeys) {
    const s = keyStr(k);
    if (/@trainer\b/.test(s)) trainer = root[k];
    if (/@pokedex\b/.test(s)) dex = root[k];
  }

  console.log("\n=== TRAINER (clés) ===\n");
  if (trainer) {
    const lines = listKeys(trainer);
    if (lines) for (const { key, type, preview } of lines) console.log(`  ${key}: ${type} ${preview}`);
  } else console.log("  (non trouvé)");

  console.log("\n=== POKEDEX (clés) ===\n");
  if (dex && typeof dex === "object") {
    const lines = listKeys(dex);
    if (lines) {
      for (const { key, type, preview, value } of lines) {
        console.log(`  ${key}: ${type} ${preview}`);
        if (/captured|caught|owned|seen|has_captured|has_seen|species|creature/.test(key) && value) {
          const out = { ids: [], names: [] };
          collectIdsOrNames(value, out, new Set());
          if (out.ids.length) console.log(`      -> ${out.ids.length} IDs: ${out.ids.slice(0, 20).join(", ")}${out.ids.length > 20 ? "…" : ""}`);
          if (out.names.length) console.log(`      -> ${out.names.length} noms: ${out.names.slice(0, 15).join(", ")}${out.names.length > 15 ? "…" : ""}`);
        }
      }
    }
  } else console.log("  (non trouvé)");

  const captured = { ids: [], names: [] };
  if (dex) {
    const walk = (o, s) => {
      if (!o || s.has(o)) return;
      s.add(o);
      if (Array.isArray(o)) {
        o.forEach(x => {
          if (typeof x === "number" && x > 0 && x < 2000) captured.ids.push(x);
          if (typeof x === "string") captured.names.push(x);
          if (typeof x === "symbol") captured.names.push(String(x).replace(/^Symbol\(|\)$/g, ""));
        });
        return;
      }
      for (const k of [...Object.keys(o), ...(Object.getOwnPropertySymbols(o) || []).map(String)]) {
        if (/has_captured|captured|caught|owned/.test(k)) walk(o[k], s);
        else if (typeof o[k] === "object" && o[k] !== null) walk(o[k], s);
      }
    };
    walk(dex, new Set());
  }

  let capturedIds = [];
  if (dex && typeof dex === "object") {
    const dexKeys = [...Object.getOwnPropertyNames(dex), ...(Object.getOwnPropertySymbols(dex) || [])];
    for (const k of dexKeys) {
      if (String(k).includes("has_captured")) {
        const arr = dex[k];
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) if (arr[i]) capturedIds.push(i + 1);
          break;
        }
      }
    }
  }
  console.log("\n=== IDs ESPÈCES CAPTURÉES (1-based) ===\n");
  if (capturedIds.length) {
    console.log(capturedIds.join(", "));
    console.log("\nTotal:", capturedIds.length);
  } else console.log("  (aucun)");

  console.log("\n=== RÉSUMÉ (extraction capturés) ===\n");
  if (captured.ids.length) console.log("  IDs espèces capturés:", [...new Set(captured.ids)].sort((a,b)=>a-b).slice(0, 50).join(", "), captured.ids.length > 50 ? `… (${captured.ids.length} total)` : "");
  if (captured.names.length) console.log("  Noms / symboles:", [...new Set(captured.names)].slice(0, 30).join(", "), captured.names.length > 30 ? `… (${captured.names.length} total)` : "");
  if (!captured.ids.length && !captured.names.length) console.log("  Aucune liste d’IDs ou noms trouvée dans le pokedex. Les clés ci‑dessus indiquent la structure réelle.");
}

main().catch((e) => { console.error(e); process.exit(1); });
