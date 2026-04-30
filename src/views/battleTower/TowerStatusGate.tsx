import React, { useEffect, useState } from "react";
import { FaArrowLeft, FaBan, FaSpinner, FaWrench } from "react-icons/fa6";
import {
  fetchBattleTowerConfig,
  fetchPvpBanStatus,
  formatBanExpiry,
  type PvpBanStatus,
  type TowerConfig,
} from "../../towerStatus";

type GateState =
  | { kind: "loading" }
  | { kind: "maintenance"; message: string }
  | { kind: "banned"; status: PvpBanStatus }
  | { kind: "ok"; config: TowerConfig | null };

type Props = {
  siteUrl: string;
  onBack: () => void;
  /** Render prop : appelé seulement si l'accès est OK. Reçoit la config (saison + annonces). */
  children: (config: TowerConfig | null) => React.ReactNode;
};

/**
 * Gate au montage de la Tour de Combat : vérifie ban PvP + maintenance globale.
 * - Si maintenance globale active → écran maintenance, pas d'accès au PvP
 * - Si joueur banni PvP → écran ban avec date d'expiration et raison
 * - Sinon → render children avec la config (saison + annonces)
 *
 * Les deux checks sont fail-open : si les fetchs échouent, on laisse passer
 * (mieux que de bloquer un joueur légitime à cause d'un souci réseau).
 */
export function TowerStatusGate({ siteUrl, onBack, children }: Props) {
  const [state, setState] = useState<GateState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const [banStatus, config] = await Promise.all([
        fetchPvpBanStatus(),
        fetchBattleTowerConfig(siteUrl),
      ]);
      if (cancelled) return;

      // Priorité 1 : maintenance globale (s'applique avant tout, même aux bannis)
      if (config?.maintenance?.enabled) {
        setState({
          kind: "maintenance",
          message: config.maintenance.message || "La Tour de Combat est temporairement fermée.",
        });
        return;
      }

      // Priorité 2 : ban PvP du joueur
      if (banStatus.banned) {
        setState({ kind: "banned", status: banStatus });
        return;
      }

      // OK
      setState({ kind: "ok", config });
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [siteUrl]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-10 text-amber-200">
        <FaSpinner className="animate-spin text-3xl" />
        <p className="text-sm uppercase tracking-widest text-amber-200/70">
          Vérification de l'accès à la Tour de Combat…
        </p>
      </div>
    );
  }

  if (state.kind === "maintenance") {
    return (
      <div className="relative flex min-h-[70vh] flex-col items-center justify-center px-6 py-12">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10 sm:left-6 sm:top-6"
        >
          <FaArrowLeft /> Retour
        </button>

        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-b from-[#1a1226] via-[#130d1f] to-[#0d0918] shadow-[0_30px_80px_-20px_rgba(245,158,11,0.4)]">
          <div className="flex flex-col items-center gap-4 px-8 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/15 text-amber-200">
              <FaWrench className="text-2xl" />
            </div>
            <h2 className="text-2xl font-bold text-amber-100">
              Tour de Combat en maintenance
            </h2>
            <p className="whitespace-pre-line text-base text-white/80">
              {state.message}
            </p>
            <p className="mt-2 text-xs uppercase tracking-widest text-amber-200/50">
              Le PvP rouvrira dès que la maintenance sera terminée.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "banned") {
    const { reason, expiresAt } = state.status;
    return (
      <div className="relative flex min-h-[70vh] flex-col items-center justify-center px-6 py-12">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-sm transition hover:bg-white/10 sm:left-6 sm:top-6"
        >
          <FaArrowLeft /> Retour
        </button>

        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-red-500/30 bg-gradient-to-b from-[#1f0e16] via-[#160a10] to-[#0d0608] shadow-[0_30px_80px_-20px_rgba(239,68,68,0.5)]">
          <div className="flex flex-col items-center gap-4 px-8 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-400/40 bg-red-500/15 text-red-300">
              <FaBan className="text-2xl" />
            </div>
            <h2 className="text-2xl font-bold text-red-200">
              Tu es banni de la Tour de Combat
            </h2>
            <div className="space-y-2 text-base text-white/85">
              <p>
                <span className="text-white/60">Tu es banni jusqu'au </span>
                <span className="font-semibold text-red-200">{formatBanExpiry(expiresAt)}</span>
                <span className="text-white/60">.</span>
              </p>
              {reason && reason.trim() && (
                <p>
                  <span className="text-white/60">Raison : </span>
                  <span className="text-white/90">{reason}</span>
                </p>
              )}
            </div>
            <p className="mt-2 text-xs uppercase tracking-widest text-red-300/60">
              Si tu penses que c'est une erreur, contacte un administrateur.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // state.kind === "ok"
  return <>{children(state.config)}</>;
}
