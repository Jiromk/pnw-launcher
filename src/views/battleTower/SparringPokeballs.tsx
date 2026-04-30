// src/views/battleTower/SparringPokeballs.tsx
//
// Deux Pokéballs en sparring — empty state du Combat Amical. V3.
//
// Fix V3 :
//  - Geometric fix : halves clippés au cercle (clipPath) → plus de débordement
//    au-dessus / en-dessous de l'outline (bug d'arc centré sur la bande au lieu
//    du centre de la sphère).
//  - Halos −30 % d'opacité pour aérer la zone centrale.
//  - Plasma swirl opacité ÷2 : balls visuellement séparées.
//  - ZAP plus long : balls éloignées (0.27/0.73 → 0.24/0.76) + déviation
//    augmentée (0.10 → 0.13).
//
// Pur React + SVG + RAF.
import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  size?: number;
  className?: string;
};

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

const ORBITS_LEFT: Array<{ tilt: number; speed: number; offset: number; type: PokeType }> = [
  { tilt: 25, speed: 0.55, offset: 0, type: "fire" },
  { tilt: -45, speed: 0.65, offset: Math.PI * 0.5, type: "water" },
  { tilt: 70, speed: 0.4, offset: Math.PI, type: "electric" },
  { tilt: -20, speed: 0.7, offset: Math.PI * 1.5, type: "psychic" },
];
const ORBITS_RIGHT: Array<{ tilt: number; speed: number; offset: number; type: PokeType }> = [
  { tilt: -30, speed: 0.6, offset: Math.PI * 0.25, type: "grass" },
  { tilt: 50, speed: 0.45, offset: Math.PI * 0.75, type: "ice" },
  { tilt: -65, speed: 0.55, offset: Math.PI * 1.25, type: "dragon" },
  { tilt: 35, speed: 0.7, offset: Math.PI * 1.75, type: "fairy" },
];

const ACCENT = "#34D399";
const ACCENT_GLOW = "rgba(52,211,153,0.35)";
const RED_TOP = "#EF4444";
const RED_DEEP = "#7F1D1D";
const RED_HIGHLIGHT = "#FCA5A5";

type Star = { x: number; y: number; r: number; phase: number };

