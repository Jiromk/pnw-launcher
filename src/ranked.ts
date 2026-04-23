/**
 * ranked.ts — Helpers côté client pour le système de rang.
 *
 * Le modèle côté serveur :
 *  - `battle_mmr` caché, source de vérité pour le matchmaking
 *  - `battle_rank_tier` visible (enum 10 tiers + unranked)
 *  - `battle_lp` visible (0-100 hors apex, illimité en apex)
 *  - `placement_played` (0-5) pour la phase de placement
 *
 * Toute la logique de promotion/démotion/attribution est côté serveur
 * dans le RPC `record_ranked_battle`. Côté client, on ne fait que de
 * l'affichage.
 */

export type RankTier =
  | "unranked"
  | "iron"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "emerald"
  | "diamond"
  | "master"
  | "grandmaster"
  | "challenger";

/** Ordre croissant des rangs — utile pour comparer deux rangs. */
export const RANK_ORDER: RankTier[] = [
  "unranked",
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger",
];

/** Rangs qu'on affiche dans la barre de LP classique (0-100). Apex = affichage spécial. */
export const APEX_TIERS: RankTier[] = ["master", "grandmaster", "challenger"];

export function isApex(tier: RankTier): boolean {
  return APEX_TIERS.includes(tier);
}

export function tierOrder(tier: RankTier): number {
  const i = RANK_ORDER.indexOf(tier);
  return i < 0 ? 0 : i;
}

/** Compare deux rangs ; `> 0` si a > b, `< 0` si a < b, `0` si égaux. */
export function compareTier(a: RankTier, b: RankTier): number {
  return tierOrder(a) - tierOrder(b);
}

/* ───────────────── Display ───────────────── */

/** Nom affiché par rang, en FR / EN. */
export const TIER_LABELS: Record<RankTier, { fr: string; en: string }> = {
  unranked:    { fr: "Non classé",   en: "Unranked" },
  iron:        { fr: "Fer",          en: "Iron" },
  bronze:      { fr: "Bronze",       en: "Bronze" },
  silver:      { fr: "Argent",       en: "Silver" },
  gold:        { fr: "Or",           en: "Gold" },
  platinum:    { fr: "Platine",      en: "Platinum" },
  emerald:     { fr: "Émeraude",     en: "Emerald" },
  diamond:     { fr: "Diamant",      en: "Diamond" },
  master:      { fr: "Maître",       en: "Master" },
  grandmaster: { fr: "Grand Maître", en: "Grandmaster" },
  challenger:  { fr: "Challenger",   en: "Challenger" },
};

export function tierLabel(tier: RankTier, lang: "fr" | "en" = "fr"): string {
  return TIER_LABELS[tier]?.[lang] ?? tierLabel("unranked", lang);
}

/** Chemin vers l'icône SVG (servie depuis public/ranks/). */
export function tierIconUrl(tier: RankTier): string {
  return `/ranks/${tier}.svg`;
}

/* ───────────────── Theming ───────────────── */

/**
 * Palette par rang — utilisée pour les glow, bordures, textes dans l'UI.
 * Les valeurs sont des couleurs RGBA / HEX cohérentes avec les SVG.
 */
export type TierTheme = {
  /** Couleur d'accent (texte, bordures). */
  accent: string;
  /** Couleur complémentaire pour les dégradés. */
  accentSoft: string;
  /** Glow utilisé en box-shadow / radial-gradient background. */
  glow: string;
  /** Glow plus fort pour les animations / highlight. */
  glowStrong: string;
  /** Couleur de remplissage de la LP bar (dégradé). */
  barFrom: string;
  barTo: string;
};

