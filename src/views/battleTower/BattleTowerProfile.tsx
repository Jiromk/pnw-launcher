// src/views/battleTower/BattleTowerProfile.tsx
// Profil du joueur dans la Tour de Combat : bannière chat + stats PvP + historique des matchs
// dans un style League of Legends (cards colorées par résultat, sprites de l'équipe utilisée).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
} from "react-icons/fa6";
import type { ChatProfile } from "../../types";
import {
  fetchBattleHistory,
  fetchPvpStats,
  type BattleResultEntry,
  type BattleTeamSnapshot,
  type PvpStats,
} from "../../leaderboard";

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
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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

  const totalMatches =
    (stats?.pvp_wins ?? 0) + (stats?.pvp_losses ?? 0) + (stats?.pvp_draws ?? 0);
  const winrate =
    totalMatches > 0
      ? Math.round(((stats?.pvp_wins ?? 0) / totalMatches) * 1000) / 10
      : null;

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
        </div>
      </div>

      {/* ── Stats grid ── */}
      <div
        className="grid grid-cols-2 gap-4 md:grid-cols-4"
        style={{ animation: "update-page-in 0.5s ease-out 0.1s both" }}
      >
        <StatTile
          icon={<FaTrophy />}
          iconColor="text-emerald-300"
          glowColor="rgba(52,211,153,0.22)"
          label={labels.stats.wins}
          value={loading ? null : String(stats?.pvp_wins ?? 0)}
        />
        <StatTile
          icon={<FaSkull />}
          iconColor="text-rose-300"
          glowColor="rgba(244,63,94,0.22)"
          label={labels.stats.losses}
          value={loading ? null : String(stats?.pvp_losses ?? 0)}
        />
        <StatTile
          icon={<FaChartLine />}
          iconColor="text-sky-300"
          glowColor="rgba(56,189,248,0.22)"
          label={labels.stats.winrate}
          value={loading ? null : winrate != null ? `${winrate}%` : "—"}
        />
        <StatTile
          icon={<FaCrown />}
          iconColor="text-amber-300"
          glowColor="rgba(245,158,11,0.28)"
          label={labels.stats.elo}
          value={
            loading
              ? null
              : stats?.battle_elo != null
                ? String(stats.battle_elo)
                : labels.stats.unranked
          }
          hint={
            loading
              ? undefined
              : stats?.battle_elo != null || (stats?.battle_lp ?? 0) > 0
                ? `${stats?.battle_lp ?? 0} ${labels.stats.lp}`
                : undefined
          }
        />
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
              {visibleHistory.map((match) => (
                <MatchCard key={match.id} match={match} labels={labels} onViewOpponent={onViewOpponent} />
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

function StatTile({
  icon,
  iconColor,
  glowColor,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  iconColor: string;
  glowColor: string;
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm transition hover:border-white/15 hover:bg-white/[0.05]"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-3xl"
        style={{ background: glowColor }}
        aria-hidden
      />
      <div className="relative mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">
          {label}
        </span>
        <span className={`text-base opacity-80 ${iconColor}`}>{icon}</span>
      </div>
      {value === null ? (
        <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.08]" />
      ) : (
        <div className="relative flex items-baseline gap-2">
          <span className="text-[22px] font-bold tracking-tight text-white">{value}</span>
          {hint && (
            <span className="text-[11px] font-medium text-white/40">{hint}</span>
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
}: {
  match: BattleResultEntry;
  labels: BattleTowerProfileLabels;
  onViewOpponent?: (opponentId: string) => void;
}) {
  const resultConfig =
    match.result === "win"
      ? {
          borderColor: "border-emerald-400/25",
          ringColor: "ring-emerald-300/10",
          accentBar: "bg-gradient-to-b from-emerald-400/80 via-emerald-400 to-emerald-500/80",
          glow: "rgba(52,211,153,0.15)",
          label: labels.history.resultWin,
          labelClass: "text-emerald-200",
          icon: <FaTrophy className="text-emerald-300" />,
        }
      : match.result === "loss"
        ? {
            borderColor: "border-rose-400/25",
            ringColor: "ring-rose-300/10",
            accentBar: "bg-gradient-to-b from-rose-400/80 via-rose-500 to-rose-600/80",
            glow: "rgba(244,63,94,0.15)",
            label: labels.history.resultLoss,
            labelClass: "text-rose-200",
            icon: <FaSkull className="text-rose-300" />,
          }
        : {
            borderColor: "border-amber-400/25",
            ringColor: "ring-amber-300/10",
            accentBar: "bg-gradient-to-b from-amber-400/80 via-amber-500 to-amber-600/80",
            glow: "rgba(245,158,11,0.15)",
            label: labels.history.resultDraw,
            labelClass: "text-amber-200",
            icon: <FaHandshake className="text-amber-300" />,
          };

  const matchType = match.match_type ?? "amical";
  const typeLabel =
    matchType === "ranked" ? labels.history.typeRanked : labels.history.typeAmical;
  const typeClass =
    matchType === "ranked"
      ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
      : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";

  const timeAgo = formatTimeAgo(match.created_at, labels.history);
  const duration = formatDuration(match.duration_sec);

  const myTeam: BattleTeamSnapshot[] = Array.isArray(match.my_team) ? match.my_team : [];
  const oppTeam: BattleTeamSnapshot[] = Array.isArray(match.opponent_team)
    ? match.opponent_team
    : [];
  const hasAnyTeam = myTeam.length > 0 || oppTeam.length > 0;
  const opponentName = match.opponent_name || labels.anonymous;

  return (
    <li
      className={`group relative overflow-hidden rounded-2xl border ${resultConfig.borderColor} bg-gradient-to-br from-white/[0.03] via-white/[0.01] to-transparent ring-1 ring-inset ${resultConfig.ringColor} backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-white/20`}
    >
      {/* Barre d'accent à gauche */}
      <div className={`absolute left-0 top-0 h-full w-[4px] ${resultConfig.accentBar}`} />
      {/* Glow coin */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl transition group-hover:opacity-80"
        style={{ background: resultConfig.glow }}
        aria-hidden
      />

      <div className="relative flex flex-col gap-3 py-4 pl-6 pr-5">
        {/* Première ligne : métas */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          {/* Col 1: Result + Type */}
          <div className="flex min-w-[130px] flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-base">{resultConfig.icon}</span>
              <span className={`text-[15px] font-bold ${resultConfig.labelClass}`}>
                {resultConfig.label}
              </span>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${typeClass}`}
            >
              {matchType === "ranked" ? (
                <FaCrown className="text-[8px]" />
              ) : (
                <FaHandshake className="text-[8px]" />
              )}
              {typeLabel}
            </span>
          </div>

          {/* Col 2: Adversaire + meta */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] uppercase tracking-wider text-white/35">
                {labels.history.vs}
              </span>
              {onViewOpponent && match.opponent_id ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewOpponent(match.opponent_id);
                  }}
                  className="truncate text-[14px] font-semibold text-white/90 transition hover:text-amber-200 hover:underline hover:underline-offset-2"
                >
                  {opponentName}
                </button>
              ) : (
                <span className="truncate text-[14px] font-semibold text-white/90">
                  {opponentName}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/40">
              <span className="flex items-center gap-1">
                <FaClock className="text-[9px]" />
                {timeAgo}
              </span>
              {duration && (
                <span className="flex items-center gap-1">
                  <span className="text-white/25">·</span>
                  {labels.history.durationLabel} {duration}
                </span>
              )}
              {matchType === "ranked" && match.lp_delta != null && (
                <>
                  <span className="text-white/25">·</span>
                  <LpDelta delta={match.lp_delta} labels={labels} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Deuxième ligne : 2 équipes côte à côte avec VS au milieu */}
        {hasAnyTeam && (
          <div className="flex items-center justify-center gap-3 sm:gap-4">
            {/* Mon équipe (gauche) */}
            <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">
                {labels.history.youLabel}
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                {myTeam.length > 0 ? (
                  myTeam
                    .slice(0, 6)
                    .map((mon, idx) => <MonSlot key={`my-${mon.code}-${idx}`} mon={mon} />)
                ) : (
                  <span className="text-[10px] italic text-white/25">
                    {labels.history.teamUnknown}
                  </span>
                )}
              </div>
            </div>

            {/* Séparateur VS */}
            <div className="flex shrink-0 flex-col items-center gap-0.5 px-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border ${resultConfig.borderColor} bg-[#0a1020]/80 shadow-[0_0_14px_rgba(0,0,0,0.4)]`}
                style={{
                  backgroundImage: `radial-gradient(circle at center, ${resultConfig.glow}, transparent 70%)`,
                }}
              >
                <FaBoltLightning className={`text-xs ${resultConfig.labelClass}`} />
              </div>
              <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-white/30">
                {labels.history.vs}
              </span>
            </div>

            {/* Équipe adverse (droite) */}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="truncate text-[9px] font-bold uppercase tracking-wider text-white/35">
                {opponentName}
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                {oppTeam.length > 0 ? (
                  oppTeam
                    .slice(0, 6)
                    .map((mon, idx) => <MonSlot key={`opp-${mon.code}-${idx}`} mon={mon} />)
                ) : (
                  <span className="text-[10px] italic text-white/25">
                    {labels.history.teamUnknown}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </li>
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

function MonSlot({ mon }: { mon: BattleTeamSnapshot }) {
  const [src, setSrc] = useState<string | null>(null);
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

  const title = mon.nickname || mon.speciesName || `#${mon.code}`;

  return (
    <div
      className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-inset ring-white/[0.05] transition group-hover:border-white/15 sm:h-11 sm:w-11"
      title={title}
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
