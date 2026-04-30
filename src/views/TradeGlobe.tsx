// src/views/TradeGlobe.tsx
//
// Mini globe holographique avec arcs de trade — icône hero du GTS.
//  - Continents simplifiés en matrice de points (rotation lente).
//  - Arcs courbes type-colorés qui survolent le globe en boucle (~1.8s/cycle).
//  - Réutilise la palette TYPE_COLORS — cohérent avec HologramGlobe et SparringPokeballs.
//  - Pur React + SVG + RAF.
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

/* Points d'ancrage pour les arcs de trade (lat/lng + type Pokémon associé). */
const ANCHOR_POINTS: Array<{ lat: number; lng: number; type: PokeType }> = [
  { lat: 45, lng: 10, type: "electric" },
  { lat: 30, lng: -80, type: "fire" },
  { lat: -25, lng: 135, type: "grass" },
  { lat: 15, lng: 100, type: "water" },
  { lat: 60, lng: -150, type: "ice" },
  { lat: -35, lng: 20, type: "psychic" },
  { lat: 35, lng: 140, type: "dragon" },
  { lat: -42, lng: 170, type: "fairy" },
  { lat: 5, lng: -55, type: "fire" },
  { lat: 55, lng: 80, type: "ice" },
];

/* Continents très simplifiés (juste des "blobs" pour l'ambiance terre/mer). */
const CONTINENT_BLOBS = [
  { lat: 45, lng: -100, rLat: 18, rLng: 30 },
  { lat: -10, lng: -60, rLat: 18, rLng: 14 },
  { lat: 50, lng: 15, rLat: 12, rLng: 22 },
  { lat: 0, lng: 22, rLat: 22, rLng: 18 },
  { lat: 50, lng: 90, rLat: 18, rLng: 38 },
  { lat: -25, lng: 135, rLat: 8, rLng: 13 },
  { lat: 38, lng: 138, rLat: 6, rLng: 5 },
];

const ACCENT = "#A78BFA"; // violet GTS (cohérent avec --accent du launcher)

function isLand(lat: number, lng: number) {
  for (const c of CONTINENT_BLOBS) {
    const dLat = (lat - c.lat) / c.rLat;
    let dLng = lng - c.lng;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const dn = dLng / c.rLng;
    if (dLat * dLat + dn * dn < 1) return true;
  }
  return false;
}

function generateLandDots() {
  const dots: Array<{ lat: number; lng: number }> = [];
  const latStep = 10;
  const lngStep = 10;
  for (let lat = -75; lat <= 75; lat += latStep) {
    const scaleFactor = Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    const step = lngStep / scaleFactor;
    for (let lng = -180; lng < 180; lng += step) {
      if (isLand(lat, lng)) dots.push({ lat, lng });
    }
  }
  return dots;
}

export function TradeGlobe({ size = 48, className }: Props) {
  const [angle, setAngle] = useState(0);
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      // Rotation lente (~30s par tour)
      setAngle((a) => (a + ((2 * Math.PI) / 30000) * dt) % (2 * Math.PI));
      setTick(now / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;

  const project = (lat: number, lng: number) => {
    const phi = (lat * Math.PI) / 180;
    const theta = (lng * Math.PI) / 180 + angle;
    const x = Math.cos(phi) * Math.sin(theta);
    const y = Math.sin(phi);
    const z = Math.cos(phi) * Math.cos(theta);
    return { x: cx + x * r, y: cy - y * r, z };
  };

  const land = useMemo(() => generateLandDots(), []);

  // Cycle d'arc — chaque cycle pioche 2 points et dessine la trajectoire de trade
  const arcCycleMs = 1800;
  const arcAge = (tick * 1000) % arcCycleMs;
  const arcPhase = arcAge / arcCycleMs;
  const arcCycleIdx = Math.floor((tick * 1000) / arcCycleMs);
  const idxA = arcCycleIdx % ANCHOR_POINTS.length;
  const idxB = (arcCycleIdx * 7 + 3) % ANCHOR_POINTS.length;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "block",
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <radialGradient id="tg-fill" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.30" />
            <stop offset="50%" stopColor={ACCENT} stopOpacity="0.10" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.30" />
          </radialGradient>
          <radialGradient id="tg-halo" cx="50%" cy="50%" r="50%">
            <stop offset="68%" stopColor={ACCENT} stopOpacity="0" />
            <stop offset="92%" stopColor={ACCENT} stopOpacity="0.22" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Halo extérieur */}
        <circle cx={cx} cy={cy} r={r * 1.4} fill="url(#tg-halo)" />

        {/* Fill */}
        <circle cx={cx} cy={cy} r={r} fill="url(#tg-fill)" />

        {/* Outline */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={ACCENT}
          strokeWidth={0.6}
          opacity={0.7}
        />

        {/* Equator */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={r}
          ry={r * 0.18}
          fill="none"
          stroke={ACCENT}
          strokeWidth={0.4}
          opacity={0.4}
        />

        {/* Land dots */}
        {land.map((p, i) => {
          const { x, y, z } = project(p.lat, p.lng);
          if (z < 0) return null;
          const depth = Math.max(0, Math.min(1, z));
          const op = 0.18 + depth * 0.55;
          return (
            <circle
              key={`l-${i}`}
              cx={x}
              cy={y}
              r={0.7}
              fill={ACCENT}
              opacity={op}
            />
          );
        })}

        {/* Trade arc */}
        {(() => {
          const a = ANCHOR_POINTS[idxA];
          const b = ANCHOR_POINTS[idxB];
          if (!a || !b || idxA === idxB) return null;
          const pa = project(a.lat, a.lng);
          const pb = project(b.lat, b.lng);
          if (pa.z < 0 || pb.z < 0) return null;

          const mx = (pa.x + pb.x) / 2;
          const my = (pa.y + pb.y) / 2;
          const dx = mx - cx;
          const dy = my - cy;
          const len = Math.sqrt(dx * dx + dy * dy);
          const lift = 0.42;
          const ctrlX = cx + (dx / Math.max(len, 1)) * (len + r * lift);
          const ctrlY = cy + (dy / Math.max(len, 1)) * (len + r * lift);

          const opacity =
            arcPhase < 0.15
              ? arcPhase / 0.15
              : arcPhase < 0.75
                ? 1
                : Math.max(0, 1 - (arcPhase - 0.75) / 0.25);
          const arcColor = TYPE_COLORS[a.type];

          // Particle qui voyage le long de l'arc
          const t = Math.min(1, Math.max(0, (arcPhase - 0.15) / 0.6));
          const px =
            (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * ctrlX + t * t * pb.x;
          const py =
            (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * ctrlY + t * t * pb.y;

          return (
            <g opacity={opacity * 0.95}>
              <path
                d={`M ${pa.x} ${pa.y} Q ${ctrlX} ${ctrlY} ${pb.x} ${pb.y}`}
                fill="none"
                stroke={arcColor}
                strokeWidth={1}
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 2px ${arcColor})` }}
              />
              {/* Origine + destination (points lumineux aux extrémités) */}
              <circle
                cx={pa.x}
                cy={pa.y}
                r={1.1}
                fill={arcColor}
                style={{ filter: `drop-shadow(0 0 2px ${arcColor})` }}
              />
              <circle
                cx={pb.x}
                cy={pb.y}
                r={1.1}
                fill={arcColor}
                style={{ filter: `drop-shadow(0 0 2px ${arcColor})` }}
              />
              {/* Particule qui voyage */}
              <circle
                cx={px}
                cy={py}
                r={1.5}
                fill="#fff"
                style={{ filter: `drop-shadow(0 0 3px ${arcColor})` }}
              />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
