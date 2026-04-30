// src/views/battleTower/BattleTowerHome.tsx
// Page d'accueil de la Tour de Combat : hero + 2 cards de mode + stats placeholder.
import React, { useRef, useState } from "react";
import {
  FaChartLine,
  FaChevronRight,
  FaCrown,
  FaHandshake,
  FaShieldHalved,
  FaSkull,
  FaTrophy,
  FaCircleInfo,
  FaCircleCheck,
} from "react-icons/fa6";
import { isApex, tierIconUrl, tierLabel, tierTheme, type RankTier } from "../../ranked";
import type { PvpStats } from "../../leaderboard";
import type { TowerConfig } from "../../towerStatus";
import { RankTower } from "./RankTower";

export type BattleTowerHomeLabels = {
  title: string;
  subtitle: string;
  modes: {
    lead: { badge: string; title: string; description: string };
    amical: { badge: string; title: string; description: string };
  };
  statsTitle: string;
  statsPlaceholder: string;
  statsHint: string;
  statLabels: {
    wins: string;
    losses: string;
    winrate: string;
    elo: string;
  };
  info: {
    buttonAria: string;
    title: string;
    subtitle: string;
    accessTitle: string;
    rules: {
      version: string;
      iv: string;
      ev: string;
    };
  };
};

type Props = {
  labels: BattleTowerHomeLabels;
  onNavigate: (page: "lead" | "amical") => void;
  /** Stats PvP du joueur — pour afficher les vraies valeurs et choisir
   *  amical/classé selon que les placements sont terminés. */
  myPvpStats?: PvpStats | null;
  /** Config Tour de Combat (saison courante + annonces) chargée par TowerStatusGate. */
  towerConfig?: TowerConfig | null;
};