export const TIER_THEMES: Record<RankTier, TierTheme> = {
  unranked: {
    accent: "#94A3B8",
    accentSoft: "#475569",
    glow: "rgba(148,163,184,0.22)",
    glowStrong: "rgba(148,163,184,0.50)",
    barFrom: "#64748B",
    barTo: "#334155",
  },
  iron: {
    accent: "#9CA3AF",
    accentSoft: "#4B5563",
    glow: "rgba(156,163,175,0.25)",
    glowStrong: "rgba(156,163,175,0.55)",
    barFrom: "#9CA3AF",
    barTo: "#4B5563",
  },
  bronze: {
    accent: "#D97706",
    accentSoft: "#92400E",
    glow: "rgba(217,119,6,0.28)",
    glowStrong: "rgba(217,119,6,0.60)",
    barFrom: "#FBBF24",
    barTo: "#92400E",
  },
  silver: {
    accent: "#CBD5E1",
    accentSoft: "#94A3B8",
    glow: "rgba(203,213,225,0.30)",
    glowStrong: "rgba(203,213,225,0.60)",
    barFrom: "#F1F5F9",
    barTo: "#64748B",
  },
  gold: {
    accent: "#FBBF24",
    accentSoft: "#B45309",
    glow: "rgba(251,191,36,0.36)",
    glowStrong: "rgba(251,191,36,0.70)",
    barFrom: "#FDE68A",
    barTo: "#B45309",
  },
  platinum: {
    accent: "#38BDF8",
    accentSoft: "#0369A1",
    glow: "rgba(56,189,248,0.36)",
    glowStrong: "rgba(56,189,248,0.70)",
    barFrom: "#7DD3FC",
    barTo: "#0C4A6E",
  },
  emerald: {
    accent: "#10B981",
    accentSoft: "#047857",
    glow: "rgba(16,185,129,0.38)",
    glowStrong: "rgba(16,185,129,0.72)",
    barFrom: "#34D399",
    barTo: "#065F46",
  },
  diamond: {
    accent: "#60A5FA",
    accentSoft: "#1E40AF",
    glow: "rgba(96,165,250,0.42)",
    glowStrong: "rgba(96,165,250,0.75)",
    barFrom: "#93C5FD",
    barTo: "#1E3A8A",
  },
  master: {
    accent: "#C084FC",
    accentSoft: "#6B21A8",
    glow: "rgba(168,85,247,0.45)",
    glowStrong: "rgba(168,85,247,0.80)",
    barFrom: "#D8B4FE",
    barTo: "#6B21A8",
  },
  grandmaster: {
    accent: "#F87171",
    accentSoft: "#991B1B",
    glow: "rgba(239,68,68,0.50)",
    glowStrong: "rgba(239,68,68,0.85)",
    barFrom: "#FCA5A5",
    barTo: "#7F1D1D",
  },
  challenger: {
    accent: "#FBBF24",
    accentSoft: "#EF4444",
    glow: "rgba(251,191,36,0.55)",
    glowStrong: "rgba(251,191,36,0.95)",
    barFrom: "#FEF3C7",
    barTo: "#7F1D1D",
  },
};

export function tierTheme(tier: RankTier): TierTheme {
  return TIER_THEMES[tier] ?? TIER_THEMES.unranked;
}

/* ───────────────── MMR → tier (pour preview client / placements) ───────────────── */

/**
 * Reflète la fonction SQL `public.rank_tier_from_mmr`.
 * Utile pour afficher une estimation du tier pendant les placements.
 * **La source de vérité reste côté serveur** — ne jamais utiliser pour écrire en DB.
 */
export function tierFromMmr(mmr: number): RankTier {
  if (mmr >= 3400) return "challenger";
  if (mmr >= 3100) return "grandmaster";
  if (mmr >= 2800) return "master";
  if (mmr >= 2450) return "diamond";
  if (mmr >= 2100) return "emerald";
  if (mmr >= 1750) return "platinum";
  if (mmr >= 1400) return "gold";
  if (mmr >= 1050) return "silver";
  if (mmr >= 700) return "bronze";
  return "iron";
}

/* ───────────────── Formatage ───────────────── */

/** Format de l'affichage LP : "67 LP" non-apex, "1234 LP" apex (illimité). */
export function formatLp(lp: number, _tier: RankTier): string {
  return `${lp} LP`;
}

/** Format court pour un rang : "Or · 67 LP" / "Maître · 1234 LP" / "Non classé" / "Placements 3/5" */
export function formatRankInline(
  tier: RankTier,
  lp: number,
  placementPlayed: number,
  lang: "fr" | "en" = "fr",
): string {
  if (placementPlayed < 5) {
    return lang === "fr"
      ? `Placements ${placementPlayed}/5`
      : `Placements ${placementPlayed}/5`;
  }
  if (tier === "unranked") return tierLabel("unranked", lang);
  return `${tierLabel(tier, lang)} · ${formatLp(lp, tier)}`;
}
