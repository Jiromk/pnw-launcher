// Décode le blob `downloadPokemon` du serveur GTS (base64 → zlib → Marshal PSDK Pokémon).
import { load } from "@hyrious/marshal";
import { gunzipSync, unzlibSync } from "fflate";
import {
  toUInt32,
  PNW_SHINY_RATE,
  pnwShinyFromCode,
  detectShinyFromMarshal,
  detectAltShinyFromMarshal,
} from "./shinyDetect";

type AnyObj = Record<string | symbol, unknown>;

const k2s = (k: string | symbol) => (typeof k === "symbol" ? String(k).slice(7, -1) : String(k));

const asInt = (v: unknown) =>
  typeof v === "number" ? (v | 0) : typeof v === "bigint" ? Number(v) : undefined;

// Fonctions shiny (pnwShinyFromCode, shinyFromPidXorTid, gen34StyleShinyFromPidAndOt,
// ivarTruthyShinyByName, detectShinyFromMarshal) importées depuis ./shinyDetect

const asStr = (v: unknown) => {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
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


function maybeDecompress(buf: Uint8Array): Uint8Array {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf);
    } catch {
      /* ignore */
    }
  }
  if (buf.length >= 2 && buf[0] === 0x78) {
    try {
      return unzlibSync(buf);
    } catch {
      /* ignore */
    }
  }
  return buf;
}

function sliceToMarshal(bytes: Uint8Array): Uint8Array {
  const lim = Math.min(bytes.length - 1, 512);
  for (let off = 0; off < lim; off++) {
    if (bytes[off] === 0x04 && bytes[off + 1] === 0x08) return bytes.slice(off);
  }
  try {
    const d2 = unzlibSync(bytes);
    for (let off = 0; off < Math.min(d2.length - 1, 512); off++) {
      if (d2[off] === 0x04 && d2[off + 1] === 0x08) return d2.slice(off);
    }
  } catch {
    /* ignore */
  }
  return bytes;
}

export type GtsDepositedParsed = {
  speciesInternalId: number;
  level: number;
  gender: number;
  form: number;
  nature: number;
  itemHolding: number;
  ability: number;
  trainerIdRaw: number;
  trainerVisibleId: number;
  trainerName: string;
  nickname: string | null;
  exp: number;
  isShiny: boolean;
  isAltShiny: boolean;
  ivHp: number;
  ivAtk: number;
  ivDfe: number;
  ivSpd: number;
  ivAts: number;
  ivDfs: number;
  /** @rareness / @shiny_rate lus dans le Marshal (si absents, le jeu ne les a pas sérialisés). */
  marshalRareness: number | null;
  marshalShinyRate: number | null;
  /** Attaques du Pokémon (jusqu'à 4), extraites de @skills_set. Chaque élément = ID interne PSDK de l'attaque. */
  moves: number[];
};

/** Natures (0–24), ordre PSDK — libellés FR. */
export const NATURE_FR: string[] = [
  "Hardi",
  "Solo",
  "Brave",
  "Rigide",
  "Mauvais",
  "Assuré",
  "Docile",
  "Relax",
  "Malin",
  "Lâche",
  "Timide",
  "Pressé",
  "Sérieux",
  "Jovial",
  "Naïf",
  "Modeste",
  "Doux",
  "Discret",
  "Pudique",
  "Foufou",
  "Calme",
  "Gentil",
  "Malpoli",
  "Prudent",
  "Bizarre",
];

