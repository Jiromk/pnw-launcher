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
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: scores } = await supabase
    .from("leaderboard_scores")
    .select("user_id, pokedex_count, shinydex_count, shiny_total, play_time_sec, money, updated_at")
    .order("pokedex_count", { ascending: false });

  if (!scores?.length) return [];

  const userIds = scores.map((s) => s.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, roles")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return scores.map((s) => ({
    ...s,
    profiles: profileMap.get(s.user_id) ?? { username: "Joueur", display_name: null, avatar_url: null, roles: [] },
  }));
}
