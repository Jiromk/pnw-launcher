// src/views/battleTower/CombatAmicalView.tsx
// Mode amical : sidebar des joueurs en ligne à droite + card profil au centre
// avec le bouton "Défier" qui déclenche la callback onChallenge fournie par le parent.
import React, { useEffect, useMemo, useState } from "react";
import {
  FaChartLine,
  FaCircle,
  FaGamepad,
  FaHandshake,
  FaHandFist,
  FaMagnifyingGlass,
  FaShieldHalved,
  FaSkull,
  FaTrophy,
  FaUser,
  FaUserGroup,
  FaXmark,
} from "react-icons/fa6";
import type { ChatProfile, GameLivePlayer } from "../../types";

export type CombatAmicalLabels = {
  title: string;
  subtitle: string;
  sidebarTitle: string;
  sidebarFilter: string;
  sidebarCount: (n: number) => string;
  sidebarEmpty: string;
  emptyStateTitle: string;
  emptyStateBody: string;
  challengeBtn: string;
  viewProfileBtn: string;
  statusAvailable: string;
  statusInGame: string;
  statusInBattle: string;
  disabledBecauseInBattle: string;
  disabledBecauseOwnBattle: string;
  disabledBecauseSelf: string;
  profileStatsTitle: string;
  profileNoBio: string;
  statLabels: {
    wins: string;
    losses: string;
    winrate: string;
    elo: string;
  };
  statsPlaceholder: string;
};

type Props = {
  labels: CombatAmicalLabels;
  allMembers: ChatProfile[];
  onlineUserIds: Set<string>;
  gameLivePlayers: Map<string, GameLivePlayer>;
  currentUserId: string;
  onChallenge: (target: ChatProfile) => void;
  onViewProfile: (target: ChatProfile) => void;
  battleStateIsIdle: boolean;
};

type PlayerStatus = "available" | "in-game" | "in-battle";

function getPlayerStatus(
  id: string,
  gameLivePlayers: Map<string, GameLivePlayer>,
): PlayerStatus {
  const glp = gameLivePlayers.get(id);
  if (!glp) return "available";
  const gs: any = (glp as any).gameState;
  const ls: any = (glp as any).liveStatus;
  if (gs?.in_battle || ls?.inBattle) return "in-battle";
  if (gs?.active || ls?.gameActive) return "in-game";
  return "available";
}

function roleGlow(roles: string[] | undefined): React.CSSProperties {
  if (!roles || roles.length === 0) return {};
  if (roles.includes("admin"))
    return {
      boxShadow: "0 0 10px #ef444488, 0 0 20px #ef444444",
      border: "2px solid #ef4444",
    };
  if (roles.includes("devteam"))
    return {
      boxShadow: "0 0 10px #a78bfa88, 0 0 20px #a78bfa44",
      border: "2px solid #a78bfa",
    };
  if (roles.includes("patreon"))
    return {
      boxShadow: "0 0 10px #fb923c88, 0 0 20px #fb923c44",
      border: "2px solid #fb923c",
    };
  if (roles.includes("vip"))
    return {
      boxShadow: "0 0 10px #facc1588, 0 0 20px #facc1544",
      border: "2px solid #facc15",
    };
  return {};
}

function displayName(p: ChatProfile): string {
  return p.display_name || p.username || "Joueur";
}

