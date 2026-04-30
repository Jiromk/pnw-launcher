import { supabase } from "./supabaseClient";

export type PvpBanStatus = {
  banned: boolean;
  reason: string | null;
  expiresAt: string | null;
  bannedAt: string | null;
};

export type TowerSeason = {
  number: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  bannerUrl: string | null;
  description: string;
};

export type TowerMaintenance = {
  enabled: boolean;
  message: string;
};

export type TowerConfig = {
  lastModified: string | null;
  season: TowerSeason;
  maintenance: TowerMaintenance;
  announcements: string;
};

/**
 * Vérifie le statut de ban PvP de auth.uid() via RPC SECURITY DEFINER.
 * Retourne `banned: false` si le RPC échoue (fail-open : ne pas bloquer un joueur
 * non-banni à cause d'un souci réseau).
 */
export async function fetchPvpBanStatus(): Promise<PvpBanStatus> {
  try {
    const { data, error } = await supabase.rpc("is_player_pvp_banned");
    if (error) {
      console.warn("[tower] is_player_pvp_banned RPC failed:", error.message);
      return { banned: false, reason: null, expiresAt: null, bannedAt: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      banned: !!row?.banned,
      reason: row?.reason ?? null,
      expiresAt: row?.expires_at ?? null,
      bannedAt: row?.banned_at ?? null,
    };
  } catch (e) {
    console.warn("[tower] is_player_pvp_banned threw:", e);
    return { banned: false, reason: null, expiresAt: null, bannedAt: null };
  }
}

/**
 * Récupère la config Tour de Combat depuis le site (saison + maintenance + annonces).
 * Retourne `null` si l'endpoint est indisponible — le caller doit traiter ça comme
 * "pas de maintenance" (fail-open).
 */
export async function fetchBattleTowerConfig(siteUrl: string): Promise<TowerConfig | null> {
  try {
    const base = (siteUrl || "").replace(/\/$/, "");
    if (!base) return null;
    const res = await fetch(`${base}/api/battle-tower`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success || !data.battleTower) return null;
    return data.battleTower as TowerConfig;
  } catch (e) {
    console.warn("[tower] fetchBattleTowerConfig failed:", e);
    return null;
  }
}

/** Formatte une expiration de ban en français lisible. `null` = permanent. */
export function formatBanExpiry(iso: string | null): string {
  if (!iso) return "permanent (jusqu'à révocation par un admin)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "permanent (jusqu'à révocation par un admin)";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
