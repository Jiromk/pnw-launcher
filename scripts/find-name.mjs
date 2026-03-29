#!/usr/bin/env node
import { readFile } from "fs/promises";
import { load } from "@hyrious/marshal";
import { gunzipSync, unzlibSync } from "fflate";

const path = process.argv[2];
if (!path) { console.error("Usage: node scripts/find-name.mjs <save>"); process.exit(1); }

function maybeDecompress(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { return gunzipSync(new Uint8Array(buf)); } catch {} }
  if (buf.length >= 2 && buf[0] === 0x78) { try { return unzlibSync(new Uint8Array(buf)); } catch {} }
  return new Uint8Array(buf);
}
function findMarshalStart(bytes) {
  const lim = Math.min(bytes.length - 1, 512);
  for (let off = 0; off < lim; off++) if (bytes[off] === 0x04 && bytes[off + 1] === 0x08) return bytes.slice(off);
  try { const d2 = unzlibSync(bytes); for (let off = 0; off < Math.min(d2.length - 1, 512); off++) if (d2[off] === 0x04 && d2[off + 1] === 0x08) return d2.slice(off); } catch {}
  return bytes;
}
const TD = new TextDecoder();
function ks(k) { return typeof k === "symbol" ? String(k) : String(k); }
function val(v) {
  if (v == null) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (v instanceof Uint8Array) return `"${TD.decode(v)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "symbol") return String(v);
  if (Array.isArray(v)) return `Array[${v.length}]`;
  return `Object`;
}

async function main() {
  let buf = await readFile(path);
  let bytes = maybeDecompress(buf);
  bytes = findMarshalStart(bytes);
  const root = load(bytes);

  const allKeys = (o) => [...Object.getOwnPropertyNames(o), ...(Object.getOwnPropertySymbols(o) || [])];

  // Dump root @actors
  console.log("=== @actors ===");
  for (const k of allKeys(root)) {
    if (ks(k).includes("@actors")) {
      const actors = root[k];
      if (Array.isArray(actors)) {
        console.log("  Length:", actors.length);
        actors.forEach((a, i) => {
          if (a && typeof a === "object") {
            console.log(`  [${i}]:`);
            for (const ak of allKeys(a)) {
              const s = ks(ak);
              if (/name|trainer|@ot|@character|@player/i.test(s))
                console.log(`    ${s} = ${val(a[ak])}`);
            }
          }
        });
      }
    }
  }

  // Dump root @trainer deeper
  console.log("\n=== @trainer (all keys) ===");
  for (const k of allKeys(root)) {
    if (ks(k).includes("@trainer")) {
      const t = root[k];
      for (const tk of allKeys(t)) console.log(`  ${ks(tk)} = ${val(t[tk])}`);
    }
  }

  // Dump root @game_player
  console.log("\n=== @game_player ===");
  for (const k of allKeys(root)) {
    if (ks(k).includes("@game_player")) {
      const p = root[k];
      if (p && typeof p === "object") {
        for (const pk of allKeys(p)) {
          const s = ks(pk);
          if (/name|character/i.test(s)) console.log(`  ${s} = ${val(p[pk])}`);
        }
      }
    }
  }

  // BFS: find ALL string values that look like player names
  console.log("\n=== All @name / @trainer_name / @player_name occurrences ===");
  const queue = [{ obj: root, path: "root" }];
  const seen = new Set();
  while (queue.length) {
    const { obj, path: p } = queue.shift();
    if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
    seen.add(obj);
    for (const k of allKeys(obj)) {
      const s = ks(k);
      const v = obj[k];
      if (/^(Symbol\()?@?(trainer_name|player_name|name_boy|name_girl|name)(\))?$/.test(s)) {
        const sv = typeof v === "string" ? v : (v instanceof Uint8Array ? TD.decode(v) : null);
        if (sv !== null) console.log(`  ${p}.${s} = "${sv}"`);
      }
      if (v && typeof v === "object" && !seen.has(v)) queue.push({ obj: v, path: `${p}.${s}` });
    }
  }
}
main().catch(console.error);