export function parseGtsDepositedPokemon(rawResponse: string): GtsDepositedParsed | null {
  const t = rawResponse.trim();
  if (!t || t.includes("GTS, Version")) return null;

  let bin: Uint8Array;
  try {
    const clean = t.replace(/\s+/g, "");
    bin = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }

  let bytes = maybeDecompress(bin);
  bytes = sliceToMarshal(bytes);

  let root: unknown;
  try {
    root = load(bytes as unknown as Uint8Array);
  } catch {
    return null;
  }

  if (!root || typeof root !== "object") return null;

  const speciesInternalId = asInt(getIvar(root, ["@id"])) ?? 0;
  const level = asInt(getIvar(root, ["@level"])) ?? 1;
  const gender = asInt(getIvar(root, ["@gender"])) ?? 0;
  const form = asInt(getIvar(root, ["@form"])) ?? 0;
  const nature = asInt(getIvar(root, ["@nature"])) ?? 0;
  const itemHolding = asInt(getIvar(root, ["@item_holding"])) ?? 0;
  const ability = asInt(getIvar(root, ["@ability", "@ability_index"])) ?? 0;
  const trainerIdRaw = asInt(getIvar(root, ["@trainer_id"])) ?? 0;
  const trainerName = asStr(getIvar(root, ["@trainer_name"])) ?? "—";
  const exp = asInt(getIvar(root, ["@exp"])) ?? 0;

  const given = getIvar(root, ["@given_name"]);
  let nickname: string | null = null;
  if (given != null && typeof given === "string" && given.trim()) nickname = given.trim();
  else if (given != null && given instanceof Uint8Array) {
    const s = asStr(given);
    if (s?.trim()) nickname = s.trim();
  }

  /* Détection chromatique (logique partagée dans shinyDetect.ts) */
  const isShiny = detectShinyFromMarshal(root, speciesInternalId);
  const isAltShiny = detectAltShinyFromMarshal(root);

  const rare = getIvar(root, ["@rareness"]);
  const shinyRate = getIvar(root, ["@shiny_rate"]);

  if (import.meta.env.DEV && typeof root === "object" && root) {
    const personalId = toUInt32(getIvar(root, ["@personal_id", "@personalID", "@pid", "@encryption", "@code"]));
    const snap: Record<string, unknown> = {};
    for (const k of Reflect.ownKeys(root as object)) {
      const name = k2s(k as string | symbol);
      const v = (root as AnyObj)[k as keyof typeof root];
      if (/shin|rare|code|personal|pid|encrypt|trainer/i.test(name)) snap[name] = v;
    }
    console.debug("[GTS] ivars Marshal utiles (chromatique / PID) :", snap);
    if (personalId !== undefined) {
      console.debug(
        `[GTS] PNW shiny: @code & 0xFFFF = ${personalId & 0xffff}, < ${PNW_SHINY_RATE} ? ${pnwShinyFromCode(personalId, PNW_SHINY_RATE)}`
      );
    }
  }

  const ivHp = asInt(getIvar(root, ["@iv_hp"])) ?? 0;
  const ivAtk = asInt(getIvar(root, ["@iv_atk"])) ?? 0;
  const ivDfe = asInt(getIvar(root, ["@iv_dfe"])) ?? 0;
  const ivSpd = asInt(getIvar(root, ["@iv_spd"])) ?? 0;
  const ivAts = asInt(getIvar(root, ["@iv_ats"])) ?? 0;
  const ivDfs = asInt(getIvar(root, ["@iv_dfs"])) ?? 0;

  /* Attaques (@skills_set = Array<PFM::Skill>, chaque Skill a un @id) */
  const moves: number[] = [];
  const skillsSet = getIvar(root, ["@skills_set"]);
  if (Array.isArray(skillsSet)) {
    for (const sk of skillsSet) {
      const mid = asInt(getIvar(sk, ["@id"]));
      if (mid != null && mid > 0) moves.push(mid);
    }
  }

  const trainerVisibleId = trainerIdRaw > 0 ? trainerIdRaw % 100000 : 0;

  const marshalRareness =
    rare !== undefined && rare !== null ? (toUInt32(rare) ?? (asInt(rare) ?? null)) : null;
  const marshalShinyRate =
    shinyRate !== undefined && shinyRate !== null
      ? (toUInt32(shinyRate) ?? (asInt(shinyRate) ?? null))
      : null;

  return {
    speciesInternalId,
    level,
    gender,
    form,
    nature,
    itemHolding,
    ability,
    trainerIdRaw,
    trainerVisibleId,
    trainerName,
    nickname,
    exp,
    isShiny,
    isAltShiny,
    ivHp,
    ivAtk,
    ivDfe,
    ivSpd,
    ivAts,
    ivDfs,
    marshalRareness,
    marshalShinyRate,
    moves,
  };
}
