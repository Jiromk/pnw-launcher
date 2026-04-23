// src/views/battleTower/PromotionCelebration.tsx
// Animation plein écran célébrant une promotion (ou l'attribution d'un rang
// après les placements). Utilise le SVG du rang + rayons + confetti.
//
// S'utilise via un state "promotion" dans BattleTowerView qui est set quand
// `record_ranked_battle` retourne `promoted: true` ou `is_placement: false`
// après la fin de la phase de placement.
import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { tierIconUrl, tierLabel, tierTheme, type RankTier } from "../../ranked";

type Props = {
  tier: RankTier;
  /** true si c'est la fin d'une phase de placement (premier rang assigné). */
  isPlacement?: boolean;
  /** Appelé quand l'utilisateur ferme la modal. */
  onDismiss: () => void;
  labels: {
    title: string;
    subtitle: (tier: string) => string;
    placementTitle: string;
    placementSubtitle: (tier: string) => string;
    continue: string;
  };
};

/** Génère 40 confettis avec couleurs du tier + positions et délais randomisés. */
function useConfetti(tier: RankTier, count = 40) {
  return useMemo(() => {
    const theme = tierTheme(tier);
    const colors = [theme.barFrom, theme.barTo, theme.accent, "#ffffff"];
    return Array.from({ length: count }).map((_, i) => {
      const leftPct = Math.random() * 100;
      const delayMs = Math.random() * 600;
      const tx = (Math.random() - 0.5) * 200; // px, left/right drift
      const rotate = Math.random() * 360;
      const size = 8 + Math.random() * 10;
      const color = colors[i % colors.length];
      return { leftPct, delayMs, tx, rotate, size, color };
    });
  }, [tier, count]);
}

export function PromotionCelebration({ tier, isPlacement = false, onDismiss, labels }: Props) {
  const theme = tierTheme(tier);
  const confetti = useConfetti(tier);

  // ESC pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Auto-dismiss après 6s si l'utilisateur ne clique pas
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return createPortal(
    <div
      className="promo-overlay fixed inset-0 z-[9998] flex items-center justify-center"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(10,16,32,0.75) 0%, rgba(0,0,0,0.92) 80%)",
      }}
      onClick={onDismiss}
    >
      {/* Confetti layer — tombe du haut */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((c, i) => (
          <span
            key={i}
            className="promo-confetti-piece"
            style={{
              left: `${c.leftPct}%`,
              top: "-20px",
              width: c.size,
              height: c.size * 1.3,
              background: c.color,
              transform: `rotate(${c.rotate}deg)`,
              animationDelay: `${c.delayMs}ms`,
              boxShadow: `0 0 6px ${c.color}aa`,
              borderRadius: i % 3 === 0 ? "50%" : "2px",
              // @ts-ignore — CSS variable custom
              "--tx": `${c.tx}px`,
            }}
          />
        ))}
      </div>

      {/* Contenu central (arrête la propagation du clic pour laisser lire) */}
      <div
        className="relative flex flex-col items-center gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Rayons qui tournent derrière */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="promo-rays h-[520px] w-[520px] rounded-full"
            style={{
              background: `conic-gradient(from 0deg,
                ${theme.accent}00 0deg,
                ${theme.accent}55 15deg,
                ${theme.accent}00 30deg,
                ${theme.accent}00 60deg,
                ${theme.accent}55 75deg,
                ${theme.accent}00 90deg,
                ${theme.accent}00 120deg,
                ${theme.accent}55 135deg,
                ${theme.accent}00 150deg,
                ${theme.accent}00 180deg,
                ${theme.accent}55 195deg,
                ${theme.accent}00 210deg,
                ${theme.accent}00 240deg,
                ${theme.accent}55 255deg,
                ${theme.accent}00 270deg,
                ${theme.accent}00 300deg,
                ${theme.accent}55 315deg,
                ${theme.accent}00 330deg,
                ${theme.accent}00 360deg)`,
              mask: "radial-gradient(circle, transparent 30%, black 32%, black 90%, transparent 100%)",
              WebkitMask:
                "radial-gradient(circle, transparent 30%, black 32%, black 90%, transparent 100%)",
            }}
            aria-hidden
          />
        </div>

        {/* Halo pulsé */}
        <div
          className="promo-halo pointer-events-none absolute h-[320px] w-[320px] rounded-full"
          style={{
            top: "-30px",
            background: `radial-gradient(circle, ${theme.glowStrong}, transparent 70%)`,
          }}
          aria-hidden
        />

        {/* Titre "Promotion !" */}
        <div className="relative z-10 flex flex-col items-center">
          <span
            className="promo-text-in text-[10px] font-extrabold uppercase tracking-[0.3em]"
            style={{ color: theme.accent, textShadow: `0 0 12px ${theme.glow}` }}
          >
            {isPlacement ? labels.placementTitle : labels.title}
          </span>
        </div>

        {/* Badge SVG central */}
        <div className="relative z-10">
          <div
            className="promo-badge-in relative"
            style={{
              filter: `drop-shadow(0 18px 44px ${theme.glowStrong})`,
            }}
          >
            <img
              src={tierIconUrl(tier)}
              alt={tierLabel(tier)}
              className="h-52 w-52 sm:h-64 sm:w-64"
            />
          </div>
        </div>

        {/* Nom du tier gigantesque avec shine */}
        <div className="promo-sub-in relative z-10 flex flex-col items-center gap-2">
          <span
            className="promo-tier-shine text-5xl font-black uppercase tracking-[0.22em] sm:text-6xl"
            style={{ color: theme.accent }}
          >
            {tierLabel(tier)}
          </span>
          <span className="text-sm text-white/70">
            {isPlacement ? labels.placementSubtitle(tierLabel(tier)) : labels.subtitle(tierLabel(tier))}
          </span>
        </div>

        {/* Bouton continuer */}
        <button
          type="button"
          onClick={onDismiss}
          className="promo-btn-in relative z-10 mt-4 rounded-xl border px-6 py-2.5 text-[12px] font-bold uppercase tracking-widest transition hover:-translate-y-0.5 hover:brightness-110"
          style={{
            borderColor: theme.accent + "55",
            background: `linear-gradient(135deg, ${theme.glow}, transparent)`,
            color: theme.accent,
            boxShadow: `0 10px 28px -12px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.1)`,
          }}
        >
          {labels.continue}
        </button>
      </div>
    </div>,
    document.body,
  );
}
