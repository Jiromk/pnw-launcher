// src/views/battleTower/BattleTowerProfile.tsx
// Profil du joueur dans la Tour de Combat : bannière chat + stats PvP + historique des matchs
// dans un style League of Legends (cards colorées par résultat, sprites de l'équipe utilisée).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { NATURE_FR } from "../../gtsDepositedPokemon";
import {
  FaChartLine,
  FaCircleCheck,
  FaCrown,
  FaHandshake,
  FaShieldHalved,
  FaSkull,
  FaTrophy,
  FaClock,
  FaBolt,
  FaBoltLightning,
  FaArrowLeft,
  FaEye,
  FaGem,
} from "react-icons/fa6";
import type { ChatProfile } from "../../types";
import {
  fetchBattleHistory,
  fetchPvpStats,
  type BattleResultEntry,
  type BattleTeamSnapshot,
  type BetPokemonPreview,
  type PvpStats,
} from "../../leaderboard";
import {
  isApex,
  tierIconUrl,
  tierLabel,
  tierTheme,
  type RankTier,
} from "../../ranked";

export type BattleTowerProfileLabels = {
  title: string;
  subtitle: string;
  anonymous: string;
  backToAmical: string;
  viewingOther: (name: string) => string;
  stats: {
    wins: string;
    losses: string;
    winrate: string;
    elo: string;
    lp: string;
    unranked: string;
    sectionAmical: string;
    sectionRanked: string;
    matches: (n: number) => string;
    rankedEmpty: string;
    rankedEmptyHint: string;
    heroTitle: string;
    placementTitle: string;
    placementProgress: (n: number) => string;
    placementHint: string;
    placementComplete: string;
    lpBarLabel: (lp: number) => string;
    apexLpLabel: (lp: number) => string;
    mmrLabel: (mmr: number) => string;
    promotionTitle: string;
    promotionSubtitle: (tier: string) => string;
    promotionPlacementTitle: string;
    promotionPlacementSubtitle: (tier: string) => string;
    promotionContinue: string;
  };
  filters: {
    all: string;
    amical: string;
    ranked: string;
  };
  history: {
    title: string;
    loading: string;
    loadingMore: string;
    endOfHistory: string;
    empty: string;
    emptyHint: string;
    resultWin: string;
    resultLoss: string;
    resultDraw: string;
    typeAmical: string;
    typeRanked: string;
    vs: string;
    teamTitle: string;
    youLabel: string;
    teamUnknown: string;
    durationLabel: string;
    lpGain: (n: number) => string;
    lpLoss: (n: number) => string;
    lpZero: string;
    timeAgoNow: string;
    timeAgoMin: (n: number) => string;
    timeAgoHour: (n: number) => string;
    timeAgoDay: (n: number) => string;
    betBadge: string;
    betWon: string;
    betLost: string;
    betDraw: string;
    betUnknown: string;
  };
};

type Props = {
  labels: BattleTowerProfileLabels;
  /** Profil à afficher (chat profile). Peut être le sien ou celui d'un autre joueur. */
  profile: ChatProfile;
  /** True si c'est le profil du joueur courant (UI légèrement différente). */
  isSelf: boolean;
  /** Callback optionnel pour revenir en arrière (affiche un bouton retour). */
  onBack?: () => void;
  /** Callback pour naviguer vers le profil d'un adversaire (par son UUID). */
  onViewOpponent?: (opponentId: string) => void;
};

type FilterKey = "all" | "amical" | "ranked";

const INITIAL_PAGE_SIZE = 10;
const PAGE_INCREMENT = 10;

