// src/views/battleTower/RankTower.tsx
//
// Tour des Tiers V3 — "Wizard's Spire"
//
// Refonte complète orientée éclat + élégance + verticalité :
//  - Body slim (taller-than-wide), pierre claire teintée tier
//  - Porte d'entrée arquée glowing au sol
//  - 2 colonnes ornementales latérales le long du body
//  - 5 rangées de 2 fenêtres clairement lumineuses (1 par tier)
//  - Grand emblème rosace centrale tier-aware
//  - Battlements crénelés + 4 bannières
//  - Spire à 2 niveaux (oignon + cône) — plus ornée
//  - Pinnacle pointue avec petit drapeau
//  - Couronne au-dessus pour apex (Master+)
//  - Cristal multi-facette flottant qui pulse/rotates
//  - Faisceau d'énergie qui transperce le ciel + 4 streaks
//  - Halo radial sol + brume + atmosphère bleutée
//  - 12 particules ascendantes type-Pokémon
//  - 3 orbes en orbite + champ d'étoiles
//
// Pur React + SVG + RAF.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { isApex, tierTheme, type RankTier } from "../../ranked";

type Intensity = "idle" | "searching" | "found";

type Props = {
  size?: number;
  tier?: RankTier;
  intensity?: Intensity;
  className?: string;
};

const TIERS_BOTTOM_UP: RankTier[] = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger",
];

const TYPE_COLORS = {
  fire: "#F87171",
  water: "#60A5FA",
  grass: "#34D399",
  electric: "#FBBF24",
  psychic: "#F472B6",
  ice: "#7DD3FC",
  dragon: "#C084FC",
  fairy: "#FDA4AF",
} as const;
type PokeType = keyof typeof TYPE_COLORS;

type Star = { x: number; y: number; size: number; phase: number };

