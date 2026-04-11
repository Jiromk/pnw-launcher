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
 * Compare l'équipe à la banlist. Retourne la liste ordonnée (par slotIdx) des matches.
 * Matching : speciesId identique ET form identique (après normalisation form=0/null).
 */
export function checkTeamAgainstBanlist(
  team: TeamMember[] | undefined | null,
  banlist: BannedPokemon[],
): BannedMatch[] {
  if (!team || team.length === 0 || banlist.length === 0) return [];
  const matches: BannedMatch[] = [];

  for (let i = 0; i < team.length; i++) {
    const tm = team[i];
    if (!tm) continue;
    const tmSpeciesId =
      typeof tm.code === "number" ? tm.code : parseInt(String(tm.code ?? ""), 10);
    if (!Number.isFinite(tmSpeciesId) || tmSpeciesId <= 0) continue;
    const tmForm = normalizeForm(tm.form);

    for (const ban of banlist) {
      if (ban.speciesId !== tmSpeciesId) continue;
      if (ban.form !== tmForm) continue; // form=null côté ban + null côté team → match
      matches.push({
        banned: ban,
        teamLabel:
          tm.nickname?.trim() ||
          tm.speciesName?.trim() ||
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
 */
export async function validateTeamForBattle(
  siteUrl: string,
  team: TeamMember[] | undefined | null,
): Promise<BannedMatch[]> {
  if (!team || team.length === 0) return [];
  const banlist = await fetchBanlist(siteUrl);
  return checkTeamAgainstBanlist(team, banlist);
}
