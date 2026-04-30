import { supabase } from "./supabaseClient";
import type { PlayerProfile, TeamMember } from "./types";
import type { RankTier } from "./ranked";

/* ==================== Types ==================== */

export type LeaderboardEntry = {
  user_id: string;
  pokedex_count: number;
  shinydex_count: number;
  shiny_total: number;
  play_time_sec: number;
  money: number;
  updated_at: string;
  profiles: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[];
  };
};

/* ==================== Helpers ==================== */

/** Compte les shinys : espèces uniques + total brut. */
export function computeShinyCounts(profile: PlayerProfile): { unique: number; total: number } {
  const ids = new Set<string>();
  let total = 0;
  for (const m of profile.team ?? []) {
    if (m?.isShiny && m.code != null) { ids.add(String(m.code).split("_")[0]); total++; }
  }
  for (const box of profile.boxes ?? []) {
    for (const p of box.pokemon) {
      if (p?.isShiny && p.code != null) { ids.add(String(p.code).split("_")[0]); total++; }
    }
  }
  return { unique: ids.size, total };
}

/* ==================== Supabase ==================== */

export async function upsertLeaderboardScore(
  userId: string,
  profile: PlayerProfile,
): Promise<void> {
  const pokedex_count = profile.pokedex?.capturedIds?.length ?? 0;
  const { unique: shinydex_count, total: shiny_total } = computeShinyCounts(profile);
  const play_time_sec = profile.playTimeSec ?? 0;
  const money = profile.money ?? 0;

  await supabase.from("leaderboard_scores").upsert(
    {
      user_id: userId,
      pokedex_count,
      shinydex_count,
      shiny_total,
      play_time_sec,
      money,
      save_id: profile.rawTrainerId ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: scores } = await supabase
    .from("leaderboard_scores")
    .select("user_id, pokedex_count, shinydex_count, shiny_total, play_time_sec, money, save_id, updated_at")
    .order("pokedex_count", { ascending: false });

  if (!scores?.length) return [];

  // Dédupliquer par save_id : garder le meilleur score (premier dans l'ordre trié) pour chaque save unique
  const seenSaveIds = new Set<number>();
  const deduplicated = scores.filter((s) => {
    const sid = s.save_id ?? 0;
    if (sid === 0) return true; // pas de save_id → pas de dédup
    if (seenSaveIds.has(sid)) return false;
    seenSaveIds.add(sid);
    return true;
  });

  const userIds = deduplicated.map((s) => s.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, roles")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return deduplicated.map((s) => ({
    ...s,
    profiles: profileMap.get(s.user_id) ?? { username: "Joueur", display_name: null, avatar_url: null, roles: [] },
  }));
}

/* ==================== PvP Stats ==================== */

/**
 * Stats PvP détaillées par mode.
 * - `*_amical` / `*_ranked` : compteurs incrémentés par les RPC (source de vérité).
 * - `pvp_wins/losses/draws` : colonnes **générées** en DB (somme amical+ranked).
 * - `battle_mmr` : MMR caché (Elo), source de vérité pour le matchmaking.
 * - `battle_rank_tier` : rang visible (unranked → challenger).
 * - `battle_lp` : LP 0-100 hors apex, illimité en apex.
 * - `placement_played` / `placement_wins` : phase de placement (5 matchs).
 * - `battle_elo` : legacy (pas utilisé — conservé pour rétrocompat).
 */
export type PvpStats = {
  pvp_wins_amical: number;
  pvp_losses_amical: number;
  pvp_draws_amical: number;
  pvp_wins_ranked: number;
  pvp_losses_ranked: number;
  pvp_draws_ranked: number;
  pvp_wins: number;
  pvp_losses: number;
  pvp_draws: number;
  battle_mmr: number;
  battle_rank_tier: RankTier;
  battle_lp: number;
  placement_played: number;
  placement_wins: number;
  battle_elo: number | null;
};

export async function fetchPvpStats(userId: string): Promise<PvpStats> {
  const { data } = await supabase
    .from("leaderboard_scores")
    .select("pvp_wins_amical, pvp_losses_amical, pvp_draws_amical, pvp_wins_ranked, pvp_losses_ranked, pvp_draws_ranked, pvp_wins, pvp_losses, pvp_draws, battle_mmr, battle_rank_tier, battle_lp, placement_played, placement_wins, battle_elo")
    .eq("user_id", userId)
    .single();
  return {
    pvp_wins_amical: data?.pvp_wins_amical ?? 0,
    pvp_losses_amical: data?.pvp_losses_amical ?? 0,
    pvp_draws_amical: data?.pvp_draws_amical ?? 0,
    pvp_wins_ranked: data?.pvp_wins_ranked ?? 0,
    pvp_losses_ranked: data?.pvp_losses_ranked ?? 0,
    pvp_draws_ranked: data?.pvp_draws_ranked ?? 0,
    pvp_wins: data?.pvp_wins ?? 0,
    pvp_losses: data?.pvp_losses ?? 0,
    pvp_draws: data?.pvp_draws ?? 0,
    battle_mmr: data?.battle_mmr ?? 1000,
    battle_rank_tier: (data?.battle_rank_tier as RankTier) ?? "unranked",
    battle_lp: data?.battle_lp ?? 0,
    placement_played: data?.placement_played ?? 0,
    placement_wins: data?.placement_wins ?? 0,
    battle_elo: data?.battle_elo ?? null,
  };
}