export function BattleTowerProfile({ labels, profile, isSelf, onBack, onViewOpponent }: Props) {
  const [history, setHistory] = useState<BattleResultEntry[]>([]);
  const [stats, setStats] = useState<PvpStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const [speciesNames, setSpeciesNames] = useState<string[] | null>(null);
  const [skillNames, setSkillNames] = useState<string[] | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Noms PSDK (espèces + attaques) — utilisés pour les tooltips au hover et
  // pour résoudre le nom du Pokémon misé (car `bet_pokemon_preview.name` est
  // un placeholder générique).
  useEffect(() => {
    let cancelled = false;
    const loadList = (cmd: string, setter: (arr: string[]) => void) => {
      invoke<string>(cmd)
        .then((raw) => {
          if (cancelled) return;
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
              setter(arr as string[]);
            } else {
              setter([]);
            }
          } catch {
            setter([]);
          }
        })
        .catch(() => {
          if (!cancelled) setter([]);
        });
    };
    loadList("cmd_psdk_french_species_names", setSpeciesNames);
    loadList("cmd_psdk_french_skill_names", setSkillNames);
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch dès que le profil visé change (navigation d'un profil à un autre)
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setStats(null);
    setVisibleCount(INITIAL_PAGE_SIZE);
    setFilter("all");
    (async () => {
      setLoading(true);
      try {
        const [h, s] = await Promise.all([
          fetchBattleHistory(profile.id, 50),
          fetchPvpStats(profile.id),
        ]);
        if (cancelled) return;
        setHistory(h);
        setStats(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const filteredHistory = useMemo(() => {
    if (filter === "all") return history;
    return history.filter((m) => (m.match_type ?? "amical") === filter);
  }, [history, filter]);

  // Reset la pagination dès qu'on change de filtre
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE);
  }, [filter]);

  const visibleHistory = useMemo(
    () => filteredHistory.slice(0, visibleCount),
    [filteredHistory, visibleCount],
  );
  const hasMore = visibleCount < filteredHistory.length;

  // Infinite scroll : révèle les prochains 10 combats quand la sentinelle entre dans la vue
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + PAGE_INCREMENT, filteredHistory.length));
          }
        }
      },
      { rootMargin: "200px 0px" }, // déclenche un peu avant pour éviter l'effet "saute"
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, filteredHistory.length]);

  // Stats découpées par mode — chaque section a ses propres compteurs
  const amicalWins = stats?.pvp_wins_amical ?? 0;
  const amicalLosses = stats?.pvp_losses_amical ?? 0;
  const amicalDraws = stats?.pvp_draws_amical ?? 0;
  const amicalTotal = amicalWins + amicalLosses + amicalDraws;
  const amicalWinrate =
    amicalTotal > 0 ? Math.round((amicalWins / amicalTotal) * 1000) / 10 : null;

  const rankedWins = stats?.pvp_wins_ranked ?? 0;
  const rankedLosses = stats?.pvp_losses_ranked ?? 0;
  const rankedDraws = stats?.pvp_draws_ranked ?? 0;
  const rankedTotal = rankedWins + rankedLosses + rankedDraws;
  const rankedWinrate =
    rankedTotal > 0 ? Math.round((rankedWins / rankedTotal) * 1000) / 10 : null;

  const displayName =
    profile.display_name?.trim() || profile.username?.trim() || labels.anonymous;
  const username = profile.username ? `@${profile.username}` : "";
  const hasRoles = Array.isArray(profile.roles) && profile.roles.length > 0;

  return (
    <div
      className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 sm:px-10 sm:py-12"
      style={{ scrollbarGutter: "stable" }}
    >
      {/* Bouton retour (visible seulement quand on consulte le profil d'un autre joueur) */}
      {!isSelf && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex w-fit items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[13px] font-semibold text-white/70 ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-emerald-400/30 hover:bg-emerald-500/[0.08] hover:text-emerald-100"
          style={{ animation: "update-page-in 0.35s ease-out both" }}
        >
          <FaArrowLeft className="text-xs transition group-hover:-translate-x-0.5" />
          {labels.backToAmical}
        </button>
      )}

      {/* Badge "Profil de X" quand on consulte quelqu'un d'autre */}
      {!isSelf && (
        <div
          className="flex items-center justify-center"
          style={{ animation: "update-page-in 0.4s ease-out 0.05s both" }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-500/[0.08] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-200">
            <FaEye className="text-[10px]" />
            {labels.viewingOther(displayName)}
          </span>
        </div>
      )}

      {/* ── Hero : bannière + avatar + nom ── */}
      <div
        className="relative overflow-hidden rounded-3xl border border-amber-400/15 ring-1 ring-inset ring-white/[0.04] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]"
        style={{ animation: "update-page-in 0.45s ease-out both" }}
      >
        {/* Bannière (plus grande + haute qualité + dégradé léger juste pour la lisibilité du nom) */}
        <div className="relative h-56 w-full overflow-hidden sm:h-64">
          {profile.banner_url ? (
            <img
              src={profile.banner_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ imageRendering: "auto" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, rgba(245,158,11,0.28), rgba(194,65,12,0.15), rgba(15,23,42,0.8))",
              }}
            />
          )}
          {/* Dégradé léger, uniquement en bas, pour la lisibilité du nom */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0a1020] via-[#0a1020]/60 to-transparent" />
        </div>

        {/* Avatar + infos (déborde sur la bannière) */}
        <div className="relative -mt-14 flex flex-col items-center gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:gap-6 sm:px-8">
          <div className="relative shrink-0">
            <div className="rounded-full bg-gradient-to-br from-amber-400/35 to-orange-500/20 p-[3px] ring-4 ring-[#0a1020] shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_12px_40px_-12px_rgba(245,158,11,0.55)]">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-24 w-24 rounded-full object-cover sm:h-28 sm:w-28"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-950 text-3xl font-bold uppercase text-amber-200 sm:h-28 sm:w-28">
                  {displayName.charAt(0)}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {displayName}
              </h1>
              {hasRoles && (
                <div className="flex flex-wrap gap-1.5">
                  {profile.roles.slice(0, 3).map((role) => (
                    <RoleBadge key={role} role={role} />
                  ))}
                </div>
              )}
            </div>
            {username && (
              <p className="mt-1 text-xs text-white/45 sm:text-sm">{username}</p>
            )}
            {profile.bio && (
              <p className="mt-2 line-clamp-2 max-w-2xl text-xs italic leading-relaxed text-white/55 sm:text-[13px]">
                {profile.bio}
              </p>
            )}
          </div>

          {/* ── Rank hero badge (compact, à droite) ── */}
          <RankHeroBadge
            tier={stats?.battle_rank_tier ?? "unranked"}
            lp={stats?.battle_lp ?? 0}
            mmr={stats?.battle_mmr ?? 1000}
            placementPlayed={stats?.placement_played ?? 0}
            loading={loading}
            labels={labels.stats}
          />
        </div>
      </div>

      {/* ── Stats par mode : section AMICAL + section RANKED ── */}
      <div className="flex flex-col gap-6">
        {/* ═══════════════ AMICAL ═══════════════ */}
        <section
          className="relative"
          style={{ animation: "update-page-in 0.5s ease-out 0.1s both" }}
        >
          {/* Halo ambient emerald */}
          <div
            className="pointer-events-none absolute -inset-x-4 -inset-y-2 -z-10 rounded-[2rem] blur-3xl opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 20% 0%, rgba(52,211,153,0.10), transparent 65%)",
            }}
            aria-hidden
          />

          <SectionHeader
            icon={<FaHandshake />}
            label={labels.stats.sectionAmical}
            tone="emerald"
            matchCount={loading ? null : amicalTotal}
            matchesLabel={labels.stats.matches}
          />

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              icon={<FaTrophy />}
              iconColor="text-emerald-300"
              glowColor="rgba(52,211,153,0.22)"
              label={labels.stats.wins}
              value={loading ? null : String(amicalWins)}
            />
            <StatTile
              icon={<FaSkull />}
              iconColor="text-rose-300"
              glowColor="rgba(244,63,94,0.22)"
              label={labels.stats.losses}
              value={loading ? null : String(amicalLosses)}
            />
            <StatTile
              icon={<FaChartLine />}
              iconColor="text-sky-300"
              glowColor="rgba(56,189,248,0.22)"
              label={labels.stats.winrate}
              value={loading ? null : amicalWinrate != null ? `${amicalWinrate}%` : "—"}
            />
          </div>
        </section>

        {/* ═══════════════ RANKED ═══════════════ */}
        <section
          className="relative"
          style={{ animation: "update-page-in 0.55s ease-out 0.18s both" }}
        >
          {/* Halo ambient gold — plus prononcé pour marquer le prestige */}
          <div
            className="pointer-events-none absolute -inset-x-4 -inset-y-2 -z-10 rounded-[2rem] blur-3xl opacity-80"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 20% 0%, rgba(245,158,11,0.14), transparent 65%)",
            }}
            aria-hidden
          />

          <SectionHeader
            icon={<FaCrown />}
            label={labels.stats.sectionRanked}
            tone="amber"
            matchCount={loading ? null : rankedTotal}
            matchesLabel={labels.stats.matches}
            showShine
          />

          {/* ── Grande carte de rang : icône SVG + nom + LP bar + MMR ── */}
          <div className="mt-4">
            <RankDisplayCard
              tier={stats?.battle_rank_tier ?? "unranked"}
              lp={stats?.battle_lp ?? 0}
              mmr={stats?.battle_mmr ?? 1000}
              placementPlayed={stats?.placement_played ?? 0}
              placementWins={stats?.placement_wins ?? 0}
              loading={loading}
              labels={labels.stats}
            />
          </div>

          {/* ── 3 tuiles compactes : Wins / Losses / Winrate ── */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              icon={<FaTrophy />}
              iconColor="text-emerald-300"
              glowColor="rgba(52,211,153,0.22)"
              label={labels.stats.wins}
              value={loading ? null : String(rankedWins)}
            />
            <StatTile
              icon={<FaSkull />}
              iconColor="text-rose-300"
              glowColor="rgba(244,63,94,0.22)"
              label={labels.stats.losses}
              value={loading ? null : String(rankedLosses)}
            />
            <StatTile
              icon={<FaChartLine />}
              iconColor="text-sky-300"
              glowColor="rgba(56,189,248,0.22)"
              label={labels.stats.winrate}
              value={loading ? null : rankedWinrate != null ? `${rankedWinrate}%` : "—"}
            />
          </div>

          {/* Empty state discret quand aucun ranked joué — juste sous la grid */}
          {!loading && rankedTotal === 0 && (stats?.placement_played ?? 0) >= 5 && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[0.03] px-4 py-2.5 text-center text-[11px] italic text-amber-200/60">
              <FaCrown className="text-[10px] text-amber-300/60" />
              <span>{labels.stats.rankedEmpty}</span>
              <span className="text-amber-200/35">·</span>
              <span className="text-amber-200/45">{labels.stats.rankedEmptyHint}</span>
            </div>
          )}
        </section>
      </div>

      {/* ── Historique ── */}
      <div
        className="flex flex-col gap-4"
        style={{ animation: "update-page-in 0.55s ease-out 0.2s both" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FaBolt className="text-base text-amber-300/80" />
            <h2 className="text-lg font-semibold text-white/90">
              {labels.history.title}
            </h2>
            {!loading && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                {filteredHistory.length}
              </span>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-sm">
            <FilterPill
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label={labels.filters.all}
            />
            <FilterPill
              active={filter === "amical"}
              onClick={() => setFilter("amical")}
              label={labels.filters.amical}
              color="emerald"
            />
            <FilterPill
              active={filter === "ranked"}
              onClick={() => setFilter("ranked")}
              label={labels.filters.ranked}
              color="amber"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-sm text-white/55">
            <FaClock className="mr-2 animate-pulse" />
            {labels.history.loading}
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-14 text-center">
            <FaShieldHalved className="text-3xl text-white/20" />
            <p className="text-sm text-white/55">{labels.history.empty}</p>
            <p className="text-xs italic text-white/30">{labels.history.emptyHint}</p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {visibleHistory.map((match, idx) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  labels={labels}
                  onViewOpponent={onViewOpponent}
                  index={idx}
                  speciesNames={speciesNames}
                  skillNames={skillNames}
                />
              ))}
            </ul>

            {/* Sentinelle + loader pour l'infinite scroll */}
            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center py-4 text-[11px] italic text-white/35"
              >
                <FaClock className="mr-2 animate-spin text-[10px]" />
                {labels.history.loadingMore}
              </div>
            )}

            {/* Indicateur de fin (tous les combats chargés) */}
            {!hasMore && filteredHistory.length > INITIAL_PAGE_SIZE && (
              <div className="flex items-center justify-center gap-2 py-4 text-[11px] italic text-white/25">
                <span className="h-px w-8 bg-white/10" />
                {labels.history.endOfHistory}
                <span className="h-px w-8 bg-white/10" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Sub-components ──────────────────────────── */

type SectionTone = "emerald" | "amber";

const SECTION_TONE_CONFIG: Record<
  SectionTone,
  {
    iconBg: string;
    iconBorder: string;
    iconRing: string;
    iconColor: string;
    iconShadow: string;
    labelColor: string;
    separator: string;
    badgeBorder: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  emerald: {
    iconBg: "from-emerald-400/25 via-emerald-500/15 to-teal-600/10",
    iconBorder: "border-emerald-400/35",
    iconRing: "ring-emerald-300/15",
    iconColor: "text-emerald-200",
    iconShadow: "0 4px 18px -6px rgba(52,211,153,0.45)",
    labelColor: "text-emerald-100/85",
    separator:
      "bg-gradient-to-r from-emerald-400/45 via-emerald-400/15 to-transparent",
    badgeBorder: "border-emerald-400/30",
    badgeBg: "bg-emerald-500/10",
    badgeText: "text-emerald-100/80",
  },
  amber: {
    iconBg: "from-amber-300/30 via-amber-500/20 to-orange-600/10",
    iconBorder: "border-amber-400/45",
    iconRing: "ring-amber-300/20",
    iconColor: "text-amber-200",
    iconShadow:
      "0 4px 20px -4px rgba(245,158,11,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
    labelColor: "text-amber-100/90",
    separator:
      "bg-gradient-to-r from-amber-400/55 via-amber-400/20 to-transparent",
    badgeBorder: "border-amber-400/35",
    badgeBg: "bg-amber-500/12",
    badgeText: "text-amber-100/85",
  },
};

function SectionHeader({
  icon,
  label,
  tone,
  matchCount,
  matchesLabel,
  showShine = false,
}: {
  icon: React.ReactNode;
  label: string;
  tone: SectionTone;
  matchCount: number | null;
  matchesLabel: (n: number) => string;
  showShine?: boolean;
}) {
  const cfg = SECTION_TONE_CONFIG[tone];
  return (
    <div className="flex items-center gap-3">
      {/* Icône emblème */}
      <div
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-br ${cfg.iconBg} ${cfg.iconBorder} ring-1 ring-inset ${cfg.iconRing}`}
        style={{ boxShadow: cfg.iconShadow }}
      >
        <span className={`text-[15px] ${cfg.iconColor}`}>{icon}</span>
        {/* Reflet pour la section prestigieuse */}
        {showShine && (
          <span
            className="section-header-shine pointer-events-none absolute inset-0"
            aria-hidden
          />
        )}
      </div>

      {/* Label + séparateur */}
      <div className="flex flex-1 items-center gap-3">
        <h3
          className={`text-[12px] font-bold uppercase tracking-[0.22em] ${cfg.labelColor}`}
        >
          {label}
        </h3>
        <span className={`h-px flex-1 ${cfg.separator}`} aria-hidden />
      </div>

      {/* Badge compteur */}
      {matchCount !== null && (
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border ${cfg.badgeBorder} ${cfg.badgeBg} px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${cfg.badgeText}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              tone === "amber" ? "bg-amber-300" : "bg-emerald-300"
            }`}
            style={{
              boxShadow:
                tone === "amber"
                  ? "0 0 6px rgba(252,211,77,0.75)"
                  : "0 0 6px rgba(110,231,183,0.6)",
            }}
          />
          {matchesLabel(matchCount)}
        </span>
      )}
    </div>
  );
}

