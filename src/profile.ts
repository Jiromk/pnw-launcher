// src/profile.ts
// Decode PSDK/Essentials save (Ruby Marshal) — version sans shiny
import { load } from "@hyrious/marshal";
import { gunzipSync, unzlibSync } from "fflate";
import type { PlayerProfile, TeamMember, PokedexInfo } from "./types";

type AnyObj = Record<string | symbol, any>;
const TD = new TextDecoder();

const asInt = (v: any) =>
  typeof v === "number" ? (v | 0) : typeof v === "bigint" ? Number(v) : undefined;
const asStr = (v: any) =>
  typeof v === "string" ? v : v instanceof Uint8Array ? TD.decode(v) : undefined;

const k2s = (k: string | symbol) => (typeof k === "symbol" ? String(k).slice(7, -1) : String(k));
const ownEntries = (o: any): Array<[string, any]> => {
  const out: Array<[string, any]> = [];
  for (const k of Reflect.ownKeys(o)) out.push([k2s(k as any), (o as AnyObj)[k as any]]);
  return out;
};
const bfs = (root: any, pred: (k: string, v: any, o: AnyObj) => boolean): any => {
  const q = [root], seen = new Set<any>();
  while (q.length) {
    const cur = q.shift()!;
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    for (const [k, v] of ownEntries(cur)) {
      if (pred(k, v, cur as AnyObj)) return v;
      if (v && typeof v === "object") q.push(v);
    }
  }
  return undefined;
};

function maybeDecompress(buf: Uint8Array): Uint8Array {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { return gunzipSync(buf); } catch {} }
  if (buf.length >= 2 && buf[0] === 0x78) { try { return unzlibSync(buf); } catch {} }
  return buf;
}
function sliceToMarshal(bytes: Uint8Array): Uint8Array {
  const lim = Math.min(bytes.length - 1, 512);
  for (let off = 0; off < lim; off++) if (bytes[off] === 0x04 && bytes[off + 1] === 0x08) return bytes.slice(off);
  try {
    const d2 = unzlibSync(bytes);
    for (let off = 0; off < Math.min(d2.length - 1, 512); off++)
      if (d2[off] === 0x04 && d2[off + 1] === 0x08) return d2.slice(off);
  } catch {}
  return bytes;
}

/* ---------- helpers ---------- */
const NAME_KEYS  = ["@trainer_name","@player_name","@name"];
const MONEY_KEYS = ["@money","@cash","@gold","@pokedollars"];
const PARTY_KEYS = ["@actors","@party","@pokemon_party"];
const ID_NUM_KEYS = ["@trainer_id","@player_id","@id_no","@tid","@id"];
const PUBID_KEYS  = ["@public_id","@publicID"];

function hasAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return false;
  for (const k of Reflect.ownKeys(obj)) if (keys.includes(k2s(k as any))) return true;
  return false;
}
function getIvar<T = any>(obj: any, names: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of Reflect.ownKeys(obj)) {
    const n = k2s(k as any);
    if (names.includes(n)) return (obj as any)[k as any];
  }
  return undefined;
}
function looksLikeTrainer(o: any) {
  return typeof o === "object" &&
    hasAny(o, NAME_KEYS) &&
    (hasAny(o, MONEY_KEYS) || hasAny(o, PARTY_KEYS) || hasAny(o, [...ID_NUM_KEYS, ...PUBID_KEYS]));
}
function findTrainer(root: any): any | undefined {
  const q = [root], seen = new Set<any>();
  while (q.length) {
    const cur = q.shift()!;
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    if (looksLikeTrainer(cur)) return cur;
    for (const [, v] of ownEntries(cur)) if (v && typeof v === "object") q.push(v);
  }
  return undefined;
}
const normTid = (n?: number) => (n == null || n <= 0 ? undefined : (n > 65535 ? (n & 0xffff) : n));

