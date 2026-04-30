// src/views/battleTower/PlayersListView.tsx
//
// Vue "Liste des joueurs" : liste globale de tous les joueurs enregistrés
// (compétitif ou pas), avec tabs (Tous / En ligne / Amis), recherche, et
// pagination (top 30 + Voir tout). Click sur un joueur → ouvre son profil.
import React, { useEffect, useMemo, useState } from "react";
import {
  FaChevronRight,
  FaCircle,
  FaCrown,
  FaMagnifyingGlass,
  FaShieldHalved,
  FaStar,
  FaUserGroup,
  FaUsers,
} from "react-icons/fa6";
import type { ChatProfile, GameLivePlayer } from "../../types";
import { isApex, tierIconUrl, tierLabel, tierTheme, type RankTier } from "../../ranked";
import { supabase } from "../../supabaseClient";
import { getFriends } from "../../chatAuth";

export type PlayersListLabels = {
  title: string;
  subtitle: string;
  tabs: { all: string; online: string; friends: string };
  searchPlaceholder: string;
  count: (n: number) => string;
  showAll: (n: number) => string;
  showLess: string;
  empty: string;
  unranked: string;
  noStats: string;
  status: {
    available: string;
    inGame: string;
    inBattle: string;
    offline: string;
  };
};

type PlayerStats = {
  tier: RankTier;
  lp: number;
  mmr: number;
  placementPlayed: number;
  winsRanked: number;
  lossesRanked: number;
};

type Props = {
  labels: PlayersListLabels;
  allMembers: ChatProfile[];
  onlineUserIds: Set<string>;
  gameLivePlayers: Map<string, GameLivePlayer>;
  currentUserId: string;
  onViewProfile: (target: ChatProfile) => void;
};

type Tab = "all" | "online" | "friends";
type PlayerStatus = "available" | "in-game" | "in-battle" | "offline";

const PAGE_SIZE = 30;

function displayName(p: ChatProfile): string {
  return p.display_name || p.username || "Joueur";
}

function roleGlow(roles: string[] | undefined): React.CSSProperties {
  if (!roles || roles.length === 0) return {};
  if (roles.includes("admin"))
    return { boxShadow: "0 0 10px #ef444488, 0 0 20px #ef444444", border: "2px solid #ef4444" };
  if (roles.includes("devteam"))
    return { boxShadow: "0 0 10px #a78bfa88, 0 0 20px #a78bfa44", border: "2px solid #a78bfa" };
  if (roles.includes("patreon"))
    return { boxShadow: "0 0 10px #fb923c88, 0 0 20px #fb923c44", border: "2px solid #fb923c" };
  if (roles.includes("vip"))
    return { boxShadow: "0 0 10px #facc1588, 0 0 20px #facc1544", border: "2px solid #facc15" };
  return {};
}

function getPlayerStatus(
  id: string,
  onlineUserIds: Set<string>,
  gameLivePlayers: Map<string, GameLivePlayer>,
): PlayerStatus {
  if (!onlineUserIds.has(id)) return "offline";
  const glp = gameLivePlayers.get(id);
  if (!glp) return "available";
  const gs: any = (glp as any).gameState;
  const ls: any = (glp as any).liveStatus;
  if (gs?.in_battle || ls?.inBattle) return "in-battle";
  if (gs?.active || ls?.gameActive) return "in-game";
  return "available";
}

const STATUS_DOT_CLASS: Record<PlayerStatus, string> = {
  available: "text-emerald-400",
  "in-game": "text-amber-400",
  "in-battle": "text-rose-400",
  offline: "text-white/15",
};

