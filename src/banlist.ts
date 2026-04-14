// src/banlist.ts
// Système de banlist pour la Tour de Combat : récupère la liste des Pokémons interdits
// depuis le site (endpoint /api/banlist) et vérifie si l'équipe du joueur en contient.
// Fail-open : si le fetch échoue, on autorise le combat (pas un verrou anti-triche).

import type { TeamMember } from "./types";

export type BannedPokemon = {
  id: string;
  speciesId: number;
  form: number | null;
  name: string;
  imageUrl: string;
  reason: string;
};

export type BannedMatch = {
  banned: BannedPokemon;
  /** Nom affiché du Pokémon dans l'équipe (nickname ou fallback espèce). */
  teamLabel: string;
  /** Index 0-5 du slot dans l'équipe. */
  slotIdx: number;
};

const TTL_MS = 60_000;
let _cache: { list: BannedPokemon[]; fetchedAt: number } | null = null;
let _inflight: Promise<BannedPokemon[]> | null = null;

/** Force le prochain appel à re-fetcher (utile pour debug). */
export function clearBanlistCache() {
  _cache = null;
}

/**
 * Récupère la banlist depuis le site. Cache 60s en mémoire.
 * Fail-open : si le fetch échoue, retourne [] (pas de bannissement) plutôt que throw.
 */
export async function fetchBanlist(siteUrl: string): Promise<BannedPokemon[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < TTL_MS) return _cache.list;
  if (_inflight) return _inflight;

  const base = siteUrl.replace(/\/$/, "");
  _inflight = (async () => {
    try {
      const res = await fetch(`${base}/api/banlist?t=${Date.now()}`);
      const data = await res.json();
      if (!data?.success || !Array.isArray(data?.banlist?.entries)) {
        _cache = { list: [], fetchedAt: Date.now() };
        return [];
      }
      const list: BannedPokemon[] = data.banlist.entries
        .map((e: any): BannedPokemon => ({
          id: String(e.id ?? ""),
          speciesId: Number(e.speciesId) || 0,
          form: e.form == null ? null : Number(e.form),
          name: String(e.name ?? ""),
          imageUrl: String(e.imageUrl ?? ""),
          reason: String(e.reason ?? ""),
        }))
        .filter((e: BannedPokemon) => e.speciesId > 0);
      _cache = { list, fetchedAt: Date.now() };
      return list;
    } catch (err) {
      console.warn("[banlist] fetch failed, allowing battle:", err);
      // Fail-open : on cache aussi l'échec pour ne pas retenter 10x en 1s
      _cache = { list: [], fetchedAt: Date.now() };
      return [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/**
 * Normalise une valeur de forme en number | null.
 * - 0, null, undefined, "" → null (forme de base)
 * - autre → Number()
 */
function normalizeForm(f: unknown): number | null {
  if (f == null || f === "") return null;
  const n = typeof f === "number" ? f : parseInt(String(f), 10);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/**
 * Normalise un nom d'espèce pour la comparaison (lower, sans accents, sans espaces doubles).
 * Ex : "Phasmidàlle" → "phasmidalle"
 */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare l'équipe à la banlist. Retourne la liste ordonnée (par slotIdx) des matches.
 *
 * Matching : on compare par **nom d'espèce** (normalisé, insensible aux accents/casse).
 * Le pokedex.json du site utilise des numéros régionaux (ex: 068) qui ne correspondent PAS
 * aux IDs internes du jeu PSDK (ex: 957). Le matching par nom via `speciesNames[code]`
 * résout ce décalage.
 *
 * @param speciesNames — tableau PSDK (index = ID interne, valeur = nom FR), chargé via
 *   `cmd_psdk_french_species_names`. Si null, fallback sur le matching par speciesId (peu fiable).
 */
export function checkTeamAgainstBanlist(
  team: TeamMember[] | undefined | null,
  banlist: BannedPokemon[],
  speciesNames: string[] | null = null,
): BannedMatch[] {
  if (!team || team.length === 0 || banlist.length === 0) return [];
  const matches: BannedMatch[] = [];

  // Pré-normaliser les noms de la banlist une fois
  const banlistNormalized = banlist.map((b) => ({
    ...b,
    _normalizedName: normalizeName(b.name),
  }));

  for (let i = 0; i < team.length; i++) {
    const tm = team[i];
    if (!tm) continue;
    const tmSpeciesId =
      typeof tm.code === "number" ? tm.code : parseInt(String(tm.code ?? ""), 10);
    if (!Number.isFinite(tmSpeciesId) || tmSpeciesId <= 0) continue;
    const tmForm = normalizeForm(tm.form);

    // Résoudre le nom d'espèce via le tableau PSDK (priorité) ou fallback sur le TeamMember
    const resolvedName =
      (speciesNames && tmSpeciesId < speciesNames.length ? speciesNames[tmSpeciesId] : null) ??
      tm.speciesName ??
      null;
    const tmNormalizedName = resolvedName ? normalizeName(resolvedName) : "";

    for (const ban of banlistNormalized) {
      // Matching primaire : par NOM normalisé (résout le décalage pokedex num ≠ ID interne)
      const nameMatch = tmNormalizedName !== "" && ban._normalizedName !== "" && ban._normalizedName === tmNormalizedName;
      // Matching fallback : par speciesId (si les noms ne sont pas disponibles)
      const idMatch = !nameMatch && ban.speciesId === tmSpeciesId;

      if (!nameMatch && !idMatch) continue;
      // Vérif form : null côté ban + null côté team → match
      if (ban.form !== tmForm) continue;

      matches.push({
        banned: ban,
        teamLabel:
          tm.nickname?.trim() ||
          resolvedName ||
          ban.name ||
          `#${tmSpeciesId}`,
        slotIdx: i,
      });
      break; // un Pokémon ne matche qu'une seule entrée
    }
  }

  return matches;
}

/**
 * Helper tout-en-un : fetch + check. Utilisé directement par BattleTowerView / ChatView.
 * Retourne [] si la banlist n'est pas accessible (fail-open).
 *
 * @param speciesNames — tableau PSDK (index = ID interne, valeur = nom FR).
 */
export async function validateTeamForBattle(
  siteUrl: string,
  team: TeamMember[] | undefined | null,
  speciesNames: string[] | null = null,
): Promise<BannedMatch[]> {
  if (!team || team.length === 0) return [];
  const banlist = await fetchBanlist(siteUrl);
  return checkTeamAgainstBanlist(team, banlist, speciesNames);
}