/* ==================== Ranked Leaderboard ==================== */

export type RankedLeaderboardFilter = "global" | "apex";

export type RankedLeaderboardEntry = {
  rank: number;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  battle_rank_tier: RankTier;
  battle_lp: number;
  battle_mmr: number;
  pvp_wins_ranked: number;
  pvp_losses_ranked: number;
  pvp_draws_ranked: number;
};

export type MyLeaderboardPosition = {
  rank: number;
  totalPlayers: number;
  battleRankTier: RankTier;
  battleLp: number;
  battleMmr: number;
} | null;

/**
 * Top 100 du leaderboard ranked (filtre global ou apex).
 * Trié par tier desc > LP desc > MMR desc > wins desc.
 * Seuls les joueurs avec placements terminés (5/5) apparaissent.
 */
export async function fetchRankedLeaderboard(
  filter: RankedLeaderboardFilter = "global",
  limit = 100,
  offset = 0,
): Promise<RankedLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("fetch_ranked_leaderboard", {
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.warn("[leaderboard] fetch_ranked_leaderboard failed:", error.message);
    return [];
  }
  return (data ?? []) as RankedLeaderboardEntry[];
}

/**
 * Position du joueur courant dans le leaderboard.
 * Retourne null si l'utilisateur n'est pas classé (placements non terminés).
 */
