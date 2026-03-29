// src/profile.ts
// Decode PSDK/Essentials save (Ruby Marshal)
import { load } from "@hyrious/marshal";
import { gunzipSync, unzlibSync } from "fflate";
import type { PlayerProfile, TeamMember, PokedexInfo, BoxPokemon, PCBox } from "./types";
import { detectShinyFromMarshal } from "./shinyDetect";

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
/** Comme getIvar mais respecte l’ordre de `names` (première clé existante gagne). À utiliser quand plusieurs alias coexistent (@id vs @species_id). */
function getIvarOrdered<T = any>(obj: any, names: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const want of names) {
    for (const k of Reflect.ownKeys(obj)) {
      if (k2s(k as any) === want) return (obj as any)[k as any];
    }
  }
  return undefined;
}
function looksLikeTrainer(o: any) {
  return typeof o === "object" &&
    (hasAny(o, NAME_KEYS) || hasAny(o, ["@badges","@play_time","@start_time"])) &&
    (hasAny(o, MONEY_KEYS) || hasAny(o, PARTY_KEYS) || hasAny(o, [...ID_NUM_KEYS, ...PUBID_KEYS]) || hasAny(o, ["@id_boy","@id_girl"]));
}
function findTrainer(root: any): any | undefined {
  const byKey = getByKey(root, "@trainer");
  if (byKey) return byKey;
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
function getByKey(obj: any, keyMatch: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of Reflect.ownKeys(obj)) {
    if (k2s(k as any).includes(keyMatch)) return (obj as any)[k as any];
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

  // Nom (PSDK: @name_boy / @name_girl sélectionné par @playing_girl)
  const nameBoy = asStr(getIvar(trainer, ["@name_boy"]));
  const nameGirl = asStr(getIvar(trainer, ["@name_girl"]));
  const playingGirl = getIvar(trainer, ["@playing_girl"]);
  const psdkName = playingGirl ? (nameGirl ?? nameBoy) : (nameBoy ?? nameGirl);
  if (psdkName) {
    out.name = psdkName;
  } else if (nameBoy !== undefined || nameGirl !== undefined) {
    const gameActors = getByKey(root, "@game_actors");
    const actorData = gameActors && getByKey(gameActors, "@data");
    if (actorData && typeof actorData === "object") {
      for (const k of Reflect.ownKeys(actorData)) {
        const entry = (actorData as any)[k as any];
        if (entry && typeof entry === "object") {
          const n = asStr(getIvar(entry, ["@name"]));
          if (n) { out.name = n; break; }
        }
      }
    }
  } else {
    out.name = asStr(getIvar(trainer, NAME_KEYS));
  }

  const g =
    asInt(getIvar(trainer, ["@gender","@sex"])) ??
    asInt(bfs(root, (k) => k === "@gender" || k === "@sex"));
  out.gender = g == null ? undefined : (g === 1 ? 1 : 0);

  const charset =
    asStr(getIvar(trainer, ["@charset","@character_set","@hero_charset"])) ??
    asStr(bfs(root, (k) => ["@charset","@character_set","@hero_charset"].includes(k)));
  if (charset) (out as any).charset = charset;

  // ID joueur — PSDK: @id_boy / @id_girl, visible = raw % 100000
  const idBoy = asInt(getIvar(trainer, ["@id_boy"]));
  const idGirl = asInt(getIvar(trainer, ["@id_girl"]));
  if (idBoy != null || idGirl != null) {
    const rawId = playingGirl ? (idGirl ?? idBoy) : (idBoy ?? idGirl);
    out.id = rawId != null ? rawId % 100000 : undefined;
  } else {
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
  }

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

  // Badges (boss / gym) — PSDK utilise @badges comme tableau de booléens
  const badgesRaw =
    getIvar(trainer, ["@badges","@gym_badges","@boss_badges"]) ??
    bfs(root, (k) => ["@badges","@gym_badges","@boss_badges"].includes(k));
  
  if (Array.isArray(badgesRaw)) {
    // @badges est un tableau de booléens : [true, false, false, ...]
    // On compte le nombre de true pour avoir le total, et on garde aussi le détail
    const badgesList: boolean[] = badgesRaw.map((v) => v === true);
    out.badges = badgesList.filter(Boolean).length;
    out.badgesList = badgesList;
  } else {
    const badges = asInt(badgesRaw);
    if (badges != null && badges >= 0) out.badges = badges;
  }

  // Pokédex (PSDK: root[@pokedex] avec @seen, @captured, @has_captured)
  const dex = getByKey(root, "@pokedex") ?? getIvar(trainer, ["@pokedex","@dex"]) ?? bfs(root, (k) => k === "@pokedex" || k === "@dex");
  const pokedex: PokedexInfo = {};
  if (dex && typeof dex === "object") {
    const get = (k: string) => getIvar(dex, [k]);
    pokedex.seen =
      asInt(get("@seen_count")) ?? asInt(get("@seen")) ??
      asInt(bfs(dex, (k) => k === "@seen_count" || k === "@seen"));
    pokedex.caught =
      asInt(get("@caught_count")) ?? asInt(get("@caught")) ?? asInt(get("@captured")) ??
      asInt(bfs(dex, (k) => k === "@caught_count" || k === "@caught" || k === "@captured"));
    const hasCaptured = get("@has_captured");
    if (Array.isArray(hasCaptured)) {
      const ids: number[] = [];
      for (let i = 0; i < hasCaptured.length; i++) {
        if (hasCaptured[i]) ids.push(i + 1);
      }
      pokedex.capturedIds = ids;
    }
    const hasSeenAndForms = get("@has_seen_and_forms");
    if (Array.isArray(hasSeenAndForms)) {
      const ids: number[] = [];
      for (let i = 0; i < hasSeenAndForms.length; i++) {
        const v = typeof hasSeenAndForms[i] === "number" ? hasSeenAndForms[i] : 0;
        if (v > 0) ids.push(i + 1);
      }
      pokedex.seenIds = ids;
    }
    const nbFought = get("@nb_fought");
    if (Array.isArray(nbFought)) {
      pokedex.foughtCounts = nbFought.map((v: unknown) => (typeof v === "number" ? v : 0));
    }
    const nbCaptured = get("@nb_captured");
    if (Array.isArray(nbCaptured)) {
      pokedex.capturedCounts = nbCaptured.map((v: unknown) => (typeof v === "number" ? v : 0));
    }
  }
  out.pokedex = pokedex;

  // Helper: parse un objet PFM::Pokemon Marshal → TeamMember
  function parsePokemon(pm: any): TeamMember {
    const dexId = getIvarOrdered(pm, ["@id", "@dex_id", "@species_id"]);
    const level = getIvar(pm, ["@level"]);
    const nick  = getIvar(pm, ["@given_name","@nickname"]);
    const form  = getIvar(pm, ["@form","@forme","@form_index"]);
    const gdr   = getIvar(pm, ["@gender","@sex"]);
    const speciesId = asInt(dexId) ?? 0;
    return {
      code: speciesId,
      form: asInt(form) ?? null,
      level: asInt(level),
      nickname: asStr(nick) ?? null,
      speciesName: null,
      gender: ((): 0 | 1 | 2 | undefined => {
        const v = asInt(gdr);
        return v == null ? undefined : (v === 1 ? 1 : 0);
      })(),
      isShiny: detectShinyFromMarshal(pm, speciesId),
      ivHp:  asInt(getIvar(pm, ["@iv_hp"]))  ?? 0,
      ivAtk: asInt(getIvar(pm, ["@iv_atk"])) ?? 0,
      ivDfe: asInt(getIvar(pm, ["@iv_dfe"])) ?? 0,
      ivSpd: asInt(getIvar(pm, ["@iv_spd"])) ?? 0,
      ivAts: asInt(getIvar(pm, ["@iv_ats"])) ?? 0,
      ivDfs: asInt(getIvar(pm, ["@iv_dfs"])) ?? 0,
      nature: asInt(getIvar(pm, ["@nature"])) ?? null,
      ability: asInt(getIvar(pm, ["@ability", "@ability_index"])) ?? null,
      itemHolding: asInt(getIvar(pm, ["@item_holding"])) ?? null,
      exp: asInt(getIvar(pm, ["@exp"])) ?? null,
      trainerName: asStr(getIvar(pm, ["@trainer_name"])) ?? null,
      moves: (() => {
        const skills = getIvar(pm, ["@skills_set"]);
        if (!Array.isArray(skills)) return [];
        const ids: number[] = [];
        for (const sk of skills) {
          const mid = asInt(getIvar(sk, ["@id"]));
          if (mid != null && mid > 0) ids.push(mid);
        }
        return ids;
      })(),
    };
  }

  // Équipe (avec shiny + IVs)
  const party =
    getIvar(trainer, PARTY_KEYS) ??
    bfs(root, (k, v) => PARTY_KEYS.includes(k) && Array.isArray(v));
  if (Array.isArray(party)) {
    out.team = party.slice(0, 6).map((pm: any): TeamMember => parsePokemon(pm));
  }

  // Boîtes PC (PFM::Storage → @boxes)
  const storage =
    getByKey(root, "@storage") ??
    bfs(root, (k) => k === "@storage");
  if (storage && typeof storage === "object") {
    const boxesRaw = getIvar(storage, ["@boxes"]);
    if (Array.isArray(boxesRaw)) {
      const boxes: PCBox[] = [];
      for (let b = 0; b < boxesRaw.length; b++) {
        const box = boxesRaw[b];
        if (!box || typeof box !== "object") continue;
        const boxName = asStr(getIvar(box, ["@name"])) ?? `Boîte ${b + 1}`;
        const content = getIvar(box, ["@content"]);
        const pokemon: (BoxPokemon | null)[] = [];
        if (Array.isArray(content)) {
          for (let s = 0; s < content.length; s++) {
            const pm = content[s];
            if (!pm || typeof pm !== "object" || !getIvar(pm, ["@id", "@dex_id", "@species_id"])) {
              pokemon.push(null);
            } else {
              pokemon.push({ ...parsePokemon(pm), slot: s });
            }
          }
        }
        boxes.push({ name: boxName, pokemon });
      }
      out.boxes = boxes;
    }
  }

  return out;
}
