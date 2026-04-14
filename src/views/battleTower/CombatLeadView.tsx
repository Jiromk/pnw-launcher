// src/views/battleTower/CombatLeadView.tsx
// Mode compétitif — maquette visuelle avec tous les contrôles désactivés.
// Aucune logique, aucun fetch, aucune subscription.
import React from "react";
import { Button } from "../../ui";
import {
  FaBullseye,
  FaChartLine,
  FaCrown,
  FaLock,
  FaMagnifyingGlass,
  FaSkull,
  FaTrophy,
} from "react-icons/fa6";

export type CombatLeadLabels = {
  title: string;
  subtitle: string;
  comingSoon: string;
  queueTitle: string;
  queueSubtitle: string;
  queueBtn: string;
  myRank: string;
  leaderboardTitle: string;
  leaderboardEmpty: string;
  footer: string;
  columns: {
    rank: string;
    player: string;
    elo: string;
    wins: string;
    losses: string;
    winrate: string;
  };
};

type Props = {
  labels: CombatLeadLabels;
};

export function CombatLeadView({ labels }: Props) {
  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 sm:px-10 sm:py-12">
      {/* Header */}
      <div
        className="flex flex-col items-center text-center"
        style={{ animation: "update-page-in 0.45s ease-out both" }}
      >
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
          <FaLock className="text-[9px]" />
          {labels.comingSoon}
        </div>
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/10 ring-1 ring-amber-300/25">
          <FaCrown className="text-4xl text-amber-200 drop-shadow-[0_0_18px_rgba(245,158,11,0.5)]" />
        </div>
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {labels.title}
        </h1>
        <p className="text-sm text-white/50">{labels.subtitle}</p>
      </div>

      {/* Queue card */}
      <div
        className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-500/[0.08] via-white/[0.02] to-transparent p-8 ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm"
        style={{ animation: "update-page-in 0.5s ease-out 0.1s both" }}
      >
        {/* Background glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-60 w-60 rounded-full bg-orange-400/10 blur-3xl" />

        <div className="relative flex flex-col items-center text-center">
          {/* Scanning animation icon */}
          <div
            className="relative mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/10"
            style={{ animation: "update-glow-pulse 4s ease-in-out infinite" }}
          >
            <FaBullseye className="relative text-4xl text-amber-200/80 drop-shadow-[0_0_14px_rgba(245,158,11,0.4)]" />
            {/* Ring pulse */}
            <span className="absolute inset-0 animate-ping rounded-full border border-amber-400/20" />
          </div>

          <h2 className="mb-2 text-2xl font-bold text-white/90">{labels.queueTitle}</h2>
          <p className="mb-6 max-w-md text-sm leading-relaxed text-white/50">
            {labels.queueSubtitle}
          </p>

          {/* Disabled button */}
          <Button
            type="button"
            disabled
            className="!cursor-not-allowed !bg-white/[0.04] !ring-white/10 !opacity-50 sm:min-w-[16rem]"
          >
            <FaMagnifyingGlass className="mr-2 text-sm" />
            {labels.queueBtn}
          </Button>

          {/* Player elo badge (placeholder) */}
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 backdrop-blur-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-white/40">
              {labels.myRank}
            </span>
            <div className="h-5 w-16 animate-pulse rounded-md bg-white/[0.08]" />
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03] ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm"
        style={{ animation: "update-page-in 0.5s ease-out 0.2s both" }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-3">
            <FaTrophy className="text-base text-amber-300/80" />
            <h3 className="text-lg font-semibold text-white/90">
              {labels.leaderboardTitle}
            </h3>
          </div>
          <span className="text-xs italic text-white/30">{labels.leaderboardEmpty}</span>
        </div>

        {/* Table */}
        <div className="relative overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs font-semibold uppercase tracking-wider text-white/40">
                <th className="w-16 px-6 py-3">{labels.columns.rank}</th>
                <th className="px-6 py-3">{labels.columns.player}</th>
                <th className="w-20 px-6 py-3 text-right">{labels.columns.elo}</th>
                <th className="w-14 px-6 py-3 text-right">{labels.columns.wins}</th>
                <th className="w-14 px-6 py-3 text-right">{labels.columns.losses}</th>
                <th className="w-24 px-6 py-3 text-right">{labels.columns.winrate}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr
                  key={i}
                  className="border-b border-white/[0.04] transition hover:bg-white/[0.02]"
                >
                  <td className="px-6 py-4">
                    <div className="h-4 w-6 animate-pulse rounded bg-white/[0.06]" />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="ml-auto h-4 w-10 animate-pulse rounded bg-white/[0.06]" />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="ml-auto h-4 w-6 animate-pulse rounded bg-white/[0.06]" />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="ml-auto h-4 w-6 animate-pulse rounded bg-white/[0.06]" />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="ml-auto h-4 w-12 animate-pulse rounded bg-white/[0.06]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Overlay lock */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-[#0a1020]/85 via-[#0a1020]/40 to-transparent">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#0a1020]/80 px-6 py-5 backdrop-blur-md">
              <FaLock className="text-2xl text-amber-300/80" />
              <span className="text-sm font-semibold text-white/80">{labels.comingSoon}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <p className="text-center text-xs leading-relaxed text-white/35">{labels.footer}</p>
    </div>
  );
}