export async function fetchMyLeaderboardPosition(
  filter: RankedLeaderboardFilter = "global",
): Promise<MyLeaderboardPosition> {
  const { data, error } = await supabase.rpc("fetch_my_leaderboard_position", {
    p_filter: filter,
  });
  if (error) {
    console.warn("[leaderboard] fetch_my_leaderboard_position failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    rank: row.rank,
    totalPlayers: row.total_players,
    battleRankTier: row.battle_rank_tier as RankTier,
    battleLp: row.battle_lp,
    battleMmr: row.battle_mmr,
  };
}

/** Pokémon tel que snapshot au moment du combat (sous-ensemble de TeamMember). */
export type BattleTeamSnapshot = {
  code: number;
  form: number | null;
  nickname: string | null;
  speciesName: string | null;
  level: number | null;
  isShiny: boolean | null;
};

export type MatchType = "amical" | "ranked";

/** Aperçu minimal du Pokémon misé (stocké en `bet_pokemon_preview`). */
export type BetPokemonPreview = {
  speciesId?: number;
  form?: number | null;
  name?: string | null;
  nickname?: string | null;
  level?: number | null;
  shiny?: boolean | null;
  altShiny?: boolean | null;
  [k: string]: unknown;
};

export type BattleResultEntry = {
  id: number;
  room_code: string;
  user_id?: string;
  opponent_id: string;
  opponent_name: string | null;
  result: "win" | "loss" | "draw";
  reason: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  match_type: MatchType | null;
  lp_delta: number | null;
  my_team: BattleTeamSnapshot[] | null;
  /** Équipe de l'adversaire, récupérée via self-join sur room_code (peut être null si l'adversaire n'a pas enregistré sa propre ligne). */
  opponent_team: BattleTeamSnapshot[] | null;
  /** true si le match était en mode pari. */
  bet_mode: boolean | null;
  /** Pokémon que j'avais misé. */
  bet_pokemon_preview: BetPokemonPreview | null;
  /** Pokémon que l'adversaire avait misé (via self-join). */
  opponent_bet_preview: BetPokemonPreview | null;
};

/**
 * Récupère l'historique de combats avec l'équipe de l'adversaire (enrichie via RPC self-join).
 * Zéro colonne supplémentaire : on croise les rows des 2 joueurs partageant le même room_code.
 */
export async function fetchBattleHistory(userId: string, limit = 20): Promise<BattleResultEntry[]> {
  const { data, error } = await supabase.rpc("fetch_battle_history_with_opponent", {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) {
    console.warn("[battle history] RPC failed, fallback to plain fetch:", error.message);
    const { data: fallback } = await supabase
      .from("battle_results")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (fallback ?? []).map((r: any) => ({
      ...r,
      opponent_team: null,
      opponent_bet_preview: null,
    })) as BattleResultEntry[];
  }
  return (data ?? []) as BattleResultEntry[];
}

/** Réduit un TeamMember à un snapshot minimal pour le stockage en DB. */
export function snapshotTeam(team: TeamMember[] | null | undefined): BattleTeamSnapshot[] {
  if (!team || team.length === 0) return [];
  const snap: BattleTeamSnapshot[] = [];
  for (const tm of team) {
    if (!tm) continue;
    const code = typeof tm.code === "number" ? tm.code : parseInt(String(tm.code ?? ""), 10);
    if (!Number.isFinite(code) || code <= 0) continue;
    snap.push({
      code,
      form: typeof tm.form === "number" ? tm.form : (tm.form == null ? null : parseInt(String(tm.form), 10) || null),
      nickname: tm.nickname ?? null,
      speciesName: tm.speciesName ?? null,
      level: tm.level ?? null,
      isShiny: tm.isShiny ?? null,
    });
  }
  return snap;
}

export type RecordBattleExtras = {
  startedAt?: string | null;
  endedAt?: string | null;
  matchType?: MatchType;
  lpDelta?: number | null;
  myTeam?: BattleTeamSnapshot[] | null;
  betMode?: boolean;
  betPokemonPreview?: Record<string, unknown>;
};

/**
 * Résultat du RPC ranked — renvoyé côté client pour déclencher l'animation
 * de promotion si besoin, afficher le nouveau rang, etc.
 */
export type RankedRecordResult = {
  wasRecorded: boolean;
  newTier: RankTier;
  newLp: number;
  newMmr: number;
  mmrDelta: number;
  lpDelta: number;
  promoted: boolean;
  demoted: boolean;
  isPlacement: boolean;
  placementPlayed: number;
};

/**
 * Enregistre le résultat d'un combat PvP (amical ou ranked).
 *
 * Route vers le bon RPC (`record_friendly_battle` ou `record_ranked_battle`)
 * selon `extras.matchType`. Les deux RPC sont SECURITY DEFINER : ils utilisent
 * `auth.uid()` et sont idempotents via `UNIQUE (room_code, user_id)`.
 *
 * Retourne `RankedRecordResult` si c'était un match ranked, `null` sinon.
 * Le caller peut utiliser ce résultat pour déclencher l'animation de promotion.
 */
export async function recordBattleResult(
  _userId: string,
  opponentId: string,
  roomCode: string,
  opponentName: string,
  result: "win" | "loss" | "draw",
  reason: string = "battle_end",
  extras: RecordBattleExtras = {},
): Promise<RankedRecordResult | null> {
  const matchType: MatchType = extras.matchType ?? "amical";

  // ─── Amical ───
  if (matchType === "amical") {
    const { error } = await supabase.rpc("record_friendly_battle", {
      p_room_code: roomCode,
      p_opponent_id: opponentId,
      p_opponent_name: opponentName || null,
      p_result: result,
      p_reason: reason,
      p_started_at: extras.startedAt ?? null,
      p_ended_at: extras.endedAt ?? null,
      p_my_team: extras.myTeam ?? null,
      p_bet_mode: extras.betMode ?? false,
      p_bet_pokemon_preview: extras.betPokemonPreview ?? null,
    });
    if (error) {
      console.warn("[battle] record_friendly_battle RPC failed:", error.message);
    }
    return null;
  }

  // ─── Ranked ───
  const { data, error } = await supabase.rpc("record_ranked_battle", {
    p_room_code: roomCode,
    p_opponent_id: opponentId,
    p_opponent_name: opponentName || null,
    p_result: result,
    p_reason: reason,
    p_started_at: extras.startedAt ?? null,
    p_ended_at: extras.endedAt ?? null,
    p_my_team: extras.myTeam ?? null,
    p_bet_mode: extras.betMode ?? false,
    p_bet_pokemon_preview: extras.betPokemonPreview ?? null,
  });

  if (error) {
    console.warn("[battle] record_ranked_battle RPC failed:", error.message);
    return null;
  }
  // Le RPC retourne une table (1 ligne) → supabase-js le sort en array
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    wasRecorded: !!row.was_recorded,
    newTier: (row.new_tier as RankTier) ?? "unranked",
    newLp: row.new_lp ?? 0,
    newMmr: row.new_mmr ?? 1000,
    mmrDelta: row.mmr_delta ?? 0,
    lpDelta: row.lp_delta ?? 0,
    promoted: !!row.promoted,
    demoted: !!row.demoted,
    isPlacement: !!row.is_placement,
    placementPlayed: row.placement_played ?? 0,
  };
}
