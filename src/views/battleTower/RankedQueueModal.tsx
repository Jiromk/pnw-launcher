// src/views/battleTower/RankedQueueModal.tsx
// Modal overlay affichée pendant la recherche d'un adversaire ranked.
// Pilotée par le parent via les props `waitMs` / `mmrWindow` (émis par le serveur).
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaXmark,
  FaBullseye,
} from "react-icons/fa6";
import { tierIconUrl, tierLabel, tierTheme, type RankTier } from "../../ranked";
import { HologramGlobe } from "./HologramGlobe";

export type RankedQueueLabels = {
  title: string;
  subtitle: string;
  waitTime: string;
  mmrWindow: string;
  mmrWindowValue: (w: number | null) => string;
  yourMmr: (mmr: number) => string;
  cancel: string;
  connecting: string;
  error: string;
};

type Props = {
  /** MMR du joueur (fetché depuis Supabase côté serveur, renvoyé via ranked_queue_joined). */
  myMmr: number | null;
  /** Tier affiché dans le coin (fallback unranked si placements non finis). */
  myTier: RankTier;
  /** Temps d'attente en ms (mis à jour via ranked_queue_status). */
  waitMs: number;
  /** Fenêtre MMR actuelle (null = illimitée). */
  mmrWindow: number | null;
  /** true si on est en train de se connecter au serveur ou d'émettre join. */
  connecting?: boolean;
  /** Message d'erreur à afficher (remplace la vue normale si défini). */
  errorMessage?: string | null;
  onCancel: () => void;
  labels: RankedQueueLabels;
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RankedQueueModal({
  myMmr,
  myTier,
  waitMs,
  mmrWindow,
  connecting,
  errorMessage,
  onCancel,
  labels,
}: Props) {
  const theme = tierTheme(myTier);

  // Tick interne pour que le timer progresse même si le serveur envoie peu d'events
  const [localWaitMs, setLocalWaitMs] = useState(waitMs);
  useEffect(() => setLocalWaitMs(waitMs), [waitMs]);
  useEffect(() => {
    const id = setInterval(() => setLocalWaitMs((w) => w + 1000), 1000);
    return () => clearInterval(id);
  }, []);

  // ESC pour annuler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="promo-overlay fixed inset-0 z-[9997] flex items-center justify-center p-4"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(10,16,32,0.82) 0%, rgba(0,0,0,0.92) 80%)",
      }}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0F1729] to-[#060B18] p-8 shadow-[0_36px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{
          animation: "update-page-in 0.35s ease-out both",
        }}
      >
        {/* Bouton fermer en haut à droite */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/[0.06] hover:text-white/80"
          aria-label={labels.cancel}
        >
          <FaXmark className="text-sm" />
        </button>

        {/* Ambient glow top */}
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: theme.glow, opacity: 0.6 }}
          aria-hidden
        />

        {errorMessage ? (
          // ── Error state ──
          <div className="relative flex flex-col items-center gap-3 py-6 text-center">
            <FaBullseye className="text-3xl text-rose-400" />
            <h2 className="text-lg font-bold text-rose-200">{labels.error}</h2>
            <p className="max-w-sm text-sm text-white/60">{errorMessage}</p>
            <button
              type="button"
              onClick={onCancel}
              className="mt-4 rounded-xl border border-white/10 bg-white/[0.06] px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-white/70 transition hover:bg-white/[0.10]"
            >
              {labels.cancel}
            </button>
          </div>
        ) : (
          <>
            {/* Hologram globe — tourne plus vite en mode recherche */}
            <div className="relative mx-auto mb-6 flex items-center justify-center">
              <HologramGlobe size={180} tier={myTier} intensity="searching" />
            </div>

            {/* Title */}
            <div className="text-center">
              <h2
                className="text-xl font-extrabold uppercase tracking-[0.2em]"
                style={{ color: theme.accent, textShadow: `0 0 14px ${theme.glow}` }}
              >
                {labels.title}
              </h2>
              <p className="mt-2 text-[13px] text-white/55">
                {connecting ? labels.connecting : labels.subtitle}
              </p>
            </div>

            {/* Stats box */}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <StatBox
                label={labels.waitTime}
                value={formatDuration(localWaitMs)}
                accent={theme.accent}
              />
              <StatBox
                label={labels.mmrWindow}
                value={labels.mmrWindowValue(mmrWindow)}
                accent={theme.accent}
              />
            </div>

            {/* Your rank indicator at bottom */}
            {myMmr != null && (
              <div className="mt-5 flex items-center justify-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur-sm">
                <img
                  src={tierIconUrl(myTier)}
                  alt={tierLabel(myTier)}
                  className="h-10 w-10"
                />
                <div className="flex flex-col">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: theme.accent }}
                  >
                    {tierLabel(myTier)}
                  </span>
                  <span className="text-[10px] text-white/45">
                    {labels.yourMmr(myMmr)}
                  </span>
                </div>
              </div>
            )}

            {/* Cancel button */}
            <div className="mt-6 flex items-center justify-center">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-rose-400/25 bg-rose-500/[0.06] px-6 py-2.5 text-[12px] font-bold uppercase tracking-widest text-rose-200/80 transition hover:-translate-y-0.5 hover:bg-rose-500/[0.10] hover:text-rose-200"
              >
                {labels.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur-sm">
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">
        {label}
      </span>
      <span
        className="font-mono text-lg font-bold tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}