export function PlayersListView({
  labels,
  allMembers,
  onlineUserIds,
  gameLivePlayers,
  currentUserId,
  onViewProfile,
}: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [statsMap, setStatsMap] = useState<Map<string, PlayerStats>>(new Map());
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

  // ── Fetch global leaderboard stats (1 query) ──
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("leaderboard_scores")
      .select(
        "user_id, battle_rank_tier, battle_lp, battle_mmr, placement_played, pvp_wins_ranked, pvp_losses_ranked",
      )
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map = new Map<string, PlayerStats>();
        for (const r of data) {
          map.set(r.user_id, {
            tier: (r.battle_rank_tier as RankTier) ?? "unranked",
            lp: r.battle_lp ?? 0,
            mmr: r.battle_mmr ?? 1000,
            placementPlayed: r.placement_played ?? 0,
            winsRanked: r.pvp_wins_ranked ?? 0,
            lossesRanked: r.pvp_losses_ranked ?? 0,
          });
        }
        setStatsMap(map);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch friend list (accepted only) ──
  useEffect(() => {
    let cancelled = false;
    getFriends(currentUserId).then((rows) => {
      if (cancelled) return;
      const ids = new Set<string>();
      for (const f of rows) {
        if (f.status !== "accepted") continue;
        ids.add(f.user_id === currentUserId ? f.friend_id : f.user_id);
      }
      setFriendIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // ── Build sorted + filtered list ──
  const players = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = allMembers
      .filter((m) => m.id !== currentUserId)
      .filter((m) => {
        if (tab === "online") return onlineUserIds.has(m.id);
        if (tab === "friends") return friendIds.has(m.id);
        return true;
      })
      .filter((m) => (q ? displayName(m).toLowerCase().includes(q) : true))
      .map((m) => ({
        profile: m,
        stats: statsMap.get(m.id) ?? null,
        status: getPlayerStatus(m.id, onlineUserIds, gameLivePlayers),
      }));

    // Tri : (1) ranked terminés > non-ranked, (2) MMR desc, (3) alpha
    rows.sort((a, b) => {
      const aHasMmr = !!(a.stats && a.stats.placementPlayed >= 5);
      const bHasMmr = !!(b.stats && b.stats.placementPlayed >= 5);
      if (aHasMmr !== bHasMmr) return aHasMmr ? -1 : 1;
      if (aHasMmr && bHasMmr) {
        return (b.stats!.mmr ?? 0) - (a.stats!.mmr ?? 0);
      }
      return displayName(a.profile).localeCompare(displayName(b.profile));
    });

    return rows;
  }, [allMembers, currentUserId, onlineUserIds, gameLivePlayers, friendIds, statsMap, tab, search]);

  const visible = showAll ? players : players.slice(0, PAGE_SIZE);
  const hiddenCount = players.length - visible.length;

  // Reset showAll quand on change de tab/search (vue plus courte par défaut)
  useEffect(() => {
    setShowAll(false);
  }, [tab, search]);

  return (
    <div className="relative mx-auto w-full max-w-4xl px-6 py-10 sm:px-8 sm:py-12">
      {/* Header */}
      <div
        className="mb-6 flex flex-wrap items-end justify-between gap-3"
        style={{ animation: "update-page-in 0.4s ease-out both" }}
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-white/50">{labels.subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/55">
          <FaUsers className="text-[10px]" />
          {labels.count(players.length)}
        </span>
      </div>

      {/* Tabs + search */}
      <div
        className="mb-5 flex flex-wrap items-center gap-3"
        style={{ animation: "update-page-in 0.4s ease-out 0.05s both" }}
      >
        <div className="flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-sm">
          <TabPill active={tab === "all"} onClick={() => setTab("all")} icon={<FaUserGroup className="text-[10px]" />} label={labels.tabs.all} />
          <TabPill
            active={tab === "online"}
            onClick={() => setTab("online")}
            icon={<FaCircle className="text-[8px] text-emerald-400" />}
            label={labels.tabs.online}
          />
          <TabPill
            active={tab === "friends"}
            onClick={() => setTab("friends")}
            icon={<FaStar className="text-[10px] text-amber-300" />}
            label={labels.tabs.friends}
          />
        </div>
        <div className="relative flex-1 min-w-[220px]">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-[13px] text-white placeholder:text-white/30 outline-none transition focus:border-amber-300/50 focus:bg-white/[0.05]"
          />
        </div>
      </div>

      {/* Liste */}
      <ul
        className="space-y-1.5"
        style={{ animation: "update-page-in 0.4s ease-out 0.1s both" }}
      >
        {visible.length === 0 && (
          <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-sm text-white/40">
            {labels.empty}
          </li>
        )}
        {visible.map((row, i) => (
          <PlayerRow
            key={row.profile.id}
            rank={row.stats && row.stats.placementPlayed >= 5 ? rankFromIndex(players, row.profile.id) : null}
            profile={row.profile}
            stats={row.stats}
            status={row.status}
            labels={labels}
            onClick={() => onViewProfile(row.profile)}
            index={i}
          />
        ))}
      </ul>

      {/* Pagination — Voir tout / Réduire */}
      {(hiddenCount > 0 || showAll) && players.length > PAGE_SIZE && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-[12px] font-semibold text-white/70 transition hover:border-amber-300/40 hover:bg-amber-500/[0.10] hover:text-amber-100"
          >
            {showAll ? labels.showLess : labels.showAll(hiddenCount)}
          </button>
        </div>
      )}
    </div>
  );
}

/* Calcule le rang d'un joueur dans la liste classée (placement_played >= 5),
 * trié par MMR desc. Renvoie null si non classé. */
function rankFromIndex(
  list: Array<{ profile: ChatProfile; stats: PlayerStats | null }>,
  id: string,
): number | null {
  let rank = 0;
  for (const r of list) {
    if (!(r.stats && r.stats.placementPlayed >= 5)) continue;
    rank++;
    if (r.profile.id === id) return rank;
  }
  return null;
}

/* ───────────────── TabPill ───────────────── */
function TabPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
        active
          ? "bg-amber-500/[0.18] text-amber-100 ring-1 ring-amber-300/30"
          : "text-white/55 hover:bg-white/[0.05] hover:text-white/85"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ───────────────── PlayerRow ───────────────── */
function PlayerRow({
  rank,
  profile,
  stats,
  status,
  labels,
  onClick,
  index,
}: {
  rank: number | null;
  profile: ChatProfile;
  stats: PlayerStats | null;
  status: PlayerStatus;
  labels: PlayersListLabels;
  onClick: () => void;
  index: number;
}) {
  const tier = stats?.tier ?? "unranked";
  const theme = tierTheme(tier);
  const hasRanked = !!(stats && stats.placementPlayed >= 5);
  const apex = isApex(tier);
  const lpDisplay = stats
    ? apex
      ? `${stats.lp} LP`
      : `${stats.lp}/100 LP`
    : null;
  const wlDisplay = stats && (stats.winsRanked + stats.lossesRanked) > 0
    ? `${stats.winsRanked}-${stats.lossesRanked}`
    : null;

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 30) * 0.015}s` }}
      className="player-row-anim"
    >
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.035] to-transparent px-3.5 py-3 text-left ring-1 ring-inset ring-white/[0.02] transition duration-200 hover:-translate-y-[1px] hover:border-amber-300/25 hover:bg-amber-500/[0.05] hover:shadow-[0_8px_24px_-12px_rgba(245,158,11,0.40)]"
      >
        {/* Rank # */}
        <span
          className={`shrink-0 w-8 text-center text-[13px] font-extrabold tabular-nums ${
            rank === 1
              ? "text-amber-200"
              : rank === 2
                ? "text-slate-200"
                : rank === 3
                  ? "text-orange-300"
                  : rank
                    ? "text-white/55"
                    : "text-white/20"
          }`}
        >
          {rank ? `#${rank}` : "—"}
        </span>

        {/* Avatar with role glow + status dot */}
        <div className="relative shrink-0">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
              style={roleGlow(profile.roles)}
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-[13px] font-bold text-amber-200"
              style={roleGlow(profile.roles)}
            >
              {displayName(profile)[0]?.toUpperCase()}
            </div>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#0a1020] ring-2 ring-[#0a1020]`}
            title={
              status === "available"
                ? labels.status.available
                : status === "in-game"
                  ? labels.status.inGame
                  : status === "in-battle"
                    ? labels.status.inBattle
                    : labels.status.offline
            }
          >
            <FaCircle className={`text-[7px] ${STATUS_DOT_CLASS[status]}`} />
          </span>
        </div>

        {/* Name */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white/90 group-hover:text-amber-100">
            {displayName(profile)}
          </div>
          {wlDisplay && (
            <div className="text-[10.5px] font-medium text-white/35">
              {wlDisplay} <span className="text-white/20">·</span> {stats?.placementPlayed ?? 0} placements
            </div>
          )}
        </div>

        {/* Tier badge */}
        {hasRanked ? (
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <img
              src={tierIconUrl(tier)}
              alt={tierLabel(tier)}
              className="h-6 w-6 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
            />
            <div className="flex flex-col items-end leading-tight">
              <span
                className="text-[11.5px] font-bold tracking-tight"
                style={{ color: theme.accent }}
              >
                {tierLabel(tier)}
              </span>
              <span className="text-[9.5px] font-medium text-white/40">{lpDisplay}</span>
            </div>
          </div>
        ) : (
          <span className="hidden shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/35 sm:inline-flex">
            {labels.unranked}
          </span>
        )}

        {/* MMR */}
        <div className="hidden w-[68px] shrink-0 text-right text-[11px] font-medium tabular-nums text-white/45 md:block">
          {stats && stats.placementPlayed >= 5 ? (
            <>
              <div className="text-[12.5px] font-bold text-white/80">{stats.mmr}</div>
              <div className="text-[9.5px] uppercase tracking-wider text-white/30">MMR</div>
            </>
          ) : (
            <span className="text-white/20">{labels.noStats}</span>
          )}
        </div>

        <FaChevronRight className="shrink-0 text-[11px] text-white/20 transition group-hover:translate-x-0.5 group-hover:text-amber-200" />
      </button>
    </li>
  );
}