function generateStars(size: number, count: number): Star[] {
  let seed = 71;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const cx = size / 2;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = rand() * size;
      y = rand() * size;
      const inTowerCol =
        Math.abs(x - cx) < size * 0.16 && y > size * 0.05 && y < size * 0.95;
      if (!inTowerCol) break;
    }
    stars.push({
      x,
      y,
      size: 0.3 + rand() * 1.0,
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

export function RankTower({
  size = 200,
  tier = "unranked",
  intensity = "idle",
  className,
}: Props) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = (now: number) => {
      setTick(now / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const theme = tierTheme(tier);
  const apex = isApex(tier);
  const activeIdx = TIERS_BOTTOM_UP.indexOf(tier);

  // ── Geometry — slim & tall ──
  const cx = size / 2;
  const groundY = size * 0.94;
  const foundationTopY = size * 0.86;
  const bodyBottomY = foundationTopY;
  const bodyTopY = size * 0.40;
  const ringY = bodyTopY; // anneau décoratif
  const battlementBaseY = ringY - size * 0.015;
  const battlementTopY = battlementBaseY - size * 0.045;
  const spireBaseY = battlementTopY;
  const spireMidY = size * 0.20; // bulbe / oignon
  const spireConeBaseY = spireMidY;
  const spireTopY = size * 0.10;
  const pinnacleTipY = size * 0.04;
  const crystalY = size * -0.02; // au-dessus du viewBox

  // Largeurs (slim profile)
  const bodyW = size * 0.26;
  const bodyTopW = size * 0.23;
  const ringW = bodyTopW + size * 0.025;
  const battlementW = bodyTopW + size * 0.018;
  const spireBaseW = size * 0.13;
  const spireMidW = size * 0.16; // léger renflement (oignon)
  const spireTopW = size * 0.07;

  // Animation
  const pulseSpeed =
    intensity === "found" ? 3.0 : intensity === "searching" ? 2.2 : 1.6;
  const pulse = 0.5 + 0.5 * Math.sin(tick * pulseSpeed);
  const pulseSlow = 0.5 + 0.5 * Math.sin(tick * 0.85);
  const sway = Math.sin(tick * 1.2) * 0.6;
  const swayAlt = Math.sin(tick * 1.2 + Math.PI / 2) * 0.6;

  // Star field
  const stars = useMemo(() => generateStars(size, 36), [size]);

  // Particules
  const particleSpeed =
    intensity === "found" ? 1.6 : intensity === "searching" ? 1.2 : 1;
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        side: i % 2 === 0 ? -1 : 1,
        delay: (i * 0.41) % 4,
        duration: 4.0 + ((i * 0.7) % 2.0),
        offset: ((i * 13) % 12) - 6,
        type: (Object.keys(TYPE_COLORS) as PokeType[])[i % 8],
        sizeR: 1 + ((i * 3) % 2) * 0.5,
      })),
    [],
  );

  // Orbites
  const orbits = [
    { speed: 0.30, offset: 0, tilt: 22, yC: size * 0.55, color: theme.accent },
    { speed: 0.40, offset: Math.PI, tilt: -18, yC: size * 0.42, color: "#FFFFFF" },
    { speed: 0.25, offset: Math.PI / 2, tilt: 30, yC: size * 0.68, color: theme.accent },
  ];

  // Fenêtres : 5 rangées × 2 fenêtres = 10 (1 par tier, bottom-up)
  const windowRows = 5;
  const windowsPerRow = 2;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
        filter: `drop-shadow(0 0 26px ${theme.glow})`,
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          {/* Halo sol */}
          <radialGradient id={`rt-base-halo-${tier}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="0.65" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
          </radialGradient>
          {/* Brume sol */}
          <radialGradient id="rt-fog" cx="50%" cy="50%" r="50%">
            <stop offset="20%" stopColor="#60A5FA" stopOpacity="0" />
            <stop offset="60%" stopColor="#60A5FA" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
          </radialGradient>
          {/* Atmosphère bleutée derrière */}
          <radialGradient id="rt-atmo" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#60A5FA" stopOpacity="0" />
            <stop offset="80%" stopColor="#60A5FA" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
          </radialGradient>
          {/* Pierre body — claire et teintée tier */}
          <linearGradient id={`rt-stone-body-${tier}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9c8acc" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#5e4d8a" stopOpacity="1" />
            <stop offset="100%" stopColor="#231a3e" stopOpacity="1" />
          </linearGradient>
          {/* Pierre spire — un peu plus claire encore */}
          <linearGradient id={`rt-stone-spire-${tier}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#b3a0e3" stopOpacity="0.95" />
            <stop offset="50%" stopColor="#6e5cae" stopOpacity="1" />
            <stop offset="100%" stopColor="#2c2150" stopOpacity="1" />
          </linearGradient>
          {/* Roof bulbe (oignon) — saturé tier color */}
          <radialGradient id={`rt-bulb-${tier}`} cx="50%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.4" />
            <stop offset="40%" stopColor={theme.accent} stopOpacity="0.85" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.3" />
          </radialGradient>
          {/* Pinnacle (cône) */}
          <linearGradient id={`rt-pinnacle-${tier}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="50%" stopColor={theme.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.accentSoft} stopOpacity="0.95" />
          </linearGradient>
          {/* Foundation steps */}
          <linearGradient id="rt-step" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b3158" stopOpacity="1" />
            <stop offset="100%" stopColor="#13182a" stopOpacity="1" />
          </linearGradient>
          {/* Grand emblème (cœur lumineux) */}
          <radialGradient id={`rt-emblem-${tier}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="35%" stopColor={theme.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
          </radialGradient>
          {/* Cristal */}
          <radialGradient id={`rt-crystal-${tier}`} cx="40%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="50%" stopColor={theme.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.4" />
          </radialGradient>
          {/* Fenêtre allumée (chaud) */}
          <radialGradient id={`rt-window-lit-${tier}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFAE0" stopOpacity="1" />
            <stop offset="60%" stopColor={theme.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.3" />
          </radialGradient>
          {/* Porte (entrée tower) */}
          <radialGradient id={`rt-door-${tier}`} cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="#FFFAE0" stopOpacity="1" />
            <stop offset="40%" stopColor={theme.accent} stopOpacity="0.92" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.15" />
          </radialGradient>
          {/* Beam vertical */}
          <linearGradient id={`rt-beam-${tier}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="0" />
            <stop offset="35%" stopColor={theme.accent} stopOpacity="0.85" />
            <stop offset="80%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0.95" />
          </linearGradient>
          {/* Anneau décoratif (bande) */}
          <linearGradient id={`rt-ring-${tier}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="0.95" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor={theme.accentSoft} stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {/* ─────── ATMOSPHÈRE + ÉTOILES ─────── */}
        <circle cx={cx} cy={size / 2} r={size * 0.50} fill="url(#rt-atmo)" />
        <g opacity="0.78">
          {stars.map((s, i) => {
            const tw = 0.3 + 0.7 * Math.abs(Math.sin(tick * 1.4 + s.phase));
            return (
              <circle
                key={`star-${i}`}
                cx={s.x}
                cy={s.y}
                r={s.size}
                fill="#FFFFFF"
                opacity={tw * 0.6}
              />
            );
          })}
        </g>

        {/* ─────── BEAM AU-DESSUS DU CRISTAL (transperce le ciel) ─────── */}
        <rect
          x={cx - 1.6}
          y={crystalY - size * 0.45}
          width={3.2}
          height={size * 0.45}
          fill={`url(#rt-beam-${tier})`}
          opacity={0.55 + pulse * 0.40}
          rx="1.4"
        />
        {[0, 1, 2, 3].map((j) => {
          const sp = ((tick * particleSpeed * 0.9 + j * 0.30) % 1.6) / 1.6;
          const sy = crystalY - sp * size * 0.45;
          const so = sp < 0.1 ? sp / 0.1 : sp > 0.9 ? (1 - sp) / 0.1 : 1;
          return (
            <rect
              key={`sk-${j}`}
              x={cx - 1.0}
              y={sy}
              width={2.0}
              height={size * 0.04}
              fill="#FFFFFF"
              opacity={so * 0.85}
              rx="0.8"
            />
          );
        })}

        {/* ─────── HALO SOL + BRUME ─────── */}
        <ellipse cx={cx} cy={groundY + 4} rx={size * 0.46} ry={size * 0.10} fill={`url(#rt-base-halo-${tier})`} />
        <ellipse cx={cx} cy={groundY - 8} rx={size * 0.50} ry={size * 0.07} fill="url(#rt-fog)" />

        {/* ─────── FOUNDATION : 4 marches ─────── */}
        {[0, 1, 2, 3].map((step) => {
          const stepW = bodyW * (2.4 - step * 0.18);
          const stepH = size * 0.022;
          const stepY = groundY - (step + 1) * stepH - step * 0.5;
          return (
            <g key={`step-${step}`}>
              <rect
                x={cx - stepW / 2}
                y={stepY}
                width={stepW}
                height={stepH}
                rx="1.5"
                fill="url(#rt-step)"
                stroke={theme.accent}
                strokeWidth="0.55"
                strokeOpacity={0.65 - step * 0.10}
              />
              <rect
                x={cx - stepW / 2}
                y={stepY}
                width={stepW}
                height={1}
                fill={theme.accent}
                opacity="0.45"
              />
            </g>
          );
        })}

        {/* ─────── BODY ─────── */}
        <path
          d={`
            M ${cx - bodyW / 2} ${bodyBottomY}
            L ${cx + bodyW / 2} ${bodyBottomY}
            L ${cx + bodyTopW / 2} ${bodyTopY}
            L ${cx - bodyTopW / 2} ${bodyTopY}
            Z
          `}
          fill={`url(#rt-stone-body-${tier})`}
          stroke={theme.accent}
          strokeWidth="0.9"
          strokeOpacity="0.70"
        />
        {/* Highlight gauche (rayon de lumière) */}
        <path
          d={`
            M ${cx - bodyW / 2 + 1.5} ${bodyBottomY - 2}
            L ${cx - bodyTopW / 2 + 1.5} ${bodyTopY + 2}
          `}
          stroke="#FFFFFF"
          strokeWidth="0.8"
          strokeOpacity="0.30"
          fill="none"
        />
        {/* 6 lignes stonework horizontales */}
        {Array.from({ length: 6 }).map((_, i) => {
          const t = (i + 1) / 7;
          const lineY = bodyBottomY - t * (bodyBottomY - bodyTopY);
          const lineW = bodyW * (1 - t) + bodyTopW * t;
          return (
            <line
              key={`brick-${i}`}
              x1={cx - lineW / 2 + 1}
              x2={cx + lineW / 2 - 1}
              y1={lineY}
              y2={lineY}
              stroke="#000000"
              strokeWidth="0.4"
              strokeOpacity="0.32"
            />
          );
        })}

        {/* ─────── COLONNES ORNEMENTALES (gauche + droite, pleine hauteur) ─────── */}
        {[-1, 1].map((sgn) => {
          const colW = size * 0.012;
          const colXBottom = cx + sgn * (bodyW / 2 - colW * 0.5);
          const colXTop = cx + sgn * (bodyTopW / 2 - colW * 0.5);
          return (
            <path
              key={`col-${sgn}`}
              d={`
                M ${colXBottom - colW / 2} ${bodyBottomY}
                L ${colXBottom + colW / 2} ${bodyBottomY}
                L ${colXTop + colW / 2} ${bodyTopY}
                L ${colXTop - colW / 2} ${bodyTopY}
                Z
              `}
              fill="#0a0d1a"
              stroke={theme.accent}
              strokeWidth="0.5"
              strokeOpacity="0.65"
            />
          );
        })}

        {/* ─────── PORTE D'ENTRÉE (arche glowing au sol) ─────── */}
        {(() => {
          const dW = size * 0.04;
          const dH = size * 0.07;
          const dCx = cx;
          const dCy = bodyBottomY - dH * 0.5;
          return (
            <g>
              <rect
                x={dCx - dW / 2 - 1}
                y={dCy - dH / 2 - 0.5}
                width={dW + 2}
                height={dH + 1}
                rx={dW * 0.8}
                fill={theme.accent}
                opacity={0.20 + pulse * 0.18}
              />
              <path
                d={`
                  M ${dCx - dW / 2} ${bodyBottomY}
                  L ${dCx - dW / 2} ${dCy - dH * 0.2}
                  Q ${dCx - dW / 2} ${dCy - dH / 2 - dW / 2}, ${dCx} ${dCy - dH / 2 - dW / 2}
                  Q ${dCx + dW / 2} ${dCy - dH / 2 - dW / 2}, ${dCx + dW / 2} ${dCy - dH * 0.2}
                  L ${dCx + dW / 2} ${bodyBottomY}
                  Z
                `}
                fill={`url(#rt-door-${tier})`}
                stroke={theme.accent}
                strokeWidth="0.7"
                strokeOpacity="0.85"
              />
            </g>
          );
        })()}

        {/* ─────── FENÊTRES (10 = 10 tiers, bottom-up) ─────── */}
        {Array.from({ length: windowRows * windowsPerRow }).map((_, i) => {
          const tierIndex = i;
          const t = TIERS_BOTTOM_UP[tierIndex];
          const tTheme = tierTheme(t);
          const isActive = tierIndex === activeIdx;
          const isPassed = activeIdx >= 0 && tierIndex < activeIdx;

          const row = Math.floor(i / windowsPerRow); // 0..4
          const col = i % windowsPerRow;
          // Skip les rangées les plus basses si elles chevauchent la porte
          const rowFraction = (row + 0.7) / windowRows; // décalé pour éviter la porte
          const yWindow = bodyBottomY - rowFraction * (bodyBottomY - bodyTopY);
          const widthAtRow = bodyW * (1 - rowFraction) + bodyTopW * rowFraction;
          const xWindow = cx + (col === 0 ? -widthAtRow * 0.22 : widthAtRow * 0.22);

          const opacity = isActive ? 1 : isPassed ? 0.82 : 0.10;
          const fillC = isActive || isPassed ? `url(#rt-window-lit-${tier})` : "#0a0d1a";
          const strokeC = isActive || isPassed ? tTheme.accent : "#1a1f3a";

          return (
            <g key={`win-${i}`}>
              {(isActive || isPassed) && (
                <circle
                  cx={xWindow}
                  cy={yWindow}
                  r={4.5}
                  fill={tTheme.accent}
                  opacity={isActive ? 0.45 + pulse * 0.30 : 0.22}
                />
              )}
              {/* Fenêtre arquée : rect + arche dessus */}
              <path
                d={`
                  M ${xWindow - 1.8} ${yWindow + 3}
                  L ${xWindow - 1.8} ${yWindow - 1}
                  Q ${xWindow - 1.8} ${yWindow - 3}, ${xWindow} ${yWindow - 3}
                  Q ${xWindow + 1.8} ${yWindow - 3}, ${xWindow + 1.8} ${yWindow - 1}
                  L ${xWindow + 1.8} ${yWindow + 3}
                  Z
                `}
                fill={fillC}
                stroke={strokeC}
                strokeWidth="0.5"
                opacity={opacity}
              />
            </g>
          );
        })}

        {/* ─────── GRAND EMBLÈME CENTRAL (rosace tier) ─────── */}
        {(() => {
          const eY = bodyBottomY - 0.42 * (bodyBottomY - bodyTopY);
          const eR = size * 0.046;
          return (
            <g>
              {/* Halo */}
              <circle cx={cx} cy={eY} r={eR * 2.4} fill={theme.accent} opacity={0.22 + pulse * 0.30} />
              {/* Cadre pierre extérieur */}
              <circle
                cx={cx}
                cy={eY}
                r={eR + 1.8}
                fill="#0d0d22"
                stroke={theme.accent}
                strokeWidth="1.1"
                opacity="0.95"
              />
              {/* Cœur lumineux */}
              <circle
                cx={cx}
                cy={eY}
                r={eR}
                fill={`url(#rt-emblem-${tier})`}
                opacity={0.88 + pulse * 0.12}
              />
              {/* 8 rayons rotatifs (rosace) */}
              {Array.from({ length: 8 }).map((_, r) => {
                const ang = (r * Math.PI) / 4 + tick * 0.18;
                const rIn = eR + 0.5;
                const rOut = eR + 4.2;
                const x1 = cx + Math.cos(ang) * rIn;
                const y1 = eY + Math.sin(ang) * rIn;
                const x2 = cx + Math.cos(ang) * rOut;
                const y2 = eY + Math.sin(ang) * rOut;
                return (
                  <line
                    key={`ray-${r}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={theme.accent}
                    strokeWidth="0.8"
                    opacity={0.40 + pulse * 0.40}
                    strokeLinecap="round"
                  />
                );
              })}
              {/* Cœur central blanc qui pulse */}
              <circle
                cx={cx}
                cy={eY}
                r={eR * 0.35}
                fill="#FFFFFF"
                opacity={0.85 + pulse * 0.15}
              />
            </g>
          );
        })()}

        {/* ─────── ANNEAU DÉCORATIF (top du body) ─────── */}
        <rect
          x={cx - ringW / 2}
          y={ringY - size * 0.012}
          width={ringW}
          height={size * 0.014}
          rx="1"
          fill={`url(#rt-ring-${tier})`}
          stroke={theme.accent}
          strokeWidth="0.5"
          strokeOpacity="0.85"
        />
        {/* Anneau supplémentaire fin */}
        <rect
          x={cx - ringW / 2 - 1}
          y={ringY - size * 0.018}
          width={ringW + 2}
          height={size * 0.006}
          fill={theme.accent}
          opacity="0.85"
          rx="0.6"
        />

        {/* ─────── BATTLEMENTS (créneaux) ─────── */}
        {(() => {
          const bw = battlementW;
          const bH = size * 0.018;
          const merlonH = size * 0.020;
          const merlonCount = 5;
          const merlonW = bw / (merlonCount * 2 - 1);
          let d = `M ${cx - bw / 2} ${battlementBaseY}`;
          d += ` L ${cx + bw / 2} ${battlementBaseY}`;
          d += ` L ${cx + bw / 2} ${battlementBaseY - bH}`;
          for (let i = merlonCount * 2 - 1; i >= 0; i--) {
            const xR = cx - bw / 2 + i * merlonW;
            if (i % 2 === 0) {
              d += ` L ${xR + merlonW} ${battlementBaseY - bH}`;
              d += ` L ${xR + merlonW} ${battlementBaseY - bH - merlonH}`;
              d += ` L ${xR} ${battlementBaseY - bH - merlonH}`;
              d += ` L ${xR} ${battlementBaseY - bH}`;
            }
          }
          d += ` L ${cx - bw / 2} ${battlementBaseY - bH}`;
          d += ` Z`;
          return (
            <path
              d={d}
              fill={`url(#rt-stone-spire-${tier})`}
              stroke={theme.accent}
              strokeWidth="0.75"
              strokeOpacity="0.70"
            />
          );
        })()}

        {/* ─────── 4 BANNIÈRES suspendues sous battlements ─────── */}
        {[
          { x: cx - battlementW * 0.40, sw: sway },
          { x: cx - battlementW * 0.13, sw: swayAlt },
          { x: cx + battlementW * 0.13, sw: -swayAlt },
          { x: cx + battlementW * 0.40, sw: -sway },
        ].map((b, i) => {
          const bannerW = size * 0.032;
          const bannerH = size * 0.085;
          return (
            <g key={`banner-${i}`}>
              <path
                d={`
                  M ${b.x - bannerW / 2} ${battlementBaseY}
                  L ${b.x + b.sw} ${battlementBaseY + bannerH * 0.55}
                  L ${b.x + bannerW / 2 + b.sw} ${battlementBaseY + bannerH}
                  L ${b.x + bannerW / 2 + b.sw} ${battlementBaseY + bannerH * 0.85}
                  L ${b.x + b.sw} ${battlementBaseY + bannerH * 0.65}
                  L ${b.x - bannerW / 2 + b.sw} ${battlementBaseY + bannerH}
                  L ${b.x - bannerW / 2 + b.sw} ${battlementBaseY + bannerH * 0.85}
                  Z
                `}
                fill={theme.accent}
                opacity="0.78"
                stroke={theme.accent}
                strokeWidth="0.4"
              />
            </g>
          );
        })}

        {/* ─────── SPIRE BULBE (oignon, renflé en bas) ─────── */}
        <path
          d={`
            M ${cx - spireBaseW / 2} ${spireBaseY}
            Q ${cx - spireMidW / 2 - 1} ${spireBaseY - (spireBaseY - spireMidY) * 0.45}, ${cx - spireMidW / 2} ${spireMidY + 1}
            L ${cx + spireMidW / 2} ${spireMidY + 1}
            Q ${cx + spireMidW / 2 + 1} ${spireBaseY - (spireBaseY - spireMidY) * 0.45}, ${cx + spireBaseW / 2} ${spireBaseY}
            Z
          `}
          fill={`url(#rt-bulb-${tier})`}
          stroke={theme.accent}
          strokeWidth="0.8"
          strokeOpacity="0.85"
        />
        {/* Highlight reflet sur l'oignon */}
        <path
          d={`
            M ${cx - spireMidW * 0.2} ${spireMidY + (spireBaseY - spireMidY) * 0.25}
            Q ${cx - spireMidW * 0.35} ${spireMidY + (spireBaseY - spireMidY) * 0.5}, ${cx - spireMidW * 0.15} ${spireBaseY - 2}
          `}
          stroke="#FFFFFF"
          strokeWidth="0.9"
          strokeOpacity="0.45"
          fill="none"
        />

        {/* ─────── ANNEAU ENTRE OIGNON ET CÔNE ─────── */}
        <rect
          x={cx - spireMidW / 2 - 0.5}
          y={spireMidY - 0.5}
          width={spireMidW + 1}
          height={size * 0.012}
          fill={theme.accent}
          opacity="0.95"
          rx="0.6"
        />

        {/* ─────── CÔNE (transition vers pinnacle) ─────── */}
        <path
          d={`
            M ${cx - spireMidW / 2} ${spireConeBaseY + size * 0.012 - 0.5}
            L ${cx + spireMidW / 2} ${spireConeBaseY + size * 0.012 - 0.5}
            L ${cx + spireTopW / 2} ${spireTopY}
            L ${cx - spireTopW / 2} ${spireTopY}
            Z
          `}
          fill={`url(#rt-pinnacle-${tier})`}
          stroke={theme.accent}
          strokeWidth="0.7"
          strokeOpacity="0.75"
        />
        {/* Highlight gauche cône */}
        <path
          d={`
            M ${cx - spireMidW / 2 + 1} ${spireConeBaseY + size * 0.012}
            L ${cx - spireTopW / 2 + 1} ${spireTopY}
          `}
          stroke="#FFFFFF"
          strokeWidth="0.6"
          strokeOpacity="0.30"
          fill="none"
        />

        {/* ─────── PINNACLE (pointe) ─────── */}
        <path
          d={`
            M ${cx - spireTopW / 2} ${spireTopY}
            L ${cx + spireTopW / 2} ${spireTopY}
            L ${cx} ${pinnacleTipY}
            Z
          `}
          fill={`url(#rt-pinnacle-${tier})`}
          stroke={theme.accent}
          strokeWidth="0.6"
          strokeOpacity="0.80"
        />
        {/* Anneau jonction pinnacle */}
        <rect
          x={cx - spireTopW / 2 - 1}
          y={spireTopY - 1.2}
          width={spireTopW + 2}
          height={2}
          rx="0.7"
          fill={theme.accent}
          opacity="0.95"
        />

        {/* ─────── PETIT DRAPEAU au-dessus du pinnacle (sauf apex) ─────── */}
        {!apex && (
          <g>
            <line
              x1={cx}
              y1={pinnacleTipY}
              x2={cx}
              y2={pinnacleTipY - size * 0.05}
              stroke={theme.accent}
              strokeWidth="0.7"
              opacity="0.85"
            />
            <path
              d={`
                M ${cx} ${pinnacleTipY - size * 0.045}
                L ${cx + size * 0.02 + sway * 0.4} ${pinnacleTipY - size * 0.035}
                L ${cx} ${pinnacleTipY - size * 0.025}
                Z
              `}
              fill={theme.accent}
              opacity="0.85"
              stroke={theme.accent}
              strokeWidth="0.4"
            />
          </g>
        )}

        {/* ─────── COURONNE pour apex (au-dessus du pinnacle) ─────── */}
        {apex && (
          <g transform={`translate(${cx} ${pinnacleTipY - size * 0.035})`}>
            <circle cx="0" cy="0" r="7" fill={theme.accent} opacity={0.22 + pulse * 0.30} />
            <path
              d="M -6,2.5 L -4.2,-4 L -2.2,0 L 0,-6 L 2.2,0 L 4.2,-4 L 6,2.5 Z"
              fill={theme.accent}
              stroke="#FFFFFF"
              strokeWidth="0.5"
              strokeOpacity="0.65"
              style={{ filter: `drop-shadow(0 0 5px ${theme.glowStrong})` }}
            />
            <circle cx="0" cy="-2.5" r="1.3" fill="#FFFFFF" opacity="0.95" />
          </g>
        )}

        {/* ─────── CRISTAL FLOTTANT (au-dessus du tower) ─────── */}
        {(() => {
          const yC = apex ? crystalY - 6 : crystalY;
          const rotate = (tick * 30) % 360;
          const float = Math.sin(tick * 1.3) * 1.8;
          const baseR = 5.5;
          return (
            <g transform={`translate(${cx} ${yC + float})`}>
              {/* Halo cristal */}
              <circle cx="0" cy="0" r={baseR * 2.6} fill={theme.accent} opacity={0.30 + pulse * 0.40} />
              {/* Sparkle rays */}
              {Array.from({ length: 4 }).map((_, r) => {
                const ang = (r * Math.PI) / 2 + (tick * 60 * Math.PI) / 180;
                const x = Math.cos(ang) * baseR * 1.6;
                const y = Math.sin(ang) * baseR * 1.6;
                return (
                  <line
                    key={`spark-${r}`}
                    x1={0}
                    y1={0}
                    x2={x}
                    y2={y}
                    stroke="#FFFFFF"
                    strokeWidth="0.6"
                    opacity={0.30 + pulse * 0.30}
                    strokeLinecap="round"
                  />
                );
              })}
              <g transform={`rotate(${rotate})`}>
                {/* Cristal losange + facettes */}
                <polygon
                  points={`0,-${baseR} ${baseR * 0.7},0 0,${baseR} -${baseR * 0.7},0`}
                  fill={`url(#rt-crystal-${tier})`}
                  stroke="#FFFFFF"
                  strokeWidth="0.55"
                  strokeOpacity="0.75"
                  style={{ filter: `drop-shadow(0 0 6px ${theme.glowStrong})` }}
                />
                {/* Facette milieu (vertical) */}
                <line x1="0" y1={-baseR} x2="0" y2={baseR} stroke="#FFFFFF" strokeWidth="0.4" opacity="0.55" />
                <line x1={-baseR * 0.7} y1="0" x2={baseR * 0.7} y2="0" stroke="#FFFFFF" strokeWidth="0.4" opacity="0.55" />
                {/* Reflet */}
                <line x1="-1.5" y1="-1.8" x2="1.5" y2="0.9" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.95" />
              </g>
            </g>
          );
        })()}

        {/* ─────── PARTICULES ASCENDANTES ─────── */}
        {particles.map((p, i) => {
          const localTime = tick * particleSpeed + p.delay;
          const phase = (localTime % p.duration) / p.duration;
          const py = groundY - phase * (groundY - size * 0.02);
          const opacity =
            phase < 0.08 ? phase / 0.08 : phase > 0.92 ? Math.max(0, (1 - phase) / 0.08) : 1;
          const xBase = cx + p.side * (bodyW * 0.7 + p.offset * 0.4);
          const c = TYPE_COLORS[p.type];
          return (
            <circle
              key={`p-${i}`}
              cx={xBase}
              cy={py}
              r={p.sizeR}
              fill={c}
              opacity={opacity * 0.9}
              style={{ filter: `drop-shadow(0 0 3px ${c})` }}
            />
          );
        })}

        {/* ─────── ORBES EN ORBITE ─────── */}
        {orbits.map((o, i) => {
          const ang = tick * o.speed + o.offset;
          const tiltRad = (o.tilt * Math.PI) / 180;
          const orbR = size * 0.32;
          const x = cx + Math.cos(ang) * orbR;
          const y = o.yC + Math.sin(ang) * orbR * Math.sin(tiltRad);
          const z = Math.sin(ang) * Math.cos(tiltRad);
          const depth = 0.3 + 0.7 * ((z + 1) / 2);
          return (
            <g key={`orb-${i}`}>
              <ellipse
                cx={cx}
                cy={o.yC}
                rx={orbR}
                ry={orbR * Math.abs(Math.sin(tiltRad))}
                fill="none"
                stroke={o.color}
                strokeWidth="0.3"
                strokeDasharray="1 4"
                opacity="0.10"
              />
              <circle
                cx={x}
                cy={y}
                r={2.2}
                fill={o.color}
                opacity={depth}
                style={{ filter: `drop-shadow(0 0 4px ${o.color})` }}
              />
            </g>
          );
        })}

        {/* Pulsation ambient subtle */}
        <circle
          cx={cx}
          cy={size / 2}
          r={size * 0.46}
          fill="none"
          stroke={theme.accent}
          strokeWidth="0.3"
          opacity={0.08 + pulseSlow * 0.08}
          strokeDasharray="2 6"
        />
      </svg>
    </div>
  );
}
