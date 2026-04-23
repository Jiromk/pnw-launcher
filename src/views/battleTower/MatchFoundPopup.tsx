// src/views/battleTower/MatchFoundPopup.tsx
// Popup affichée quand un adversaire est trouvé en ranked.
// 10 secondes pour accepter ou refuser. Si les 2 acceptent → match démarre.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaCheck,
  FaXmark,
  FaBoltLightning,
  FaClock,
} from "react-icons/fa6";
import { tierIconUrl, tierLabel, tierTheme, type RankTier } from "../../ranked";
import type { RankedOpponentPreview, RankedMatchCancelReason } from "../../battleRelay";

export type MatchFoundLabels = {
  title: string;
  subtitle: string;
  opponentRank: string;
  opponentMmr: string;
  accept: string;
  decline: string;
  waiting: string;
  waitingSubtitle: string;
  countdown: (s: number) => string;
  cancelTimeout: string;
  cancelDeclined: string;
  cancelOpponentLeft: string;
  cancelUnknown: string;
  backToQueue: string;
  close: string;
};

type Props = {
  /** roomCode du match trouvé. */
  roomCode: string;
  /** Données de l'adversaire. */
  opponent: RankedOpponentPreview;
  /** Timeout total en ms (généralement 10 000). */
  acceptTimeoutMs: number;
  /** true si ce joueur a déjà accepté, en attente de l'autre. */
  waitingForOpponent: boolean;
  /** Raison de l'annulation si le match a été cancellé. */
  cancelReason: RankedMatchCancelReason | null;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  labels: MatchFoundLabels;
};

export function MatchFoundPopup({
  opponent,
  acceptTimeoutMs,
  waitingForOpponent,
  cancelReason,
  onAccept,
  onDecline,
  onDismiss,
  labels,
}: Props) {
  const theme = tierTheme(opponent.tier);

  // Countdown local
  const [remainingMs, setRemainingMs] = useState(acceptTimeoutMs);
  useEffect(() => {
    if (cancelReason) return; // stop le countdown si cancellé
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const rem = Math.max(0, acceptTimeoutMs - elapsed);
      setRemainingMs(rem);
      if (rem === 0) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [acceptTimeoutMs, cancelReason]);

  const seconds = Math.ceil(remainingMs / 1000);
  const percent = Math.max(0, Math.min(100, (remainingMs / acceptTimeoutMs) * 100));

  // Cancelled view
  if (cancelReason) {
    const msg =
      cancelReason === "timeout"
        ? labels.cancelTimeout
        : cancelReason === "declined"
          ? labels.cancelDeclined
          : cancelReason === "opponent_disconnected"
            ? labels.cancelOpponentLeft
            : labels.cancelUnknown;

    return createPortal(
      <div
        className="promo-overlay fixed inset-0 z-[9998] flex items-center justify-center p-4"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,16,32,0.82) 0%, rgba(0,0,0,0.92) 80%)",
        }}
      >
        <div className="w-full max-w-md rounded-3xl border border-rose-400/20 bg-gradient-to-br from-[#1A0A14] to-[#0F0A10] p-6 text-center shadow-[0_32px_72px_-20px_rgba(0,0,0,0.85)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-rose-400/40 bg-rose-500/10">
            <FaXmark className="text-2xl text-rose-300" />
          </div>
          <h2 className="text-lg font-bold text-rose-200">{msg}</h2>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl border border-white/10 bg-white/[0.06] px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-white/70 transition hover:bg-white/[0.10]"
            >
              {labels.close}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="promo-overlay fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(10,16,32,0.82) 0%, rgba(0,0,0,0.92) 80%)",
      }}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border bg-gradient-to-br from-[#0F1729] to-[#060B18] p-6 shadow-[0_36px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{
          borderColor: theme.accent + "35",
          animation: "update-page-in 0.35s cubic-bezier(0.22, 0.9, 0.36, 1.2) both",
        }}
      >
        {/* Glow top */}
        <div
          className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: theme.glow, opacity: 0.7 }}
          aria-hidden
        />
        {/* Shine animé */}
        <div className="rank-card-shine pointer-events-none absolute inset-0" aria-hidden />

        {/* Header */}
        <div className="relative text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
               style={{ borderColor: theme.accent + "40", background: theme.glow, color: theme.accent }}>
            <FaBoltLightning className="text-[9px]" />
            {labels.title}
          </div>
          <p className="text-xs text-white/55">
            {waitingForOpponent ? labels.waitingSubtitle : labels.subtitle}
          </p>
        </div>

        {/* Opponent card */}
        <div
          className="relative mt-5 flex items-center gap-4 rounded-2xl border p-4"
          style={{
            borderColor: theme.accent + "30",
            background: `linear-gradient(135deg, ${theme.glow} 0%, rgba(10,16,32,0.3) 50%, transparent 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`,
          }}
        >
          <img
            src={tierIconUrl(opponent.tier)}
            alt={tierLabel(opponent.tier)}
            className="h-16 w-16 shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="truncate text-lg font-bold text-white">
              {opponent.name}
            </div>
            <div className="flex items-baseline gap-2 text-[11px]">
              <span
                className="font-semibold uppercase tracking-wider"
                style={{ color: theme.accent }}
              >
                {tierLabel(opponent.tier)}
              </span>
              <span className="text-white/35">·</span>
              <span className="text-white/55">{opponent.mmr} MMR</span>
            </div>
          </div>
        </div>

        {/* Countdown bar */}
        <div className="relative mt-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
            <span className="text-white/45 flex items-center gap-1">
              <FaClock className="text-[9px]" />
              {waitingForOpponent ? labels.waiting : labels.title}
            </span>
            <span style={{ color: theme.accent }}>{labels.countdown(seconds)}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{
                width: `${percent}%`,
                background: `linear-gradient(90deg, ${theme.barFrom}, ${theme.barTo})`,
                boxShadow: `0 0 10px ${theme.glow}`,
              }}
            />
          </div>
        </div>

        {/* Actions */}
        {waitingForOpponent ? (
          <div className="mt-5 flex flex-col items-center gap-1 text-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 bg-emerald-500/10"
              style={{ borderColor: "#10B98160" }}
            >
              <FaCheck className="text-base text-emerald-300" />
            </div>
            <span className="text-xs italic text-white/50">{labels.waiting}</span>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onDecline}
              className="rounded-xl border border-rose-400/30 bg-rose-500/[0.06] px-4 py-3 text-[12px] font-bold uppercase tracking-widest text-rose-200/80 transition hover:-translate-y-0.5 hover:bg-rose-500/[0.12] hover:text-rose-100"
            >
              <FaXmark className="mr-1.5 inline-block text-[11px]" />
              {labels.decline}
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="rounded-xl border-2 px-4 py-3 text-[12px] font-bold uppercase tracking-widest transition hover:-translate-y-0.5 hover:brightness-110"
              style={{
                borderColor: theme.accent + "60",
                background: `linear-gradient(135deg, ${theme.glow}, ${theme.accent}25)`,
                color: theme.accent,
                boxShadow: `0 10px 24px -10px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.1)`,
              }}
            >
              <FaCheck className="mr-1.5 inline-block text-[11px]" />
              {labels.accept}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