export function BattleTowerHome({ labels, onNavigate, myPvpStats, towerConfig }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hover gérée avec petit délai pour éviter flicker quand on traverse l'espace button→tooltip
  const handleEnter = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setShowInfo(true);
  };
  const handleLeave = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowInfo(false), 150);
  };

  return (
    <div className="relative flex flex-col items-center px-6 py-10 sm:px-10 sm:py-14">
      {/* Info button (top-left) avec tooltip au hover */}
      <div
        className="absolute left-4 top-4 z-30 sm:left-6 sm:top-6"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <button
          type="button"
          aria-label={labels.info.buttonAria}
          className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/25 bg-gradient-to-br from-amber-500/[0.12] via-white/[0.04] to-transparent text-amber-200 ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-amber-300/45 hover:bg-amber-500/[0.18] hover:text-amber-100 hover:shadow-[0_10px_30px_-10px_rgba(245,158,11,0.5)]"
        >
          <FaCircleInfo className="text-lg drop-shadow-[0_0_10px_rgba(245,158,11,0.55)]" />
        </button>

        {/* Tooltip overlay */}
        {showInfo && (
          <div
            className="absolute left-0 top-[calc(100%+10px)] w-[min(calc(100vw-3rem),420px)] origin-top-left"
            style={{ animation: "update-page-in 0.2s ease-out both" }}
          >
            {/* Flèche */}
            <div className="absolute -top-[7px] left-4 h-4 w-4 rotate-45 border-l border-t border-amber-400/25 bg-[#141020]" />

            <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-b from-[#1a1226] via-[#130d1f] to-[#0d0918] ring-1 ring-inset ring-amber-300/10 shadow-[0_30px_80px_-20px_rgba(245,158,11,0.4),0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              {/* Corner glow */}
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-400/15 blur-3xl"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl"
                aria-hidden
              />

              {/* Header */}
              <div className="relative border-b border-white/[0.07] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-orange-500/15 ring-1 ring-amber-300/30">
                    <FaShieldHalved className="text-base text-amber-100 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold tracking-tight text-white">
                      {labels.info.title}
                    </h3>
                    <p className="text-[11px] text-white/50">{labels.info.subtitle}</p>
                  </div>
                </div>
              </div>

              {/* Section: Conditions d'accès — règles générales (la banlist
                  est déplacée dans le tooltip Combat Classé puisqu'elle ne
                  s'applique qu'en classé). */}
              <div className="relative px-5 py-4">
                <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-300/90">
                  <FaCircleCheck className="text-[10px]" />
                  {labels.info.accessTitle}
                </h4>
                <ul className="space-y-2 text-[12.5px] text-white/80">
                  <RuleItem text={labels.info.rules.version} />
                  <RuleItem text={labels.info.rules.iv} />
                  <RuleItem text={labels.info.rules.ev} />
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hero header — Tour des Tiers (segments empilés Iron→Challenger,
          étage actif illuminé, particules ascendantes) */}
      <div
        className="mb-12 flex flex-col items-center text-center"
        style={{ animation: "update-page-in 0.5s ease-out both" }}
      >
        <div className="mb-6">
          <RankTower
            size={200}
            tier={(myPvpStats?.battle_rank_tier as RankTier) ?? "unranked"}
            intensity="idle"
          />
        </div>
        <h1 className="mb-3 text-center text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {labels.title}
        </h1>
        <p className="max-w-xl text-center text-sm leading-relaxed text-white/55 sm:text-base">
          {labels.subtitle}
        </p>
      </div>

      {/* Two mode cards */}
      <div
        className="mb-14 grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-2"
        style={{ animation: "update-page-in 0.6s ease-out 0.1s both" }}
      >
        {/* Combat Classé */}
        <button
          type="button"
          onClick={() => onNavigate("lead")}
          className="group relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.12] via-orange-500/[0.06] to-transparent p-7 text-left ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-300/40 hover:from-amber-500/[0.18] hover:to-orange-500/[0.1] hover:shadow-[0_20px_60px_-20px_rgba(245,158,11,0.4)]"
        >
          {/* Corner glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-400/20 blur-3xl transition group-hover:bg-amber-400/35" />

          {/* Badge */}
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              <FaTrophy className="text-[9px]" />
              {labels.modes.lead.badge}
            </span>
            <FaChevronRight className="text-sm text-white/30 transition group-hover:translate-x-1 group-hover:text-amber-200" />
          </div>

          {/* Icon */}
          <div className="relative mt-2">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-orange-500/15 ring-1 ring-amber-300/30">
              <FaCrown className="text-2xl text-amber-100 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
            </div>
          </div>

          {/* Title + description */}
          <div className="relative">
            <h2 className="mb-2 text-2xl font-bold text-white">
              {labels.modes.lead.title}
            </h2>
            <p className="text-sm leading-relaxed text-white/55">
              {labels.modes.lead.description}
            </p>
          </div>
        </button>

        {/* Combat Amical */}
        <button
          type="button"
          onClick={() => onNavigate("amical")}
          className="group relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.12] via-teal-500/[0.06] to-transparent p-7 text-left ring-1 ring-inset ring-emerald-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-300/40 hover:from-emerald-500/[0.18] hover:to-teal-500/[0.1] hover:shadow-[0_20px_60px_-20px_rgba(52,211,153,0.4)]"
        >
          {/* Corner glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl transition group-hover:bg-emerald-400/35" />

          {/* Badge */}
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
              <FaHandshake className="text-[9px]" />
              {labels.modes.amical.badge}
            </span>
            <FaChevronRight className="text-sm text-white/30 transition group-hover:translate-x-1 group-hover:text-emerald-200" />
          </div>

          {/* Icon */}
          <div className="relative mt-2">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/25 to-teal-500/15 ring-1 ring-emerald-300/30">
              <FaHandshake className="text-2xl text-emerald-100 drop-shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
            </div>
          </div>

          {/* Title + description */}
          <div className="relative">
            <h2 className="mb-2 text-2xl font-bold text-white">
              {labels.modes.amical.title}
            </h2>
            <p className="text-sm leading-relaxed text-white/55">
              {labels.modes.amical.description}
            </p>
          </div>
        </button>
      </div>

      {/* Bannière saison + annonces (si configurées côté admin) */}
      <SeasonAnnouncementBanner config={towerConfig} />

      {/* Stats section — ranked si placements terminés, sinon amical */}
      <StatsSection labels={labels} myPvpStats={myPvpStats} />
    </div>
  );
}

/* ─────────────────── Saison & Annonces ─────────────────── */

function SeasonAnnouncementBanner({ config }: { config?: TowerConfig | null }) {
  if (!config) return null;
  const season = config.season;
  const hasSeasonContent =
    !!season &&
    ((season.name && season.name !== "Saison 1") ||
      !!season.startDate ||
      !!season.endDate ||
      (season.description && season.description.trim().length > 0));
  const announcements = (config.announcements || "").trim();
  const hasAnnouncements = announcements.length > 0;

  if (!hasSeasonContent && !hasAnnouncements) return null;

  const fmtDate = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  };
  const startStr = fmtDate(season?.startDate ?? null);
  const endStr = fmtDate(season?.endDate ?? null);

  return (
    <div
      className="mb-10 w-full max-w-4xl"
      style={{ animation: "update-page-in 0.6s ease-out 0.15s both" }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] via-orange-500/[0.04] to-transparent ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm">
        {/* Corner glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-amber-400/15 blur-3xl" />

        {hasSeasonContent && (
          <div className="relative px-6 py-5">
            {/* Bannière saison en background si configurée */}
            {season.bannerUrl && (
              <>
                <div
                  className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-50"
                  style={{ backgroundImage: `url(${season.bannerUrl})` }}
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0d0918] via-[#0d0918]/85 to-[#0d0918]/30"
                  aria-hidden
                />
              </>
            )}
            <div className="relative flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-orange-500/15 ring-1 ring-amber-300/30">
                <FaTrophy className="text-xl text-amber-100 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
                  <span>Saison {season.number}</span>
                  {(startStr || endStr) && (
                    <span className="text-white/40">
                      {startStr && <>du {startStr}</>}
                      {startStr && endStr && " "}
                      {endStr && <>au {endStr}</>}
                    </span>
                  )}
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">{season.name}</h3>
                {season.description && season.description.trim() && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">
                    {season.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {hasSeasonContent && hasAnnouncements && (
          <div className="relative mx-6 border-t border-amber-300/10" />
        )}

        {hasAnnouncements && (
          <div className="relative px-6 py-5">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
              <FaCircleInfo className="text-[11px]" />
              <span>Annonces</span>
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">
              {announcements}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Stats section ─────────────────── */

function StatsSection({
  labels,
  myPvpStats,
}: {
  labels: BattleTowerHomeLabels;
  myPvpStats?: PvpStats | null;
}) {
  const placementDone = (myPvpStats?.placement_played ?? 0) >= 5;
  const showRanked = placementDone;
  const tier = (myPvpStats?.battle_rank_tier as RankTier) ?? "unranked";
  const theme = tierTheme(tier);

  // Stats à afficher (ranked ou amical)
  const wins = showRanked
    ? (myPvpStats?.pvp_wins_ranked ?? 0)
    : (myPvpStats?.pvp_wins_amical ?? 0);
  const losses = showRanked
    ? (myPvpStats?.pvp_losses_ranked ?? 0)
    : (myPvpStats?.pvp_losses_amical ?? 0);
  const draws = showRanked
    ? (myPvpStats?.pvp_draws_ranked ?? 0)
    : (myPvpStats?.pvp_draws_amical ?? 0);
  const total = wins + losses + draws;
  const winrate =
    total > 0 ? Math.round((wins / total) * 1000) / 10 : null;
  const hasStats = !!myPvpStats;

  return (
    <div
      className="w-full max-w-4xl"
      style={{ animation: "update-page-in 0.6s ease-out 0.2s both" }}
    >
      {/* Header avec mode badge */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FaChartLine className="text-base text-white/55" />
          <h3 className="text-lg font-semibold text-white/85">{labels.statsTitle}</h3>
        </div>
        {/* Badge du mode courant */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{
            borderColor: showRanked ? theme.accent + "40" : "#10B98140",
            background: showRanked
              ? `linear-gradient(135deg, ${theme.glow}, transparent)`
              : "linear-gradient(135deg, rgba(16,185,129,0.15), transparent)",
            color: showRanked ? theme.accent : "#34D399",
          }}
        >
          {showRanked ? (
            <FaCrown className="text-[9px]" />
          ) : (
            <FaTrophy className="text-[9px]" />
          )}
          {showRanked ? labels.modes.lead.title : labels.modes.amical.title}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={<FaTrophy className="text-emerald-300/70" />}
          label={labels.statLabels.wins}
          value={hasStats ? String(wins) : null}
          placeholder={labels.statsPlaceholder}
        />
        <StatTile
          icon={<FaSkull className="text-rose-300/70" />}
          label={labels.statLabels.losses}
          value={hasStats ? String(losses) : null}
          placeholder={labels.statsPlaceholder}
        />
        <StatTile
          icon={<FaChartLine className="text-sky-300/70" />}
          label={labels.statLabels.winrate}
          value={hasStats ? (winrate != null ? `${winrate}%` : "—") : null}
          placeholder={labels.statsPlaceholder}
        />
        {showRanked ? (
          <RankTile labels={labels} myPvpStats={myPvpStats!} />
        ) : (
          <StatTile
            icon={<FaCrown className="text-amber-300/70" />}
            label={labels.statLabels.elo}
            value={hasStats ? String(total) : null}
            valueLabel={hasStats ? "combats" : undefined}
            placeholder={labels.statsPlaceholder}
          />
        )}
      </div>

      {/* Hint affiché seulement si placements pas finis ou pas de stats */}
      {(!hasStats || !placementDone) && (
        <p className="mt-4 text-center text-xs italic text-white/35">
          {labels.statsHint}
        </p>
      )}
    </div>
  );
}

/** Tuile spéciale pour afficher le rang ranked (tier + LP). */
function RankTile({
  labels,
  myPvpStats,
}: {
  labels: BattleTowerHomeLabels;
  myPvpStats: PvpStats;
}) {
  const tier = myPvpStats.battle_rank_tier as RankTier;
  const theme = tierTheme(tier);
  const apex = isApex(tier);
  const lpText = apex
    ? `${myPvpStats.battle_lp} LP`
    : `${myPvpStats.battle_lp}/100 LP`;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-5 ring-1 ring-inset backdrop-blur-sm"
      style={{
        borderColor: theme.accent + "35",
        boxShadow: `inset 0 0 0 1px ${theme.glow}`,
      }}
    >
      {/* Glow d'accent */}
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full blur-3xl"
        style={{ background: theme.glow, opacity: 0.7 }}
        aria-hidden
      />
      <div className="relative mb-3 flex items-center justify-between">
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: theme.accent }}
        >
          {labels.statLabels.elo}
        </span>
        <img
          src={tierIconUrl(tier)}
          alt={tierLabel(tier)}
          className="h-8 w-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
        />
      </div>
      <div className="relative flex items-baseline gap-2">
        <span
          className="text-[20px] font-extrabold tracking-tight"
          style={{ color: theme.accent, textShadow: `0 0 14px ${theme.glow}` }}
        >
          {tierLabel(tier)}
        </span>
      </div>
      <p
        className="mt-1 text-[10px] font-semibold tracking-wider"
        style={{ color: theme.accent + "AA" }}
      >
        {lpText} · {myPvpStats.battle_mmr} MMR
      </p>
    </div>
  );
}

function RuleItem({ text, tag }: { text: string; tag?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <FaCircleCheck className="mt-0.5 shrink-0 text-[13px] text-emerald-300/85" />
      <span className="flex flex-wrap items-center gap-1.5 leading-snug">
        <span>{text}</span>
        {tag && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
            <FaCrown className="text-[8px]" />
            {tag}
          </span>
        )}
      </span>
    </li>
  );
}

function StatTile({
  icon,
  label,
  value,
  valueLabel,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  /** Si null → skeleton placeholder. */
  value?: string | null;
  /** Petit suffixe sous la valeur (ex: "combats"). */
  valueLabel?: string;
  placeholder: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-base opacity-70">{icon}</span>
      </div>
      {value === null || value === undefined ? (
        <>
          {/* Skeleton value */}
          <div className="mb-2 h-8 w-16 animate-pulse rounded-md bg-white/[0.08]" />
          <p className="text-[10px] italic text-white/30">{placeholder}</p>
        </>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-bold tracking-tight text-white">{value}</span>
          {valueLabel && (
            <span className="text-[11px] font-medium text-white/40">{valueLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
