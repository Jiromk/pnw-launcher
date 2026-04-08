import { supabase } from "./supabaseClient";
import type { PlayerProfile } from "./types";

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

export type PvpStats = { pvp_wins: number; pvp_losses: number; pvp_draws: number };

export async function fetchPvpStats(userId: string): Promise<PvpStats> {
  const { data } = await supabase
    .from("leaderboard_scores")
    .select("pvp_wins, pvp_losses, pvp_draws")
    .eq("user_id", userId)
    .single();
  return { pvp_wins: data?.pvp_wins ?? 0, pvp_losses: data?.pvp_losses ?? 0, pvp_draws: data?.pvp_draws ?? 0 };
}

export type BattleResultEntry = {
  id: number;
  room_code: string;
  opponent_id: string;
  opponent_name: string | null;
  result: "win" | "loss" | "draw";
  reason: string | null;
  created_at: string;
};

export async function fetchBattleHistory(userId: string, limit = 15): Promise<BattleResultEntry[]> {
  const { data } = await supabase
    .from("battle_results")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as BattleResultEntry[];
}

export async function recordBattleResult(
  userId: string,
  opponentId: string,
  roomCode: string,
  opponentName: string,
  result: "win" | "loss" | "draw",
  reason: string = "battle_end",
): Promise<void> {
  // Insert match record
  await supabase.from("battle_results").insert({
    room_code: roomCode,
    user_id: userId,
    opponent_id: opponentId,
    opponent_name: opponentName,
    result,
    reason,
  });
  // Increment aggregate stats
  const col = result === "win" ? "pvp_wins" : result === "loss" ? "pvp_losses" : "pvp_draws";
  await supabase.rpc("increment_pvp_stat", { p_user_id: userId, p_column: col });
}