/* ---------- parse ---------- */
export function parseSave(raw: Uint8Array): PlayerProfile | null {
  let root: any;
  try {
    let bytes = maybeDecompress(raw);
    bytes = sliceToMarshal(bytes);
    root = load(bytes as any);
  } catch { return null; }

  const out: PlayerProfile = {};
  const trainer = findTrainer(root);

  // Nom / genre
  out.name =
    asStr(getIvar(trainer, NAME_KEYS)) ??
    asStr(bfs(root, (k) => NAME_KEYS.includes(k)));

  const g =
    asInt(getIvar(trainer, ["@gender","@sex"])) ??
    asInt(bfs(root, (k) => k === "@gender" || k === "@sex"));
  out.gender = g == null ? undefined : (g === 1 ? 1 : 0);

  const charset =
    asStr(getIvar(trainer, ["@charset","@character_set","@hero_charset"])) ??
    asStr(bfs(root, (k) => ["@charset","@character_set","@hero_charset"].includes(k)));
  if (charset) (out as any).charset = charset;

  // ID joueur (TID 5 chiffres) — majorité simple
  const idCands: number[] = [];
  for (const k of ID_NUM_KEYS) {
    const v = normTid(asInt(getIvar(trainer, [k])));
    if (v != null) idCands.push(v);
  }
  for (const k of PUBID_KEYS) {
    const pub = asInt(getIvar(trainer, [k]));
    if (pub && pub > 0) idCands.push(pub & 0xffff);
  }
  const partyForId =
    getIvar(trainer, PARTY_KEYS) ?? bfs(root, (k, v) => PARTY_KEYS.includes(k) && Array.isArray(v));
  if (Array.isArray(partyForId)) {
    for (const pm of partyForId) {
      const tid =
        asInt(getIvar(pm, ["@trainer_id","@owner_id","@ot_id","@id_no","@tid"])) ?? undefined;
      if (tid) idCands.push(normTid(tid)!);
    }
  }
  const count = new Map<number, number>();
  for (const n of idCands.filter((x) => x && x > 0 && x <= 65535)) count.set(n, (count.get(n)||0)+1);
  out.id = [...count.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? idCands.find(x=>x && x>0 && x<=65535);

  // Argent / temps / début
  out.money =
    asInt(getIvar(trainer, MONEY_KEYS)) ??
    asInt(bfs(root, (k) => MONEY_KEYS.includes(k)));

  out.playTimeSec =
    asInt(getIvar(trainer, ["@play_time","@time_played","@play_time_s","@sec_played"])) ??
    asInt(bfs(root, (k) => ["@play_time","@time_played","@play_time_s","@sec_played"].includes(k)));

  const start =
    asInt(getIvar(trainer, ["@start_time","@start_date","@start"])) ??
    asInt(bfs(root, (k) => ["@start_time","@start_date","@start"].includes(k)));
  if (start != null) out.startTime = start;

  // Pokédex
  const dex = getIvar(trainer, ["@pokedex","@dex"]) ?? bfs(root, (k) => k === "@pokedex" || k === "@dex");
  const pokedex: PokedexInfo = {};
  if (dex && typeof dex === "object") {
    const get = (k: string) => (dex as any)[k as any];
    pokedex.seen =
      asInt(get("@seen_count")) ?? asInt(get("@seen")) ??
      asInt(bfs(dex, (k) => k === "@seen_count" || k === "@seen"));
    pokedex.caught =
      asInt(get("@caught_count")) ?? asInt(get("@caught")) ?? asInt(get("@captured")) ??
      asInt(bfs(dex, (k) => k === "@caught_count" || k === "@caught" || k === "@captured"));
  }
  out.pokedex = pokedex;

  // Équipe (sans shiny)
  const party =
    getIvar(trainer, PARTY_KEYS) ??
    bfs(root, (k, v) => PARTY_KEYS.includes(k) && Array.isArray(v));
  if (Array.isArray(party)) {
    out.team = party.slice(0, 6).map((pm: any): TeamMember => {
      const dexId = getIvar(pm, ["@id","@dex_id","@species_id"]);
      const level = getIvar(pm, ["@level"]);
      const nick  = getIvar(pm, ["@given_name","@nickname"]);
      const form  = getIvar(pm, ["@form","@forme","@form_index"]);
      const gdr   = getIvar(pm, ["@gender","@sex"]);
      return {
        code: asInt(dexId),
        form: asInt(form) ?? null,
        level: asInt(level),
        nickname: asStr(nick) ?? null,
        speciesName: null,
        gender: ((): 0 | 1 | 2 | undefined => {
          const v = asInt(gdr);
          return v == null ? undefined : (v === 1 ? 1 : 0);
        })(),
      };
    });
  }

  return out;
}