export function CombatAmicalView({
  labels,
  allMembers,
  onlineUserIds,
  gameLivePlayers,
  currentUserId,
  onChallenge,
  onViewProfile,
  battleStateIsIdle,
}: Props) {
  const [selected, setSelected] = useState<ChatProfile | null>(null);
  const [filter, setFilter] = useState("");

  // Build the online players list (excluding self), sorted: available first, then in-game, then in-battle
  const onlinePlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = allMembers
      .filter((m) => m.id !== currentUserId && onlineUserIds.has(m.id))
      .filter((m) => (q ? displayName(m).toLowerCase().includes(q) : true))
      .map((m) => ({
        profile: m,
        status: getPlayerStatus(m.id, gameLivePlayers),
      }));
    // Sort: available (0), in-game (1), in-battle (2), then alpha
    const rank = (s: PlayerStatus) =>
      s === "available" ? 0 : s === "in-game" ? 1 : 2;
    rows.sort((a, b) => {
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return displayName(a.profile).localeCompare(displayName(b.profile));
    });
    return rows;
  }, [allMembers, currentUserId, onlineUserIds, gameLivePlayers, filter]);

  // If the selected player disconnects, auto-deselect
  useEffect(() => {
    if (!selected) return;
    if (!onlineUserIds.has(selected.id)) setSelected(null);
  }, [selected, onlineUserIds]);

  const selectedStatus = selected ? getPlayerStatus(selected.id, gameLivePlayers) : null;

  // Decide whether to disable the Challenge button and why
  let challengeDisabled = false;
  let disabledReason: string | null = null;
  if (selected) {
    if (selected.id === currentUserId) {
      challengeDisabled = true;
      disabledReason = labels.disabledBecauseSelf;
    } else if (!battleStateIsIdle) {
      challengeDisabled = true;
      disabledReason = labels.disabledBecauseOwnBattle;
    } else if (selectedStatus === "in-battle") {
      challengeDisabled = true;
      disabledReason = labels.disabledBecauseInBattle;
    }
  }

  return (
    <div className="relative mx-auto flex w-full max-w-6xl gap-6 px-6 py-10 sm:px-8 sm:py-12">
      {/* ───── Main center ───── */}
      <div className="flex-1">
        {!selected ? (
          <div
            className="flex h-full min-h-[480px] flex-col items-center justify-center rounded-3xl border border-white/[0.06] bg-white/[0.02] p-10 text-center ring-1 ring-inset ring-white/[0.03] backdrop-blur-sm"
            style={{ animation: "update-page-in 0.4s ease-out both" }}
          >
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/15 to-teal-500/10 ring-1 ring-emerald-300/20">
              <FaHandshake className="text-4xl text-emerald-200/80 drop-shadow-[0_0_16px_rgba(52,211,153,0.35)]" />
            </div>
            <h2 className="mb-2 text-2xl font-bold text-white/85">
              {labels.emptyStateTitle}
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-white/50">
              {labels.emptyStateBody}
            </p>
          </div>
        ) : (
          <div
            key={selected.id}
            className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm"
            style={{ animation: "update-page-in 0.35s ease-out both" }}
          >
            {/* Corner glow */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-60 w-60 rounded-full bg-sky-400/10 blur-3xl" />

            {/* Close */}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/60 ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-white/10 hover:text-white"
              aria-label="Fermer"
            >
              <FaXmark className="text-sm" />
            </button>

            {/* Header: avatar + name + role badges */}
            <div className="relative flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
              <div className="shrink-0">
                {selected.avatar_url ? (
                  <img
                    src={selected.avatar_url}
                    alt=""
                    className="h-28 w-28 rounded-full object-cover"
                    style={roleGlow(selected.roles)}
                    draggable={false}
                  />
                ) : (
                  <div
                    className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/30 to-sky-500/20 text-4xl font-bold text-white/85"
                    style={roleGlow(selected.roles)}
                  >
                    {displayName(selected)[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
              </div>

              <div className="mt-4 flex-1 sm:ml-6 sm:mt-0">
                <h2 className="mb-1 text-3xl font-bold text-white">
                  {displayName(selected)}
                </h2>
                <div className="mb-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  {(selected.roles ?? []).slice(0, 4).map((r) => (
                    <span
                      key={r}
                      className="inline-block rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/65"
                    >
                      {r}
                    </span>
                  ))}
                  <StatusPill status={selectedStatus ?? "available"} labels={labels} />
                </div>
                <p className="max-w-md text-sm italic leading-relaxed text-white/50">
                  {selected.bio?.trim() || labels.profileNoBio}
                </p>
              </div>
            </div>

            {/* Stats placeholders */}
            <div className="relative mt-8">
              <div className="mb-3 flex items-center gap-2">
                <FaChartLine className="text-sm text-white/50" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white/55">
                  {labels.profileStatsTitle}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile
                  icon={<FaTrophy className="text-emerald-300/70" />}
                  label={labels.statLabels.wins}
                  placeholder={labels.statsPlaceholder}
                />
                <StatTile
                  icon={<FaSkull className="text-rose-300/70" />}
                  label={labels.statLabels.losses}
                  placeholder={labels.statsPlaceholder}
                />
                <StatTile
                  icon={<FaChartLine className="text-sky-300/70" />}
                  label={labels.statLabels.winrate}
                  placeholder={labels.statsPlaceholder}
                />
                <StatTile
                  icon={<FaShieldHalved className="text-amber-300/70" />}
                  label={labels.statLabels.elo}
                  placeholder={labels.statsPlaceholder}
                />
              </div>
            </div>

            {/* Challenge + View profile buttons */}
            <div className="relative mt-8 flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onChallenge(selected)}
                  disabled={challengeDisabled}
                  className={
                    challengeDisabled
                      ? "inline-flex cursor-not-allowed items-center justify-center gap-2.5 rounded-xl bg-white/[0.04] px-8 py-3.5 text-base font-bold text-white/40 ring-1 ring-white/10"
                      : "inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-600/20 px-8 py-3.5 text-base font-bold text-emerald-50 ring-1 ring-emerald-400/40 shadow-[0_0_32px_-8px_rgba(52,211,153,0.6)] transition hover:-translate-y-0.5 hover:from-emerald-500/40 hover:to-teal-600/30 hover:shadow-[0_0_40px_-6px_rgba(52,211,153,0.8)]"
                  }
                >
                  <FaHandFist className="text-base" />
                  {labels.challengeBtn}
                </button>
                <button
                  type="button"
                  onClick={() => onViewProfile(selected)}
                  className="inline-flex items-center justify-center gap-2.5 rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/[0.12] to-orange-500/[0.06] px-6 py-3.5 text-sm font-bold text-amber-100 ring-1 ring-inset ring-amber-300/15 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-amber-300/50 hover:from-amber-500/[0.18] hover:to-orange-500/[0.1] hover:shadow-[0_8px_24px_-8px_rgba(245,158,11,0.5)]"
                >
                  <FaUser className="text-sm" />
                  {labels.viewProfileBtn}
                </button>
              </div>
              {disabledReason && (
                <p className="text-xs italic text-white/35">{disabledReason}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ───── Sidebar right ───── */}
      <aside
        className="flex w-72 shrink-0 flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03] ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm"
        style={{ animation: "update-page-in 0.45s ease-out 0.05s both" }}
      >
        <div className="border-b border-white/[0.06] px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FaUserGroup className="text-sm text-emerald-300/80" />
              <h3 className="text-sm font-semibold text-white/85">
                {labels.sidebarTitle}
              </h3>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/25">
              {labels.sidebarCount(onlinePlayers.length)}
            </span>
          </div>
          <div className="relative">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/30" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={labels.sidebarFilter}
              className="w-full rounded-lg border border-white/[0.08] bg-black/30 py-2 pl-8 pr-3 text-sm text-white placeholder-white/30 ring-1 ring-inset ring-white/[0.05] outline-none transition focus:border-emerald-400/30 focus:ring-emerald-400/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pnw-scrollbar">
          {onlinePlayers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <FaCircle className="text-base text-white/15" />
              <p className="text-xs italic text-white/35">{labels.sidebarEmpty}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 p-2">
              {onlinePlayers.map(({ profile, status }) => {
                const isSelected = selected?.id === profile.id;
                return (
                  <li key={profile.id}>
                    <div
                      className={
                        "group/item relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition " +
                        (isSelected
                          ? "bg-emerald-500/15 ring-1 ring-emerald-400/30"
                          : "hover:bg-white/[0.05]")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(profile)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="relative shrink-0">
                          {profile.avatar_url ? (
                            <img
                              src={profile.avatar_url}
                              alt=""
                              className="h-9 w-9 rounded-full object-cover"
                              style={roleGlow(profile.roles)}
                              draggable={false}
                            />
                          ) : (
                            <div
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-sm font-bold text-white/70"
                              style={roleGlow(profile.roles)}
                            >
                              {displayName(profile)[0]?.toUpperCase() ?? "?"}
                            </div>
                          )}
                          <StatusDot status={status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-white/85">
                            {displayName(profile)}
                          </div>
                          <div className="text-[10px] text-white/40">
                            {status === "in-battle"
                              ? labels.statusInBattle
                              : status === "in-game"
                                ? labels.statusInGame
                                : labels.statusAvailable}
                          </div>
                        </div>
                        {status === "in-battle" && (
                          <FaHandFist className="shrink-0 text-xs text-rose-300/80" />
                        )}
                        {status === "in-game" && (
                          <FaGamepad className="shrink-0 text-xs text-amber-300/80" />
                        )}
                      </button>
                      {/* Bouton "Voir profil" — visible au hover */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewProfile(profile);
                        }}
                        title={labels.viewProfileBtn}
                        aria-label={labels.viewProfileBtn}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-500/[0.08] text-amber-200 opacity-0 ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition hover:border-amber-300/50 hover:bg-amber-500/[0.18] group-hover/item:opacity-100"
                      >
                        <FaUser className="text-[10px]" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function StatusDot({ status }: { status: PlayerStatus }) {
  const color =
    status === "in-battle"
      ? "bg-rose-400"
      : status === "in-game"
        ? "bg-amber-400"
        : "bg-emerald-400";
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[#0a1020] ${color}`}
    />
  );
}

function StatusPill({
  status,
  labels,
}: {
  status: PlayerStatus;
  labels: CombatAmicalLabels;
}) {
  const cfg =
    status === "in-battle"
      ? {
          cls: "border-rose-400/35 bg-rose-500/15 text-rose-200",
          label: labels.statusInBattle,
          icon: <FaHandFist className="text-[9px]" />,
        }
      : status === "in-game"
        ? {
            cls: "border-amber-400/35 bg-amber-500/15 text-amber-200",
            label: labels.statusInGame,
            icon: <FaGamepad className="text-[9px]" />,
          }
        : {
            cls: "border-emerald-400/35 bg-emerald-500/15 text-emerald-200",
            label: labels.statusAvailable,
            icon: <FaCircle className="text-[8px]" />,
          };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function StatTile({
  icon,
  label,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.03]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-sm opacity-70">{icon}</span>
      </div>
      <div className="mb-1.5 h-6 w-14 animate-pulse rounded bg-white/[0.06]" />
      <p className="text-[9px] italic text-white/25">{placeholder}</p>
    </div>
  );
}