/* ───────────────── Rank badges ───────────────── */

type RankBadgeStatsLabels = BattleTowerProfileLabels["stats"];

/**
 * Compact, affiché à droite de l'avatar dans le hero. Vise à donner un
 * aperçu immédiat du rang sans déplacer l'utilisateur.
 */
function RankHeroBadge({
  tier,
  lp,
  mmr,
  placementPlayed,
  loading,
  labels,
}: {
  tier: RankTier;
  lp: number;
  mmr: number;
  placementPlayed: number;
  loading: boolean;
  labels: RankBadgeStatsLabels;
}) {
  const theme = tierTheme(tier);
  const isPlacementPhase = placementPlayed < 5;
  const apex = isApex(tier);

  // Affichage du sous-titre : placement / LP / non classé
  const subtitle = isPlacementPhase
    ? labels.placementProgress(placementPlayed)
    : tier === "unranked"
      ? labels.unranked
      : apex
        ? labels.apexLpLabel(lp)
        : labels.lpBarLabel(lp);

  return (
    <div
      className="rank-hero-badge relative flex shrink-0 flex-col items-center gap-1 self-center sm:self-end"
      style={{ animation: "update-page-in 0.55s ease-out 0.15s both" }}
    >
      {/* Aura de rang */}
      <div
        className="pointer-events-none absolute -inset-3 -z-10 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${theme.glow}, transparent 70%)` }}
        aria-hidden
      />
      {/* Icône rank */}
      <div
        className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 bg-gradient-to-br from-white/[0.05] to-transparent p-1 shadow-[0_6px_24px_-6px_rgba(0,0,0,0.6)]"
        style={{
          borderColor: theme.accent + "60",
          boxShadow: `0 8px 28px -8px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.08)`,
        }}
      >
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-full bg-white/[0.06]" />
        ) : (
          <img
            src={tierIconUrl(isPlacementPhase ? "unranked" : tier)}
            alt={tierLabel(tier)}
            className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
          />
        )}
      </div>
      {/* Tier label */}
      <div
        className="text-[13px] font-bold uppercase tracking-[0.18em]"
        style={{ color: theme.accent, textShadow: `0 0 12px ${theme.glow}` }}
      >
        {loading ? (
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-white/10" />
        ) : isPlacementPhase ? (
          labels.placementTitle
        ) : (
          tierLabel(tier)
        )}
      </div>
      {/* Sous-titre : LP / placement / MMR */}
      {!loading && (
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-[10px] font-semibold tracking-wider text-white/70">
            {subtitle}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-white/35">
            {labels.mmrLabel(mmr)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Grande carte : icône à gauche, nom + barre de LP + MMR. Affichée en haut
 * de la section ranked du profil.
 */
function RankDisplayCard({
  tier,
  lp,
  mmr,
  placementPlayed,
  placementWins,
  loading,
  labels,
}: {
  tier: RankTier;
  lp: number;
  mmr: number;
  placementPlayed: number;
  placementWins: number;
  loading: boolean;
  labels: RankBadgeStatsLabels;
}) {
  const theme = tierTheme(tier);
  const isPlacementPhase = placementPlayed < 5;
  const apex = isApex(tier);
  const iconTier = isPlacementPhase ? "unranked" : tier;

  return (
    <div
      className="rank-card relative overflow-hidden rounded-2xl border p-5 ring-1 ring-inset backdrop-blur-sm"
      style={{
        borderColor: theme.accent + "40",
        background: `linear-gradient(135deg, ${theme.glow} 0%, rgba(10,16,32,0.2) 35%, transparent 80%)`,
        boxShadow: `0 18px 42px -16px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Coin d'accent en haut à droite */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl"
        style={{ background: theme.glow, opacity: 0.8 }}
        aria-hidden
      />
      {/* Shine animé en haut */}
      <div
        className="rank-card-shine pointer-events-none absolute inset-x-0 top-0 h-full opacity-70"
        aria-hidden
      />

      <div className="relative flex items-center gap-4 sm:gap-5">
        {/* Icône SVG (grande) */}
        <div className="relative shrink-0">
          <div
            className="relative flex h-24 w-24 items-center justify-center rounded-2xl border-2 bg-gradient-to-br from-white/[0.06] to-transparent p-1.5"
            style={{
              borderColor: theme.accent + "55",
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -10px ${theme.glowStrong}`,
            }}
          >
            {loading ? (
              <div className="h-full w-full animate-pulse rounded-xl bg-white/[0.06]" />
            ) : (
              <img
                src={tierIconUrl(iconTier)}
                alt={tierLabel(tier)}
                className="rank-card-icon h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
              />
            )}
          </div>
        </div>

        {/* Nom + barre LP + MMR */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {loading ? (
            <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
          ) : (
            <div className="flex items-baseline gap-2">
              <h3
                className="text-xl font-extrabold tracking-tight sm:text-2xl"
                style={{
                  color: theme.accent,
                  textShadow: `0 0 16px ${theme.glow}`,
                }}
              >
                {isPlacementPhase ? labels.placementTitle : tierLabel(tier)}
              </h3>
              {apex && !isPlacementPhase && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200/60">
                  APEX
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          {!loading && (
            isPlacementPhase ? (
              <PlacementBar
                played={placementPlayed}
                wins={placementWins}
                theme={theme}
                labels={labels}
              />
            ) : tier === "unranked" ? (
              <div className="text-[11px] italic text-white/40">
                {labels.rankedEmptyHint}
              </div>
            ) : apex ? (
              <ApexLpDisplay lp={lp} theme={theme} labels={labels} />
            ) : (
              <LpBar lp={lp} theme={theme} labels={labels} />
            )
          )}

          {/* MMR bottom line */}
          {!loading && (
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
              <span className="text-white/35">{labels.mmrLabel(mmr)}</span>
              {isPlacementPhase && (
                <span className="text-amber-200/55">{labels.placementHint}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Barre de LP 0 → 100 avec marqueurs aux quarts. */
function LpBar({
  lp,
  theme,
  labels,
}: {
  lp: number;
  theme: ReturnType<typeof tierTheme>;
  labels: RankBadgeStatsLabels;
}) {
  const pct = Math.max(0, Math.min(100, lp));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 w-full overflow-hidden rounded-full border border-white/[0.08] bg-black/30 shadow-[inset_0_1px_0_rgba(0,0,0,0.4)]">
        {/* Fill */}
        <div
          className="lp-bar-fill absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${theme.barFrom}, ${theme.barTo})`,
            boxShadow: `0 0 12px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.2)`,
          }}
        />
        {/* Quarter markers (25/50/75) */}
        {[25, 50, 75].map((t) => (
          <span
            key={t}
            className="absolute top-0 h-full w-px bg-white/[0.12]"
            style={{ left: `${t}%` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
        <span style={{ color: theme.accent }}>{labels.lpBarLabel(lp)}</span>
      </div>
    </div>
  );
}

/** Affichage LP en apex (pas de barre, juste le nombre). */
function ApexLpDisplay({
  lp,
  theme,
  labels,
}: {
  lp: number;
  theme: ReturnType<typeof tierTheme>;
  labels: RankBadgeStatsLabels;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 self-start rounded-lg border px-3 py-1"
      style={{
        borderColor: theme.accent + "45",
        background: `linear-gradient(135deg, ${theme.glow} 0%, transparent 100%)`,
      }}
    >
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: theme.accent }}>
        {labels.apexLpLabel(lp)}
      </span>
    </div>
  );
}

/** Barre segmentée 5 cases pour la phase placement. */
function PlacementBar({
  played,
  wins,
  theme,
  labels,
}: {
  played: number;
  wins: number;
  theme: ReturnType<typeof tierTheme>;
  labels: RankBadgeStatsLabels;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => {
          const done = i < played;
          const isWin = i < wins;
          return (
            <div
              key={i}
              className="relative h-2.5 flex-1 overflow-hidden rounded-full border border-white/[0.06] bg-black/30"
            >
              {done && (
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: isWin
                      ? "linear-gradient(90deg, #34D399, #10B981)"
                      : "linear-gradient(90deg, #F87171, #991B1B)",
                    boxShadow: isWin
                      ? "0 0 10px rgba(16,185,129,0.55)"
                      : "0 0 10px rgba(239,68,68,0.45)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
        <span style={{ color: theme.accent }}>
          {labels.placementProgress(played)}
        </span>
        <span className="text-white/40">
          {wins}W · {played - wins}L
        </span>
      </div>
    </div>
  );
}

/* ───────────────── Stat Tile ───────────────── */

function StatTile({
  icon,
  iconColor,
  glowColor,
  label,
  value,
  hint,
  premium = false,
}: {
  icon: React.ReactNode;
  iconColor: string;
  glowColor: string;
  label: string;
  value: string | null;
  hint?: string;
  /** Style or pour la tuile ELO (section ranked). */
  premium?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-5 ring-1 ring-inset backdrop-blur-sm transition hover:-translate-y-0.5 ${
        premium
          ? "border-amber-400/25 bg-gradient-to-br from-amber-500/[0.06] via-white/[0.02] to-transparent ring-amber-300/[0.08] hover:border-amber-300/40 hover:shadow-[0_14px_30px_-12px_rgba(245,158,11,0.45)]"
          : "border-white/[0.08] bg-white/[0.03] ring-white/[0.04] hover:border-white/15 hover:bg-white/[0.05]"
      }`}
    >
      {/* Glow coin sup droit */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: glowColor, opacity: premium ? 0.9 : 0.75 }}
        aria-hidden
      />
      {/* Shimmer discret pour le tile premium */}
      {premium && (
        <div
          className="stat-tile-shimmer pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100"
          aria-hidden
        />
      )}
      <div className="relative mb-3 flex items-center justify-between">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${
            premium ? "text-amber-100/70" : "text-white/45"
          }`}
        >
          {label}
        </span>
        <span className={`text-base opacity-80 ${iconColor}`}>{icon}</span>
      </div>
      {value === null ? (
        <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.08]" />
      ) : (
        <div className="relative flex items-baseline gap-2">
          <span
            className={`text-[22px] font-bold tracking-tight ${
              premium ? "text-amber-50" : "text-white"
            }`}
            style={
              premium
                ? { textShadow: "0 0 18px rgba(245,158,11,0.35)" }
                : undefined
            }
          >
            {value}
          </span>
          {hint && (
            <span
              className={`text-[11px] font-medium ${
                premium ? "text-amber-200/55" : "text-white/40"
              }`}
            >
              {hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  color = "slate",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: "slate" | "emerald" | "amber";
}) {
  const activeClass =
    color === "emerald"
      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
      : color === "amber"
        ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
        : "bg-white/[0.08] text-white ring-1 ring-white/15";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
        active ? activeClass : "text-white/45 hover:text-white/75"
      }`}
    >
      {label}
    </button>
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; text: string; ring: string; label: string }> = {
    admin: { bg: "bg-rose-500/15", text: "text-rose-200", ring: "ring-rose-400/35", label: "ADMIN" },
    devteam: {
      bg: "bg-violet-500/15",
      text: "text-violet-200",
      ring: "ring-violet-400/35",
      label: "DEV",
    },
    patreon: {
      bg: "bg-orange-500/15",
      text: "text-orange-200",
      ring: "ring-orange-400/35",
      label: "PATREON",
    },
    vip: {
      bg: "bg-yellow-500/15",
      text: "text-yellow-200",
      ring: "ring-yellow-400/35",
      label: "VIP",
    },
  };
  const s = styles[role] ?? {
    bg: "bg-white/10",
    text: "text-white/70",
    ring: "ring-white/15",
    label: role.toUpperCase(),
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ${s.bg} ${s.text} ${s.ring}`}
    >
      {s.label}
    </span>
  );
}

function MatchCard({
  match,
  labels,
  onViewOpponent,
  index = 0,
  speciesNames,
  skillNames,
}: {
  match: BattleResultEntry;
  labels: BattleTowerProfileLabels;
  onViewOpponent?: (opponentId: string) => void;
  index?: number;
  speciesNames: string[] | null;
  skillNames: string[] | null;
}) {
  const resultConfig =
    match.result === "win"
      ? {
          borderColor: "border-emerald-400/35",
          ringColor: "ring-emerald-300/10",
          accentFrom: "rgba(110,231,183,0.95)",
          accentTo: "rgba(5,150,105,0.95)",
          glow: "rgba(52,211,153,0.18)",
          softGlow: "rgba(52,211,153,0.10)",
          pulseGlow: "rgba(16,185,129,0.55)",
          label: labels.history.resultWin,
          labelClass: "text-emerald-200",
          labelShadow: "0 0 24px rgba(16,185,129,0.35)",
          icon: <FaTrophy />,
          iconColor: "text-emerald-200",
          medalGradient: "from-emerald-400/35 via-emerald-500/15 to-emerald-700/5",
          medalRing: "ring-emerald-300/45",
          animatedMedal: true,
        }
      : match.result === "loss"
        ? {
            borderColor: "border-rose-400/35",
            ringColor: "ring-rose-300/10",
            accentFrom: "rgba(253,164,175,0.95)",
            accentTo: "rgba(190,18,60,0.95)",
            glow: "rgba(244,63,94,0.18)",
            softGlow: "rgba(244,63,94,0.10)",
            pulseGlow: "rgba(244,63,94,0.55)",
            label: labels.history.resultLoss,
            labelClass: "text-rose-200",
            labelShadow: "0 0 24px rgba(244,63,94,0.35)",
            icon: <FaSkull />,
            iconColor: "text-rose-200",
            medalGradient: "from-rose-400/35 via-rose-500/15 to-rose-700/5",
            medalRing: "ring-rose-300/45",
            animatedMedal: false,
          }
        : {
            borderColor: "border-amber-400/35",
            ringColor: "ring-amber-300/10",
            accentFrom: "rgba(253,224,71,0.95)",
            accentTo: "rgba(180,83,9,0.95)",
            glow: "rgba(245,158,11,0.18)",
            softGlow: "rgba(245,158,11,0.10)",
            pulseGlow: "rgba(245,158,11,0.55)",
            label: labels.history.resultDraw,
            labelClass: "text-amber-200",
            labelShadow: "0 0 24px rgba(245,158,11,0.35)",
            icon: <FaHandshake />,
            iconColor: "text-amber-200",
            medalGradient: "from-amber-400/35 via-amber-500/15 to-amber-700/5",
            medalRing: "ring-amber-300/45",
            animatedMedal: false,
          };

  const matchType = match.match_type ?? "amical";
  const typeLabel =
    matchType === "ranked" ? labels.history.typeRanked : labels.history.typeAmical;
  const typeClass =
    matchType === "ranked"
      ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
      : "border-sky-400/30 bg-sky-500/10 text-sky-200";

  const timeAgo = formatTimeAgo(match.created_at, labels.history);
  const duration = formatDuration(match.duration_sec);

  const myTeam: BattleTeamSnapshot[] = Array.isArray(match.my_team) ? match.my_team : [];
  const oppTeam: BattleTeamSnapshot[] = Array.isArray(match.opponent_team)
    ? match.opponent_team
    : [];
  const hasAnyTeam = myTeam.length > 0 || oppTeam.length > 0;
  const opponentName = match.opponent_name || labels.anonymous;
  const myWon = match.result === "win";
  const myLost = match.result === "loss";
  const isBet = !!match.bet_mode;
  const myBet = (match.bet_pokemon_preview ?? null) as BetPokemonPreview | null;
  const oppBet = (match.opponent_bet_preview ?? null) as BetPokemonPreview | null;

  return (
    <li
      className={`match-card group relative overflow-hidden rounded-2xl border ${resultConfig.borderColor} bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent ring-1 ring-inset ${resultConfig.ringColor} backdrop-blur-sm transition duration-300 hover:-translate-y-[3px] hover:border-white/25 hover:shadow-[0_18px_40px_-14px_rgba(0,0,0,0.75)] ${
        isBet ? "match-bet-sheen" : ""
      }`}
      style={{ animation: `match-card-in 0.45s ease-out ${Math.min(index * 0.04, 0.4)}s both` }}
    >
      {/* Barre d'accent à gauche + shimmer au hover */}
      <div
        className="pointer-events-none absolute left-0 top-0 h-full w-[5px] overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(180deg, ${resultConfig.accentFrom}, ${resultConfig.accentTo})`,
        }}
        aria-hidden
      >
        <div
          className="match-accent-shine absolute inset-x-0 h-[40%] bg-gradient-to-b from-white/50 via-white/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
      </div>

      {/* Glow ambient dans le coin */}
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: resultConfig.softGlow, opacity: 0.7 }}
        aria-hidden
      />

      <div className="relative flex flex-col gap-3.5 py-4 pl-7 pr-5">
        {/* Header : Medal + result + opponent + métas */}
        <div className="flex items-center gap-3.5 sm:gap-4">
          {/* Medal (icône circulaire rayonnante) */}
          <div className="relative shrink-0">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${resultConfig.medalGradient} ring-2 ${resultConfig.medalRing} shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_rgba(0,0,0,0.45)]`}
              style={{
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 22px -6px ${resultConfig.glow}`,
              }}
            >
              <span className={`text-[18px] ${resultConfig.iconColor}`}>{resultConfig.icon}</span>
            </div>
            {resultConfig.animatedMedal && (
              <span
                className="match-medal-halo pointer-events-none absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 18px ${resultConfig.pulseGlow}` }}
                aria-hidden
              />
            )}
          </div>

          {/* Result + opponent + meta */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span
                className={`text-[17px] font-extrabold tracking-tight ${resultConfig.labelClass}`}
                style={{ textShadow: resultConfig.labelShadow }}
              >
                {resultConfig.label}
              </span>
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/30">
                  {labels.history.vs}
                </span>
                {onViewOpponent && match.opponent_id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewOpponent(match.opponent_id);
                    }}
                    className="truncate text-[13.5px] font-semibold text-white/90 transition hover:text-amber-200 hover:underline hover:underline-offset-2"
                  >
                    {opponentName}
                  </button>
                ) : (
                  <span className="truncate text-[13.5px] font-semibold text-white/90">
                    {opponentName}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${typeClass}`}
              >
                {matchType === "ranked" ? (
                  <FaCrown className="text-[8px]" />
                ) : (
                  <FaHandshake className="text-[8px]" />
                )}
                {typeLabel}
              </span>
              {isBet && (
                <span
                  className="match-bet-pill inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-amber-400/20 to-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200 shadow-[0_0_12px_-4px_rgba(245,158,11,0.55)]"
                  title={labels.history.betBadge}
                >
                  <FaGem className="text-[8px] text-amber-300" />
                  {labels.history.betBadge}
                </span>
              )}
              <span className="text-white/20">·</span>
              <span className="flex items-center gap-1">
                <FaClock className="text-[9px]" />
                {timeAgo}
              </span>
              {duration && (
                <>
                  <span className="text-white/20">·</span>
                  <span>{duration}</span>
                </>
              )}
              {matchType === "ranked" && match.lp_delta != null && (
                <>
                  <span className="text-white/20">·</span>
                  <LpDelta delta={match.lp_delta} labels={labels} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bet info : affiché seulement si c'était un match avec pari */}
        {isBet && (
          <BetInfoStrip
            won={myWon}
            lost={myLost}
            myBet={myBet}
            oppBet={oppBet}
            labels={labels}
            speciesNames={speciesNames}
            skillNames={skillNames}
          />
        )}

        {/* Panneau arène : 2 équipes côte à côte avec VS au milieu */}
        {hasAnyTeam && (
          <div className="relative flex items-center justify-center gap-3 rounded-xl border border-white/[0.05] bg-black/20 px-3 py-3 ring-1 ring-inset ring-white/[0.02] sm:gap-4">
            {/* Mon équipe (gauche) */}
            <TeamStack
              team={myTeam}
              align="right"
              highlight={myWon}
              dim={myLost}
              label={labels.history.youLabel}
              resultLabelClass={resultConfig.labelClass}
              glowColor={resultConfig.pulseGlow}
              teamUnknown={labels.history.teamUnknown}
              speciesNames={speciesNames}
            />

            {/* VS orb central */}
            <div className="relative flex shrink-0 flex-col items-center gap-1 px-0.5">
              <div
                className={`relative flex h-11 w-11 items-center justify-center rounded-full border ${resultConfig.borderColor} bg-[#0a1020]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_6px_18px_rgba(0,0,0,0.55)]`}
                style={{
                  backgroundImage: `radial-gradient(circle at center, ${resultConfig.glow}, transparent 72%)`,
                }}
              >
                <FaBoltLightning className={`text-[13px] ${resultConfig.labelClass}`} />
                <span
                  className="match-vs-ring pointer-events-none absolute inset-[-3px] rounded-full"
                  aria-hidden
                  style={{ boxShadow: `0 0 0 2px ${resultConfig.pulseGlow}` }}
                />
              </div>
              <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/35">
                {labels.history.vs}
              </span>
            </div>

            {/* Équipe adverse (droite) */}
            <TeamStack
              team={oppTeam}
              align="left"
              highlight={myLost}
              dim={myWon}
              label={opponentName}
              resultLabelClass={resultConfig.labelClass}
              glowColor={resultConfig.pulseGlow}
              teamUnknown={labels.history.teamUnknown}
              truncate
              speciesNames={speciesNames}
            />
          </div>
        )}
      </div>
    </li>
  );
}

function TeamStack({
  team,
  align,
  highlight,
  dim,
  label,
  resultLabelClass,
  glowColor,
  teamUnknown,
  truncate,
  speciesNames,
}: {
  team: BattleTeamSnapshot[];
  align: "left" | "right";
  highlight: boolean;
  dim: boolean;
  label: string;
  resultLabelClass: string;
  glowColor: string;
  teamUnknown: string;
  truncate?: boolean;
  speciesNames: string[] | null;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 ${align === "right" ? "items-end" : "items-start"}`}
    >
      <span
        className={`${truncate ? "max-w-[140px] truncate" : ""} text-[9px] font-bold uppercase tracking-wider ${
          highlight ? resultLabelClass : "text-white/35"
        }`}
      >
        {label}
      </span>
      <div
        className={`flex items-center gap-1 sm:gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}
      >
        {team.length > 0 ? (
          team
            .slice(0, 6)
            .map((mon, idx) => (
              <MonSlot
                key={`${align}-${mon.code}-${idx}`}
                mon={mon}
                highlight={highlight}
                dim={dim}
                glowColor={glowColor}
                speciesNames={speciesNames}
              />
            ))
        ) : (
          <span className="text-[10px] italic text-white/25">{teamUnknown}</span>
        )}
      </div>
    </div>
  );
}

function BetInfoStrip({
  won,
  lost,
  myBet,
  oppBet,
  labels,
  speciesNames,
  skillNames,
}: {
  won: boolean;
  lost: boolean;
  myBet: BetPokemonPreview | null;
  oppBet: BetPokemonPreview | null;
  labels: BattleTowerProfileLabels;
  speciesNames: string[] | null;
  skillNames: string[] | null;
}) {
  // On affiche TOUJOURS les deux Pokémon misés, avec mise en avant de celui
  // qui a été transféré selon le résultat :
  //  - win  → le Pokémon adverse (droite) est surligné, le mien (gauche) est neutre.
  //  - loss → le mien (gauche) est surligné en rouge, l'adverse (droite) est neutre.
  //  - draw → les deux sont neutres.
  const isDraw = !won && !lost;

  const title = won
    ? labels.history.betWon
    : lost
      ? labels.history.betLost
      : labels.history.betDraw;

  const titleClass = won
    ? "text-emerald-200"
    : lost
      ? "text-rose-200"
      : "text-amber-200";

  const accentBg = won
    ? "from-emerald-500/10 via-amber-400/10 to-amber-500/10"
    : lost
      ? "from-rose-500/10 via-amber-400/10 to-amber-500/10"
      : "from-amber-500/10 via-amber-400/5 to-amber-500/10";

  // Flèche de transfert : direction selon le résultat.
  //  - loss → "→" (mon Pokémon part chez l'adversaire)
  //  - win  → "←" (le Pokémon adverse arrive chez moi)
  //  - draw → "⇆" (aucun transfert)
  const arrow = won ? "←" : lost ? "→" : "⇆";
  const arrowClass = won
    ? "text-emerald-200"
    : lost
      ? "text-rose-200"
      : "text-amber-200";
  const arrowBorderClass = won
    ? "border-emerald-400/45"
    : lost
      ? "border-rose-400/45"
      : "border-amber-400/40";
  const arrowGlow = won
    ? "rgba(16,185,129,0.55)"
    : lost
      ? "rgba(244,63,94,0.55)"
      : "rgba(245,158,11,0.45)";
  const arrowSoftGlow = won
    ? "rgba(52,211,153,0.22)"
    : lost
      ? "rgba(244,63,94,0.22)"
      : "rgba(245,158,11,0.20)";
  const arrowAnim = won
    ? "match-bet-arrow-left"
    : lost
      ? "match-bet-arrow-right"
      : "match-bet-arrow-swap";

  return (
    <div
      className={`relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-amber-400/20 bg-gradient-to-r ${accentBg} px-3 py-2 ring-1 ring-inset ring-amber-400/10`}
    >
      {/* Header : gemme + titre, inline au-dessus des Pokémon */}
      <div className="flex items-center gap-2">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-400/30 bg-amber-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <FaGem
            className="text-[11px] text-amber-300 drop-shadow-[0_0_6px_rgba(245,158,11,0.55)]"
            style={{ animation: "bet-float 3s ease-in-out infinite" }}
          />
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${titleClass}`}>
          {title}
        </span>
      </div>

      {/* Les deux Pokémon — flèche au vrai centre du card (aligné avec la VS orb plus bas) */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Mon Pokémon misé */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BetMonThumb
            bet={myBet}
            highlight={lost}
            muted={won || isDraw}
            speciesNames={speciesNames}
            skillNames={skillNames}
          />
          <BetMonLabel bet={myBet} labels={labels} speciesNames={speciesNames} />
        </div>

        {/* Flèche centrale : badge circulaire coloré, centré sur le card */}
        <div
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${arrowBorderClass} bg-gradient-to-br from-[#0a1020]/95 to-[#0a1020]/75 shadow-[0_6px_14px_rgba(0,0,0,0.55)]`}
          style={{
            backgroundImage: `radial-gradient(circle at center, ${arrowSoftGlow}, transparent 72%)`,
          }}
          title={
            won
              ? labels.history.betWon
              : lost
                ? labels.history.betLost
                : labels.history.betDraw
          }
          aria-hidden
        >
          <span
            className={`text-[15px] font-extrabold leading-none ${arrowClass}`}
            style={{
              textShadow: `0 0 10px ${arrowGlow}`,
              animation: `${arrowAnim} 1.8s ease-in-out infinite`,
              display: "inline-block",
            }}
          >
            {arrow}
          </span>
          <span
            className="match-bet-arrow-ring pointer-events-none absolute inset-[-3px] rounded-full"
            style={{ boxShadow: `0 0 0 2px ${arrowGlow}` }}
            aria-hidden
          />
        </div>

        {/* Pokémon misé adverse */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <BetMonLabel bet={oppBet} labels={labels} speciesNames={speciesNames} align="right" />
          <BetMonThumb
            bet={oppBet}
            highlight={won}
            muted={lost || isDraw}
            speciesNames={speciesNames}
            skillNames={skillNames}
          />
        </div>
      </div>
    </div>
  );
}

function BetMonLabel({
  bet,
  labels,
  speciesNames,
  align = "left",
}: {
  bet: BetPokemonPreview | null;
  labels: BattleTowerProfileLabels;
  speciesNames: string[] | null;
  align?: "left" | "right";
}) {
  if (!bet) {
    return (
      <span
        className={`truncate text-[12px] italic text-white/30 ${
          align === "right" ? "text-right" : ""
        }`}
      >
        {labels.history.betUnknown}
      </span>
    );
  }
  const speciesId = typeof bet.speciesId === "number" ? bet.speciesId : null;
  const resolvedSpecies =
    speciesNames && speciesId != null && speciesId > 0 && speciesId < speciesNames.length
      ? speciesNames[speciesId]?.trim() || null
      : null;
  const rawName =
    typeof bet.name === "string" && bet.name.trim() ? bet.name.trim() : null;
  // `bet_pokemon_preview.name` est un placeholder générique ("Pokémon"),
  // on privilégie le nickname puis le nom résolu via PSDK.
  const displayName =
    (typeof bet.nickname === "string" && bet.nickname.trim()) ||
    resolvedSpecies ||
    (rawName && rawName !== "Pokémon" ? rawName : null) ||
    (speciesId != null ? `#${String(speciesId).padStart(3, "0")}` : labels.history.betUnknown);
  const level = typeof bet.level === "number" ? bet.level : null;
  const shiny = !!(bet.shiny || bet.altShiny);
  return (
    <div
      className={`flex min-w-0 items-baseline gap-1.5 ${align === "right" ? "justify-end" : ""}`}
    >
      <span className="truncate text-[13px] font-semibold text-white/90">{displayName}</span>
      {level != null && (
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-white/40">
          Lv.{level}
        </span>
      )}
      {shiny && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.85)]"
          aria-label="shiny"
        />
      )}
    </div>
  );
}

function BetMonThumb({
  bet,
  highlight,
  muted,
  speciesNames,
  skillNames,
}: {
  bet: BetPokemonPreview | null;
  highlight?: boolean;
  muted?: boolean;
  speciesNames?: string[] | null;
  skillNames?: string[] | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const speciesId = typeof bet?.speciesId === "number" ? bet.speciesId : null;
  const form = typeof bet?.form === "number" ? bet.form : null;
  const shiny = !!(bet?.shiny || bet?.altShiny);

  useEffect(() => {
    let active = true;
    if (speciesId == null) return;
    (async () => {
      try {
        const r = await invoke<string | null>("cmd_get_normal_sprite", {
          speciesId,
          form,
        });
        if (active && r) setSrc(r);
      } catch {
        /* fail silent */
      }
    })();
    return () => {
      active = false;
    };
  }, [speciesId, form]);

  return (
    <div
      ref={anchorRef}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-gradient-to-br from-amber-500/10 to-amber-600/[0.03] ring-1 ring-inset transition ${
        highlight
          ? "border-amber-300/40 ring-amber-300/20"
          : "border-amber-400/20 ring-amber-400/10"
      }`}
      style={{
        boxShadow: highlight
          ? "0 0 18px -4px rgba(245,158,11,0.55), inset 0 0 0 1px rgba(255,255,255,0.04)"
          : undefined,
        filter: muted ? "saturate(0.55) brightness(0.78)" : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain"
          style={{ imageRendering: "pixelated" as any }}
        />
      ) : (
        <span className="text-[9px] font-bold text-amber-200/60">
          {speciesId != null ? `#${String(speciesId).padStart(3, "0")}` : "?"}
        </span>
      )}
      {shiny && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_4px_rgba(252,211,77,0.8)]" />
      )}
      {hovered && bet && (
        <HoverTooltip anchor={anchorRef.current}>
          <BetTooltipContent
            spriteUrl={src}
            bet={bet}
            speciesNames={speciesNames ?? null}
            skillNames={skillNames ?? null}
          />
        </HoverTooltip>
      )}
    </div>
  );
}

function LpDelta({
  delta,
  labels,
}: {
  delta: number;
  labels: BattleTowerProfileLabels;
}) {
  if (delta > 0) {
    return (
      <span className="font-bold text-emerald-300">
        {labels.history.lpGain(delta)}
      </span>
    );
  }
  if (delta < 0) {
    return <span className="font-bold text-rose-300">{labels.history.lpLoss(-delta)}</span>;
  }
  return <span className="text-white/45">{labels.history.lpZero}</span>;
}

function MonSlot({
  mon,
  highlight,
  dim,
  glowColor,
  speciesNames,
}: {
  mon: BattleTeamSnapshot;
  highlight?: boolean;
  dim?: boolean;
  glowColor?: string;
  speciesNames?: string[] | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await invoke<string | null>("cmd_get_normal_sprite", {
          speciesId: mon.code,
          form: mon.form ?? null,
        });
        if (active && r) setSrc(r);
      } catch {
        /* fail silent */
      }
    })();
    return () => {
      active = false;
    };
  }, [mon.code, mon.form]);

  const resolvedSpecies =
    speciesNames && mon.code > 0 && mon.code < speciesNames.length
      ? speciesNames[mon.code]?.trim() || null
      : null;
  const speciesLabel = resolvedSpecies || mon.speciesName || null;
  const title = mon.nickname || speciesLabel || `#${mon.code}`;

  return (
    <div
      ref={anchorRef}
      className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-inset transition-all duration-300 sm:h-11 sm:w-11 ${
        highlight
          ? "border-white/20 ring-white/10"
          : "border-white/[0.08] ring-white/[0.05] group-hover:border-white/15"
      }`}
      style={{
        boxShadow:
          highlight && glowColor
            ? `0 0 14px -2px ${glowColor}, inset 0 0 0 1px rgba(255,255,255,0.04)`
            : undefined,
        filter: dim ? "saturate(0.55) brightness(0.78)" : undefined,
      }}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain"
          style={{ imageRendering: "pixelated" as any }}
        />
      ) : (
        <span className="text-[9px] font-bold text-white/25">
          #{String(mon.code).padStart(3, "0")}
        </span>
      )}
      {mon.isShiny && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_4px_rgba(252,211,77,0.8)]" />
      )}
      {hovered && (
        <HoverTooltip anchor={anchorRef.current}>
          <MonTooltipContent
            spriteUrl={src}
            nickname={mon.nickname}
            speciesLabel={speciesLabel}
            level={mon.level}
            form={mon.form}
            isShiny={mon.isShiny}
          />
        </HoverTooltip>
      )}
    </div>
  );
}

/* ──────────────────────────── Hover Tooltips ──────────────────────────── */

/**
 * Tooltip portalisé au-dessus d'un élément ancre.
 * Se repositionne au scroll/resize pour suivre l'ancre.
 * Rendu via `createPortal` pour échapper aux `overflow:hidden` des cartes.
 */
function HoverTooltip({
  anchor,
  children,
}: {
  anchor: HTMLElement | null;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      setPos({ top: r.top - 10, left: r.left + r.width / 2 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  if (!pos) return null;
  // Clamp au viewport pour éviter que le tooltip sorte à gauche/droite
  const clampedLeft = Math.max(180, Math.min(pos.left, window.innerWidth - 180));
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        top: pos.top,
        left: clampedLeft,
        transform: "translate(-50%, -100%)",
        animation: "match-tooltip-in 0.14s ease-out both",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function MonTooltipContent({
  spriteUrl,
  nickname,
  speciesLabel,
  level,
  form,
  isShiny,
}: {
  spriteUrl: string | null;
  nickname: string | null;
  speciesLabel: string | null;
  level: number | null;
  form: number | null;
  isShiny: boolean | null;
}) {
  const displayName = nickname || speciesLabel || "?";
  const subtitle = nickname && speciesLabel && nickname !== speciesLabel ? speciesLabel : null;
  return (
    <div className="w-[220px] rounded-xl border border-white/10 bg-[#0a1020]/95 p-3 shadow-[0_18px_44px_-8px_rgba(0,0,0,0.8)] backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02]">
          {spriteUrl ? (
            <img
              src={spriteUrl}
              alt=""
              className="h-full w-full object-contain"
              style={{ imageRendering: "pixelated" as any }}
            />
          ) : (
            <span className="text-[10px] text-white/40">?</span>
          )}
          {isShiny && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_5px_rgba(252,211,77,0.85)]" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-bold text-white">{displayName}</span>
            {isShiny && <span className="text-[10px] text-amber-300">✨</span>}
          </div>
          {subtitle && (
            <span className="truncate text-[10px] italic text-white/45">{subtitle}</span>
          )}
          <div className="flex items-center gap-2 text-[10px] text-white/55">
            {level != null && <span>Lv.{level}</span>}
            {form != null && form > 0 && <span className="text-white/35">· Forme {form}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BetTooltipContent({
  spriteUrl,
  bet,
  speciesNames,
  skillNames,
}: {
  spriteUrl: string | null;
  bet: BetPokemonPreview;
  speciesNames: string[] | null;
  skillNames: string[] | null;
}) {
  const speciesId = typeof bet.speciesId === "number" ? bet.speciesId : null;
  const resolvedSpecies =
    speciesNames && speciesId != null && speciesId > 0 && speciesId < speciesNames.length
      ? speciesNames[speciesId]?.trim() || null
      : null;
  const rawName = typeof bet.name === "string" && bet.name.trim() ? bet.name.trim() : null;
  const displayName =
    (typeof bet.nickname === "string" && bet.nickname.trim()) ||
    resolvedSpecies ||
    (rawName && rawName !== "Pokémon" ? rawName : null) ||
    (speciesId != null ? `#${String(speciesId).padStart(3, "0")}` : "?");
  const subtitle =
    typeof bet.nickname === "string" && bet.nickname.trim() && resolvedSpecies
      ? resolvedSpecies
      : null;
  const level = typeof bet.level === "number" ? bet.level : null;
  const shiny = !!(bet.shiny || bet.altShiny);
  const gender = typeof bet.gender === "number" ? bet.gender : null;
  const natureIdx = typeof bet.nature === "number" ? bet.nature : null;
  const natureName =
    natureIdx != null && natureIdx >= 0 && natureIdx < NATURE_FR.length
      ? NATURE_FR[natureIdx]
      : null;

  const ivRaw = [
    { key: "HP", v: typeof bet.ivHp === "number" ? bet.ivHp : null },
    { key: "Atk", v: typeof bet.ivAtk === "number" ? bet.ivAtk : null },
    { key: "Def", v: typeof bet.ivDfe === "number" ? bet.ivDfe : null },
    { key: "SpA", v: typeof bet.ivAts === "number" ? bet.ivAts : null },
    { key: "SpD", v: typeof bet.ivDfs === "number" ? bet.ivDfs : null },
    { key: "Vit", v: typeof bet.ivSpd === "number" ? bet.ivSpd : null },
  ];
  const hasIvs = ivRaw.some((r) => r.v != null);
  const ivTotal = hasIvs ? ivRaw.reduce((s, r) => s + (r.v ?? 0), 0) : null;

  const moves = Array.isArray(bet.moves) ? (bet.moves as unknown as number[]) : [];

  return (
    <div className="w-[280px] rounded-xl border border-amber-400/25 bg-[#0a1020]/95 p-3 shadow-[0_18px_44px_-8px_rgba(0,0,0,0.85)] backdrop-blur-sm ring-1 ring-inset ring-amber-400/10">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-400/25 bg-gradient-to-br from-amber-500/10 to-amber-600/[0.03]">
          {spriteUrl ? (
            <img
              src={spriteUrl}
              alt=""
              className="h-full w-full object-contain"
              style={{ imageRendering: "pixelated" as any }}
            />
          ) : (
            <span className="text-[10px] text-amber-200/50">?</span>
          )}
          {shiny && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_5px_rgba(252,211,77,0.85)]" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-bold text-white">{displayName}</span>
            {shiny && <span className="text-[10px] text-amber-300">✨</span>}
          </div>
          {subtitle && (
            <span className="truncate text-[10px] italic text-white/45">{subtitle}</span>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/55">
            {level != null && <span>Lv.{level}</span>}
            {gender != null && (
              <>
                <span className="text-white/25">·</span>
                <span className={gender === 0 ? "text-sky-300" : gender === 1 ? "text-pink-300" : ""}>
                  {gender === 0 ? "♂" : gender === 1 ? "♀" : "—"}
                </span>
              </>
            )}
            {natureName && (
              <>
                <span className="text-white/25">·</span>
                <span className="text-emerald-200/80">{natureName}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* IVs */}
      {hasIvs && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2">
          <div className="mb-1 flex items-baseline justify-between text-[9px] font-bold uppercase tracking-wider">
            <span className="text-amber-200/80">IV</span>
            <span className="text-white/40">
              Σ {ivTotal} <span className="text-white/25">/ 186</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-1">
            {ivRaw.map((row) => {
              const v = row.v ?? 0;
              const pct = Math.min(100, (v / 31) * 100);
              const fill =
                v >= 31
                  ? "bg-amber-400"
                  : v >= 25
                    ? "bg-emerald-400"
                    : v >= 15
                      ? "bg-sky-400"
                      : "bg-rose-400";
              return (
                <div key={row.key} className="flex items-center gap-1.5">
                  <span className="w-6 text-[9px] font-bold uppercase text-white/55">{row.key}</span>
                  <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full ${fill}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-4 text-right text-[9px] font-semibold text-white/75">
                    {row.v != null ? v : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Attaques */}
      {moves.length > 0 && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-200/80">
            Attaques
          </div>
          <div className="flex flex-wrap gap-1">
            {moves.slice(0, 4).map((id, i) => {
              const name = skillNames && skillNames[id] ? skillNames[id] : `#${id}`;
              return (
                <span
                  key={`${id}-${i}`}
                  className="inline-block rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-white/80"
                >
                  {name}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────── Helpers ──────────────────────────── */

function formatTimeAgo(
  iso: string,
  labels: BattleTowerProfileLabels["history"],
): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diff < 60) return labels.timeAgoNow;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return labels.timeAgoMin(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return labels.timeAgoHour(hours);
  const days = Math.floor(hours / 24);
  return labels.timeAgoDay(days);
}

function formatDuration(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
