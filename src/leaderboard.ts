import { supabase } from "./supabaseClient";
import type { PlayerProfile, TeamMember } from "./types";

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

export type PvpStats = {
  pvp_wins: number;
  pvp_losses: number;
  pvp_draws: number;
  battle_elo: number | null;
  battle_lp: number;
};

export async function fetchPvpStats(userId: string): Promise<PvpStats> {
  const { data } = await supabase
    .from("leaderboard_scores")
    .select("pvp_wins, pvp_losses, pvp_draws, battle_elo, battle_lp")
    .eq("user_id", userId)
    .single();
  return {
    pvp_wins: data?.pvp_wins ?? 0,
    pvp_losses: data?.pvp_losses ?? 0,
    pvp_draws: data?.pvp_draws ?? 0,
    battle_elo: data?.battle_elo ?? null,
    battle_lp: data?.battle_lp ?? 0,
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
    return (fallback ?? []).map((r: any) => ({ ...r, opponent_team: null })) as BattleResultEntry[];
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
};

export async function recordBattleResult(
  userId: string,
  opponentId: string,
  roomCode: string,
  opponentName: string,
  result: "win" | "loss" | "draw",
  reason: string = "battle_end",
  extras: RecordBattleExtras = {},
): Promise<void> {
  const startedAt = extras.startedAt ?? null;
  const endedAt = extras.endedAt ?? new Date().toISOString();
  let durationSec: number | null = null;
  if (startedAt) {
    const diff = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    if (Number.isFinite(diff) && diff >= 0) durationSec = diff;
  }
  // Insert match record
  await supabase.from("battle_results").insert({
    room_code: roomCode,
    user_id: userId,
    opponent_id: opponentId,
    opponent_name: opponentName,
    result,
    reason,
    started_at: startedAt,
    ended_at: endedAt,
    duration_sec: durationSec,
    match_type: extras.matchType ?? "amical",
    lp_delta: extras.lpDelta ?? null,
    my_team: extras.myTeam ?? null,
  });
  // Increment aggregate stats
  const col = result === "win" ? "pvp_wins" : result === "loss" ? "pvp_losses" : "pvp_draws";
  await supabase.rpc("increment_pvp_stat", { p_user_id: userId, p_column: col });
}