function generateStars(w: number, h: number, count: number, seed0 = 91): Star[] {
  let seed = seed0;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * w,
      y: rand() * h,
      r: 0.3 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

export function SparringPokeballs({ size = 260, className }: Props) {
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

  const w = size;
  const h = size * 0.6;
  const ballR = size * 0.17;
  // Balls écartées pour laisser de la place au ZAP
  const leftCx = w * 0.24;
  const rightCx = w * 0.76;
  const cy = h * 0.5;

  // Bob + micro-vibration
  const bobAmpl = size * 0.022;
  const bobL = Math.sin(tick * 1.6) * bobAmpl;
  const bobR = Math.sin(tick * 1.6 + Math.PI) * bobAmpl;
  const vibL = Math.sin(tick * 18) * 0.7;
  const vibR = Math.sin(tick * 18 + Math.PI / 2) * 0.7;

  // Positions effectives des balls (utilisées pour clipPath ET PokeBallSVG)
  const leftCxFinal = leftCx + vibL;
  const leftCyFinal = cy + bobL;
  const rightCxFinal = rightCx + vibR;
  const rightCyFinal = cy + bobR;

  // ZAP cycle (~2.2s)
  const crackleCycleMs = 2200;
  const cycleAge = (tick * 1000) % crackleCycleMs;
  const cyclePhase = cycleAge / crackleCycleMs;
  const cycleIndex = Math.floor((tick * 1000) / crackleCycleMs);
  const fromLeft = cyclePhase < 0.5;
  const localPhase = fromLeft ? cyclePhase * 2 : (cyclePhase - 0.5) * 2;
  const crackleOpacity =
    localPhase < 0.18
      ? localPhase / 0.18
      : localPhase > 0.82
        ? Math.max(0, (1 - localPhase) / 0.18)
        : 1;

  // Path éclair plus long + plus jagged
  const cracklePath = (() => {
    const aX = fromLeft ? leftCxFinal + ballR * 0.92 : rightCxFinal - ballR * 0.92;
    const bX = fromLeft ? rightCxFinal - ballR * 0.92 : leftCxFinal + ballR * 0.92;
    const aY = fromLeft ? leftCyFinal : rightCyFinal;
    const bY = fromLeft ? rightCyFinal : leftCyFinal;
    const segments = 13;
    let seed = (cycleIndex * 9301 + 49297) % 233280;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const points: string[] = [`M ${aX.toFixed(2)} ${aY.toFixed(2)}`];
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const x = aX + (bX - aX) * t;
      const yLin = aY + (bY - aY) * t;
      const dev = (rand() - 0.5) * (size * 0.13);
      points.push(`L ${x.toFixed(2)} ${(yLin + dev).toFixed(2)}`);
    }
    points.push(`L ${bX.toFixed(2)} ${bY.toFixed(2)}`);
    return { path: points.join(" "), aX, aY, bX, bY };
  })();

  const crackleColor = cycleIndex % 2 === 0 ? "#FBBF24" : "#7DD3FC";
  const crackleGlow = cycleIndex % 2 === 0 ? "rgba(251,191,36,0.85)" : "rgba(125,211,252,0.85)";

  const stars = useMemo(() => generateStars(w, h, 40), [w, h]);
  const swirlT = tick * 0.6;

  return (
    <div
      className={className}
      style={{
        width: w,
        height: h,
        position: "relative",
        filter: `drop-shadow(0 0 22px ${ACCENT_GLOW})`,
      }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          {/* ─── ClipPaths : un par ball, position dynamique ─── */}
          <clipPath id="sp-ball-clip-left">
            <circle cx={leftCxFinal} cy={leftCyFinal} r={ballR} />
          </clipPath>
          <clipPath id="sp-ball-clip-right">
            <circle cx={rightCxFinal} cy={rightCyFinal} r={ballR} />
          </clipPath>

          {/* Halo aura émeraude (DIM −30%) */}
          <radialGradient id="sp-halo" cx="50%" cy="50%" r="50%">
            <stop offset="50%" stopColor={ACCENT} stopOpacity="0" />
            <stop offset="78%" stopColor={ACCENT} stopOpacity="0.21" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
          {/* Top half rouge SOLIDE 3D */}
          <radialGradient id="sp-red-top" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor={RED_HIGHLIGHT} stopOpacity="1" />
            <stop offset="50%" stopColor={RED_TOP} stopOpacity="1" />
            <stop offset="100%" stopColor={RED_DEEP} stopOpacity="1" />
          </radialGradient>
          {/* Bottom half blanc */}
          <radialGradient id="sp-white-bot" cx="35%" cy="65%" r="80%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="60%" stopColor="#E5E7EB" stopOpacity="1" />
            <stop offset="100%" stopColor="#9CA3AF" stopOpacity="1" />
          </radialGradient>
          {/* Bouton chrome */}
          <radialGradient id="sp-button" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="60%" stopColor="#F3F4F6" stopOpacity="1" />
            <stop offset="100%" stopColor="#9CA3AF" stopOpacity="1" />
          </radialGradient>
          {/* Pulse glow bouton */}
          <radialGradient id="sp-button-pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.85" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
          {/* Ombre flottante */}
          <radialGradient id="sp-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          {/* Plasma — DIM (opacité ~50%) */}
          <radialGradient id="sp-plasma-1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
            <stop offset="60%" stopColor={ACCENT} stopOpacity="0.08" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sp-plasma-2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#A7F3D0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#A7F3D0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ───── ÉTOILES en fond ───── */}
        <g opacity="0.7">
          {stars.map((s, i) => {
            const tw = 0.3 + 0.7 * Math.abs(Math.sin(tick * 1.4 + s.phase));
            return (
              <circle
                key={`star-${i}`}
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill="#FFFFFF"
                opacity={tw * 0.55}
              />
            );
          })}
        </g>

        {/* ───── PLASMA SUBTLE entre les balls ───── */}
        <g>
          {[0, 1, 2].map((j) => {
            const ang = swirlT + (j * Math.PI) / 3;
            const cx0 = (leftCx + rightCx) / 2;
            const rx = (rightCx - leftCx) * (0.35 + j * 0.06);
            const ry = size * (0.04 + j * 0.014);
            return (
              <ellipse
                key={`plasma-${j}`}
                cx={cx0}
                cy={cy}
                rx={rx}
                ry={ry}
                fill={j === 1 ? "url(#sp-plasma-2)" : "url(#sp-plasma-1)"}
                opacity={0.38 - j * 0.08}
                transform={`rotate(${(ang * 180) / Math.PI} ${cx0} ${cy})`}
              />
            );
          })}
        </g>

        {/* Étincelles ambiantes au milieu */}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (tick * 0.7 + (i * Math.PI) / 3) % (Math.PI * 2);
          const baseX = (leftCx + rightCx) / 2;
          const wobble = Math.sin(a) * (rightCx - leftCx) * 0.22;
          const yWobble = Math.cos(a * 1.7 + i) * size * 0.030;
          const opacity = 0.18 + Math.abs(Math.sin(tick * 2 + i)) * 0.32;
          return (
            <circle
              key={`amb-${i}`}
              cx={baseX + wobble}
              cy={cy + yWobble}
              r={1.3}
              fill="#A7F3D0"
              opacity={opacity}
              style={{ filter: "drop-shadow(0 0 3px rgba(167,243,208,0.85))" }}
            />
          );
        })}

        {/* ───── OMBRE FLOTTANTE au sol ───── */}
        <ellipse
          cx={leftCxFinal}
          cy={cy + ballR + 6 - bobL * 0.4}
          rx={ballR * 0.85}
          ry={ballR * 0.18}
          fill="url(#sp-shadow)"
        />
        <ellipse
          cx={rightCxFinal}
          cy={cy + ballR + 6 - bobR * 0.4}
          rx={ballR * 0.85}
          ry={ballR * 0.18}
          fill="url(#sp-shadow)"
        />

        {/* ───── POKÉBALL GAUCHE ───── */}
        <PokeBallSVG cx={leftCxFinal} cy={leftCyFinal} r={ballR} side="left" tick={tick} clipId="sp-ball-clip-left" />

        {/* ───── POKÉBALL DROITE ───── */}
        <PokeBallSVG cx={rightCxFinal} cy={rightCyFinal} r={ballR} side="right" tick={tick} clipId="sp-ball-clip-right" />

        {/* ───── PARTICULES ORBITALES gauche ───── */}
        {ORBITS_LEFT.map((o, i) => {
          const angle = tick * o.speed + o.offset;
          const tiltRad = (o.tilt * Math.PI) / 180;
          const orbitR = ballR * 1.65;
          const x = leftCxFinal + Math.cos(angle) * orbitR;
          const y = leftCyFinal + Math.sin(angle) * orbitR * Math.sin(tiltRad);
          const z = Math.sin(angle) * Math.cos(tiltRad);
          const depth = 0.3 + 0.7 * ((z + 1) / 2);
          const c = TYPE_COLORS[o.type];
          return (
            <g key={`orbL-${i}`}>
              <circle
                cx={x}
                cy={y}
                r={3.2 * depth}
                fill={c}
                opacity={depth * 0.85}
                style={{ filter: `drop-shadow(0 0 5px ${c})` }}
              />
              <circle cx={x} cy={y} r={1.2 * depth} fill="#FFFFFF" opacity={depth * 0.95} />
            </g>
          );
        })}

        {/* ───── PARTICULES ORBITALES droite ───── */}
        {ORBITS_RIGHT.map((o, i) => {
          const angle = tick * o.speed + o.offset;
          const tiltRad = (o.tilt * Math.PI) / 180;
          const orbitR = ballR * 1.65;
          const x = rightCxFinal + Math.cos(angle) * orbitR;
          const y = rightCyFinal + Math.sin(angle) * orbitR * Math.sin(tiltRad);
          const z = Math.sin(angle) * Math.cos(tiltRad);
          const depth = 0.3 + 0.7 * ((z + 1) / 2);
          const c = TYPE_COLORS[o.type];
          return (
            <g key={`orbR-${i}`}>
              <circle
                cx={x}
                cy={y}
                r={3.2 * depth}
                fill={c}
                opacity={depth * 0.85}
                style={{ filter: `drop-shadow(0 0 5px ${c})` }}
              />
              <circle cx={x} cy={y} r={1.2 * depth} fill="#FFFFFF" opacity={depth * 0.95} />
            </g>
          );
        })}

        {/* ───── ZAP triple-couche entre les balls ───── */}
        {crackleOpacity > 0 && (
          <g opacity={crackleOpacity}>
            {/* Outer glow large */}
            <path
              d={cracklePath.path}
              fill="none"
              stroke={crackleColor}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.30}
              style={{ filter: `drop-shadow(0 0 12px ${crackleGlow})` }}
            />
            {/* Mid layer */}
            <path
              d={cracklePath.path}
              fill="none"
              stroke={crackleColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
            {/* Core blanc */}
            <path
              d={cracklePath.path}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.98}
            />

            {/* Sparks aux 2 extrémités */}
            {[
              { x: cracklePath.aX, y: cracklePath.aY },
              { x: cracklePath.bX, y: cracklePath.bY },
            ].map((p, idx) => (
              <g key={`spark-${idx}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={5 + crackleOpacity * 3}
                  fill={crackleColor}
                  opacity={crackleOpacity * 0.55}
                  style={{ filter: `drop-shadow(0 0 8px ${crackleGlow})` }}
                />
                <circle cx={p.x} cy={p.y} r={2.5} fill="#FFFFFF" opacity="0.95" />
                {Array.from({ length: 6 }).map((_, r) => {
                  const ang = (r * Math.PI) / 3 + tick * 8;
                  const len = 6 + crackleOpacity * 4;
                  return (
                    <line
                      key={`ray-${idx}-${r}`}
                      x1={p.x}
                      y1={p.y}
                      x2={p.x + Math.cos(ang) * len}
                      y2={p.y + Math.sin(ang) * len}
                      stroke={crackleColor}
                      strokeWidth={0.9}
                      opacity={crackleOpacity * 0.85}
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

/* ───────────────── Pokéball SVG (clipped → outline propre) ───────────────── */
function PokeBallSVG({
  cx,
  cy,
  r,
  side,
  tick,
  clipId,
}: {
  cx: number;
  cy: number;
  r: number;
  side: "left" | "right";
  tick: number;
  clipId: string;
}) {
  const sideOffset = side === "left" ? 0 : Math.PI;
  const buttonPulse = 0.55 + 0.45 * Math.sin(tick * 2.4 + sideOffset);
  const buttonR = r * 0.20;
  const bandHalfH = r * 0.10;

  return (
    <g>
      {/* Halo aura extérieure (PAS clippé) */}
      <circle cx={cx} cy={cy} r={r * 1.85} fill="url(#sp-halo)" />

      {/* Tout le contenu du ball est CLIPPÉ au cercle r → pas de débordement */}
      <g clipPath={`url(#${clipId})`}>
        {/* Top half rouge — rect plein, clippé */}
        <rect
          x={cx - r - 1}
          y={cy - r - 1}
          width={r * 2 + 2}
          height={r + 1}
          fill="url(#sp-red-top)"
        />
        {/* Bottom half blanc — rect plein, clippé */}
        <rect
          x={cx - r - 1}
          y={cy}
          width={r * 2 + 2}
          height={r + 1}
          fill="url(#sp-white-bot)"
        />
        {/* Bande noire centrale ÉPAISSE */}
        <rect
          x={cx - r - 1}
          y={cy - bandHalfH * 0.5}
          width={r * 2 + 2}
          height={bandHalfH}
          fill="#0a0a0a"
        />
        {/* Petite ligne d'accent émeraude au milieu */}
        <line
          x1={cx - r}
          y1={cy}
          x2={cx + r}
          y2={cy}
          stroke="#34D399"
          strokeOpacity="0.30"
          strokeWidth="0.4"
        />

        {/* Reflets spéculaires (clippés au ball) */}
        <ellipse
          cx={cx - r * 0.40}
          cy={cy - r * 0.50}
          rx={r * 0.32}
          ry={r * 0.18}
          fill="#FFFFFF"
          opacity="0.55"
        />
        <ellipse
          cx={cx - r * 0.45}
          cy={cy - r * 0.62}
          rx={r * 0.10}
          ry={r * 0.06}
          fill="#FFFFFF"
          opacity="0.85"
        />
        <ellipse
          cx={cx - r * 0.35}
          cy={cy + r * 0.55}
          rx={r * 0.25}
          ry={r * 0.10}
          fill="#FFFFFF"
          opacity="0.45"
        />
      </g>

      {/* Outline circle (PAS clippé, tracé sur la circonférence exacte) */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="1"
        strokeOpacity="0.85"
      />

      {/* Pulse halo accent du bouton (PAS clippé pour rayonner au-delà du ball) */}
      <circle
        cx={cx}
        cy={cy}
        r={buttonR * (1.6 + buttonPulse * 0.8)}
        fill="url(#sp-button-pulse)"
        opacity={buttonPulse * 0.55}
      />

      {/* Bouton central (au-dessus de tout) */}
      <circle cx={cx} cy={cy} r={buttonR * 1.20} fill="#0a0a0a" />
      <circle cx={cx} cy={cy} r={buttonR} fill="url(#sp-button)" stroke="#0a0a0a" strokeWidth="1" />
      <circle cx={cx - buttonR * 0.30} cy={cy - buttonR * 0.30} r={buttonR * 0.30} fill="#FFFFFF" opacity="0.85" />
      <circle cx={cx} cy={cy} r={buttonR * 0.40} fill="#34D399" opacity={0.45 + buttonPulse * 0.40} />
    </g>
  );
}
