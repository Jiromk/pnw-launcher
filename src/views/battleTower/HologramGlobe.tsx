// src/views/battleTower/HologramGlobe.tsx
//
// Globe holographique stylé Pokémon :
//  - Continents dessinés en matrice de points
//  - 20+ points de "joueurs" aux couleurs des types Pokémon (feu, eau, etc.)
//  - Atmosphère bleutée sur le bord + éclairage directionnel (côté jour/nuit)
//  - Axe incliné 23.5° (comme la Terre)
//  - Champ d'étoiles en fond
//  - Arcs de connexion curvilignes entre 2 points au hasard
//  - Ondes de pulse qui émanent de certains points
//  - Particules en orbite
//  - Scanline subtile
//
// 100 % pur React + SVG + requestAnimationFrame, aucune dépendance externe.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { tierTheme, type RankTier } from "../../ranked";

type Intensity = "idle" | "searching" | "found";

type Props = {
  size?: number;
  tier?: RankTier;
  intensity?: Intensity;
  className?: string;
};

/* ───────────────── Couleurs type Pokémon ───────────────── */

const TYPE_COLORS = {
  fire: "#F87171",     // rouge-orangé
  water: "#60A5FA",    // bleu
  grass: "#34D399",    // vert
  electric: "#FBBF24", // jaune doré
  psychic: "#F472B6",  // rose
  ice: "#7DD3FC",      // cyan glacé
  dragon: "#C084FC",   // violet
  fairy: "#FDA4AF",    // rose pâle
} as const;
type PokeType = keyof typeof TYPE_COLORS;

/* ───────────────── Points (joueurs) ─────────────────
 * Chacun a une couleur de type, une phase de scintillement et une lat/lng. */
const POINTS: Array<{
  lat: number;
  lng: number;
  type: PokeType;
  blinkPhase: number;
}> = [
  { lat: 45, lng: 10, type: "electric", blinkPhase: 0.0 },
  { lat: 30, lng: -80, type: "fire", blinkPhase: 0.35 },
  { lat: -25, lng: 135, type: "grass", blinkPhase: 0.7 },
  { lat: 15, lng: 100, type: "water", blinkPhase: 1.1 },
  { lat: 60, lng: -150, type: "ice", blinkPhase: 1.5 },
  { lat: -35, lng: 20, type: "psychic", blinkPhase: 1.9 },
  { lat: 55, lng: 45, type: "dragon", blinkPhase: 0.2 },
  { lat: -50, lng: -65, type: "fairy", blinkPhase: 0.55 },
  { lat: 5, lng: -55, type: "fire", blinkPhase: 0.9 },
  { lat: 35, lng: 140, type: "water", blinkPhase: 1.3 },
  { lat: -10, lng: 75, type: "electric", blinkPhase: 1.7 },
  { lat: 70, lng: 85, type: "ice", blinkPhase: 2.0 },
  { lat: -60, lng: 120, type: "psychic", blinkPhase: 0.4 },
  { lat: 20, lng: 55, type: "grass", blinkPhase: 0.75 },
  { lat: -18, lng: -170, type: "dragon", blinkPhase: 1.0 },
  { lat: 48, lng: -10, blinkPhase: 1.4, type: "fire" },
  { lat: -5, lng: 15, type: "water", blinkPhase: 1.8 },
  { lat: 25, lng: 170, type: "fairy", blinkPhase: 0.15 },
  { lat: -42, lng: 170, type: "grass", blinkPhase: 0.6 },
  { lat: 8, lng: -40, type: "psychic", blinkPhase: 1.05 },
  { lat: 62, lng: 50, type: "ice", blinkPhase: 0.25 },
  { lat: -30, lng: -170, type: "electric", blinkPhase: 0.85 },
  { lat: 18, lng: 30, type: "dragon", blinkPhase: 1.65 },
  { lat: -15, lng: -150, type: "fairy", blinkPhase: 0.45 },
];

/* ───────────────── Continents ───────────────── */

type ContinentBlob = { lat: number; lng: number; rLat: number; rLng: number };

const CONTINENTS: ContinentBlob[] = [
  // Amérique du Nord
  { lat: 55, lng: -100, rLat: 18, rLng: 35 },
  { lat: 38, lng: -98, rLat: 15, rLng: 22 },
  { lat: 24, lng: -102, rLat: 8, rLng: 10 },
  { lat: 65, lng: -150, rLat: 8, rLng: 18 },
  // Amérique du Sud
  { lat: -5, lng: -62, rLat: 15, rLng: 14 },
  { lat: -25, lng: -65, rLat: 14, rLng: 11 },
  { lat: -45, lng: -72, rLat: 12, rLng: 5 },
  // Groenland
  { lat: 72, lng: -42, rLat: 10, rLng: 15 },
  // Europe
  { lat: 50, lng: 10, rLat: 10, rLng: 18 },
  { lat: 60, lng: 20, rLat: 12, rLng: 22 },
  { lat: 40, lng: 0, rLat: 8, rLng: 10 },
  // Afrique
  { lat: 10, lng: 18, rLat: 18, rLng: 20 },
  { lat: -15, lng: 22, rLat: 18, rLng: 16 },
  { lat: -28, lng: 25, rLat: 8, rLng: 9 },
  // Asie
  { lat: 55, lng: 80, rLat: 18, rLng: 35 },
  { lat: 40, lng: 95, rLat: 15, rLng: 30 },
  { lat: 25, lng: 82, rLat: 12, rLng: 14 },
  { lat: 10, lng: 107, rLat: 10, rLng: 12 },
  { lat: 38, lng: 50, rLat: 10, rLng: 15 },
  // Indonésie / îles SE
  { lat: -3, lng: 120, rLat: 6, rLng: 15 },
  // Australie
  { lat: -25, lng: 135, rLat: 9, rLng: 13 },
  { lat: -42, lng: 172, rLat: 4, rLng: 4 },
  // Japon
  { lat: 38, lng: 138, rLat: 8, rLng: 5 },
  // Antarctique
  { lat: -82, lng: 0, rLat: 8, rLng: 180 },
];

function isLand(lat: number, lng: number): boolean {
  for (const c of CONTINENTS) {
    const dLat = (lat - c.lat) / c.rLat;
    let dLngRaw = lng - c.lng;
    if (dLngRaw > 180) dLngRaw -= 360;
    if (dLngRaw < -180) dLngRaw += 360;
    const dLng = dLngRaw / c.rLng;
    if (dLat * dLat + dLng * dLng < 1) return true;
  }
  return false;
}

function generateLandGrid(): Array<{ lat: number; lng: number }> {
  const land: Array<{ lat: number; lng: number }> = [];
  const latStep = 5;
  const lngStep = 4;
  for (let lat = -85; lat <= 85; lat += latStep) {
    const scaleFactor = Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    const step = lngStep / scaleFactor;
    for (let lng = -180; lng < 180; lng += step) {
      if (isLand(lat, lng)) land.push({ lat, lng });
    }
  }
  return land;
}

/* ───────────────── Champ d'étoiles (fond) ───────────────── */

type Star = { x: number; y: number; size: number; phase: number };

function generateStars(size: number, count: number): Star[] {
  // Seeded PRNG pour avoir des étoiles stables (pas random() qui change à chaque render)
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.41;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    // Position aléatoire dans un rectangle, mais on exclut les étoiles trop proches du globe
    let x = 0, y = 0;
    for (let tries = 0; tries < 10; tries++) {
      x = rand() * size;
      y = rand() * size;
      const dx = x - cx;
      const dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) > r * 1.12) break;
    }
    stars.push({
      x,
      y,
      size: 0.3 + rand() * 1.2,
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

/* ───────────────── Composant principal ───────────────── */

export function HologramGlobe({
  size = 220,
  tier = "gold",
  intensity = "idle",
  className,
}: Props) {
  const theme = tierTheme(tier);
  const [angle, setAngle] = useState(0);
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Vitesse rotation
  const speed =
    intensity === "found"
      ? (2 * Math.PI) / 6000
      : intensity === "searching"
        ? (2 * Math.PI) / 22000
        : (2 * Math.PI) / 45000;

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      setAngle((a) => (a + speed * dt) % (2 * Math.PI));
      setTick(now / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [speed]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const tiltDeg = -23.5; // inclinaison comme la Terre

  // Projection (lat, lng) → 2D avec rotation autour de l'axe Y
  const project = (lat: number, lng: number) => {
    const phi = (lat * Math.PI) / 180;
    const theta = (lng * Math.PI) / 180 + angle;
    const x = Math.cos(phi) * Math.sin(theta);
    const y = Math.sin(phi);
    const z = Math.cos(phi) * Math.cos(theta);
    return { x: cx + x * r, y: cy - y * r, z };
  };

  const meridians = useMemo(
    () =>
      Array.from({ length: 8 }).map((_, i) => ({
        baseAngle: (i * Math.PI) / 8,
      })),
    [],
  );
  const parallels = [-60, -30, 0, 30, 60];
  const landGrid = useMemo(() => generateLandGrid(), []);
  const stars = useMemo(() => generateStars(size, 35), [size]);

  // ── Arcs de connexion : on choisit une paire de points aléatoires
  //    qui s'affiche + s'efface en boucle toutes les 3.5s.
  const arcCycleMs = 3500;
  const arcProgress = (tick * 1000) % arcCycleMs; // 0..arcCycleMs
  const arcPhase = arcProgress / arcCycleMs; // 0..1
  // Index des 2 points, change à chaque cycle
  const arcCycleIndex = Math.floor((tick * 1000) / arcCycleMs);
  const arcIdxA = arcCycleIndex % POINTS.length;
  const arcIdxB = (arcCycleIndex * 7 + 3) % POINTS.length;

  // ── Pulse : ping sonar sur un point qui change
  const pulseCycleMs = 2200;
  const pulseProgress = (tick * 1000) % pulseCycleMs;
  const pulsePhase = pulseProgress / pulseCycleMs;
  const pulseIdx = Math.floor((tick * 1000) / pulseCycleMs) % POINTS.length;

  // ── Particules en orbite ──
  const orbits = [
    { tilt: 30, speed: 0.4, offset: 0, color: theme.accent },
    { tilt: -55, speed: 0.55, offset: Math.PI, color: "#FFFFFF" },
    { tilt: 75, speed: 0.35, offset: Math.PI / 2, color: theme.accent },
  ];

  const color = theme.accent;
  const colorSoft = theme.accent + "40";

  /** Couleur "atmosphère" — un bleu légèrement accenté par le tier. */
  const atmoColor = "#60A5FA";

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
        filter: `drop-shadow(0 0 16px ${theme.glow})`,
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          {/* Fill intérieur du globe : dégradé radial offset (simule le soleil) */}
          <radialGradient id={`globe-fill-${tier}`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="45%" stopColor={color} stopOpacity="0.10" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
          </radialGradient>
          {/* Atmosphère (halo bleuté sur le bord) */}
          <radialGradient id={`globe-atmo-${tier}`} cx="50%" cy="50%" r="50%">
            <stop offset="65%" stopColor={atmoColor} stopOpacity="0" />
            <stop offset="85%" stopColor={atmoColor} stopOpacity="0.22" />
            <stop offset="96%" stopColor={atmoColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={atmoColor} stopOpacity="0" />
          </radialGradient>
          {/* Halo extérieur dans la couleur du tier */}
          <radialGradient id={`globe-halo-${tier}`} cx="50%" cy="50%" r="50%">
            <stop offset="72%" stopColor={color} stopOpacity="0" />
            <stop offset="88%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          {/* Terminateur (ombre côté "nuit" du globe) */}
          <radialGradient id={`globe-shadow-${tier}`} cx="70%" cy="65%" r="65%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="60%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
          </radialGradient>
          {/* Clip pour scanline */}
          <clipPath id={`globe-clip-${tier}`}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>

        {/* ───── Fond : étoiles ───── */}
        <g opacity="0.9">
          {stars.map((s, i) => {
            const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(tick * 1.5 + s.phase));
            return (
              <circle
                key={`star-${i}`}
                cx={s.x}
                cy={s.y}
                r={s.size}
                fill="#FFFFFF"
                opacity={twinkle * 0.6}
              />
            );
          })}
        </g>

        {/* ───── Halo extérieur (tier color) ───── */}
        <circle cx={cx} cy={cy} r={r * 1.28} fill={`url(#globe-halo-${tier})`} />

        {/* ───── GROUPE inclinable : tout ce qui compose le globe ───── */}
        <g transform={`rotate(${tiltDeg} ${cx} ${cy})`}>
          {/* Atmosphère (bord bleuté) */}
          <circle cx={cx} cy={cy} r={r * 1.08} fill={`url(#globe-atmo-${tier})`} />

          {/* Fill du globe */}
          <circle cx={cx} cy={cy} r={r} fill={`url(#globe-fill-${tier})`} />

          {/* Parallèles */}
          {parallels.map((lat) => {
            const phi = (lat * Math.PI) / 180;
            const ry = r * Math.cos(phi) * 0.25;
            const cyOffset = cy - Math.sin(phi) * r;
            return (
              <ellipse
                key={`par-${lat}`}
                cx={cx}
                cy={cyOffset}
                rx={r * Math.cos(phi)}
                ry={ry}
                fill="none"
                stroke={lat === 0 ? color : colorSoft}
                strokeWidth={lat === 0 ? 0.8 : 0.45}
                opacity={lat === 0 ? 0.55 : 0.35}
              />
            );
          })}

          {/* Méridiens */}
          {meridians.map(({ baseAngle }, i) => {
            const effectiveAngle = baseAngle + angle;
            const rx = Math.abs(Math.sin(effectiveAngle)) * r;
            const alpha = 0.2 + Math.abs(Math.sin(effectiveAngle)) * 0.35;
            return (
              <ellipse
                key={`mer-${i}`}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={r}
                fill="none"
                stroke={color}
                strokeWidth={0.5}
                opacity={alpha}
              />
            );
          })}

          {/* Outline */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={1}
            opacity={0.7}
          />

          {/* Terres fermes */}
          {landGrid.map((p, i) => {
            const { x, y, z } = project(p.lat, p.lng);
            if (z < 0) return null;
            const depthAlpha = Math.max(0, Math.min(1, z));
            // Côté "jour" vs "nuit" : le côté droit est illuminé, le gauche en pénombre
            const dayNight = 0.5 + 0.5 * (x - cx) / r;
            const dotRadius = 0.6 + depthAlpha * 0.6;
            return (
              <circle
                key={`land-${i}`}
                cx={x}
                cy={y}
                r={dotRadius}
                fill={color}
                opacity={(0.15 + depthAlpha * 0.45) * (0.4 + dayNight * 0.6)}
              />
            );
          })}

          {/* Terminateur (ombre nocturne) par-dessus */}
          <circle cx={cx} cy={cy} r={r} fill={`url(#globe-shadow-${tier})`} />

          {/* Scanline */}
          <g
            clipPath={`url(#globe-clip-${tier})`}
            opacity={intensity === "idle" ? 0.25 : 0.55}
          >
            <rect
              className="hologram-scanline"
              x={cx - r}
              y={cy - r}
              width={r * 2}
              height={2}
              fill={color}
              style={{
                animationDuration:
                  intensity === "found" ? "1.2s" : intensity === "searching" ? "3s" : "5s",
                // @ts-ignore
                "--globe-size": `${size}px`,
              }}
            />
          </g>

          {/* ───── Arc de connexion entre 2 points ───── */}
          {(() => {
            const a = POINTS[arcIdxA];
            const b = POINTS[arcIdxB];
            if (!a || !b || arcIdxA === arcIdxB) return null;
            const pa = project(a.lat, a.lng);
            const pb = project(b.lat, b.lng);
            if (pa.z < 0 || pb.z < 0) return null;
            // Point médian en hauteur (au-dessus de la sphère pour l'arc)
            const mx = (pa.x + pb.x) / 2;
            const my = (pa.y + pb.y) / 2;
            // Vecteur centre → midpoint, étiré pour sortir du globe
            const dx = mx - cx;
            const dy = my - cy;
            const len = Math.sqrt(dx * dx + dy * dy);
            const liftFactor = 0.35; // hauteur de l'arc
            const controlX = cx + (dx / Math.max(len, 1)) * (len + r * liftFactor);
            const controlY = cy + (dy / Math.max(len, 1)) * (len + r * liftFactor);
            // Fade : progress 0→0.15 = fade in, 0.15→0.7 = full, 0.7→1 = fade out
            const opacity =
              arcPhase < 0.15
                ? arcPhase / 0.15
                : arcPhase < 0.7
                  ? 1
                  : Math.max(0, 1 - (arcPhase - 0.7) / 0.3);
            const arcColor = TYPE_COLORS[a.type];
            return (
              <g opacity={opacity * 0.9}>
                <path
                  d={`M ${pa.x} ${pa.y} Q ${controlX} ${controlY} ${pb.x} ${pb.y}`}
                  fill="none"
                  stroke={arcColor}
                  strokeWidth={1.3}
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 3px ${arcColor})` }}
                />
                {/* Particule qui se déplace le long de l'arc */}
                {(() => {
                  const t = Math.min(
                    1,
                    Math.max(0, (arcPhase - 0.15) / 0.55),
                  );
                  const px =
                    (1 - t) * (1 - t) * pa.x +
                    2 * (1 - t) * t * controlX +
                    t * t * pb.x;
                  const py =
                    (1 - t) * (1 - t) * pa.y +
                    2 * (1 - t) * t * controlY +
                    t * t * pb.y;
                  return (
                    <circle
                      cx={px}
                      cy={py}
                      r={1.8}
                      fill="#FFFFFF"
                      style={{
                        filter: `drop-shadow(0 0 4px ${arcColor})`,
                      }}
                    />
                  );
                })()}
              </g>
            );
          })()}

          {/* ───── Points (joueurs, multicolores) ───── */}
          {POINTS.map((p, i) => {
            const { x, y, z } = project(p.lat, p.lng);
            if (z < -0.1) return null;
            const depthAlpha = Math.max(0, Math.min(1, z + 0.1));
            const dayNight = 0.5 + 0.5 * (x - cx) / r;
            const blink =
              0.4 + 0.6 * Math.sin(tick * 2.2 + p.blinkPhase * Math.PI * 2);
            const radius = 1.4 + blink * 1.5;
            const baseOpacity = 0.35 + depthAlpha * 0.65;
            const finalOpacity = baseOpacity * (0.45 + blink * 0.55);
            const pointColor = TYPE_COLORS[p.type];
            return (
              <g key={`pt-${i}`}>
                {/* Glow large */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius * 2.8}
                  fill={pointColor}
                  opacity={finalOpacity * 0.18 * (0.5 + dayNight * 0.5)}
                />
                {/* Point coloré */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={pointColor}
                  opacity={finalOpacity}
                  style={{ filter: `drop-shadow(0 0 4px ${pointColor})` }}
                />
                {/* Noyau blanc */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius * 0.35}
                  fill="#FFFFFF"
                  opacity={finalOpacity * 0.95}
                />
              </g>
            );
          })}

          {/* ───── Pulse "sonar" sur un point aléatoire ───── */}
          {(() => {
            const p = POINTS[pulseIdx];
            if (!p) return null;
            const { x, y, z } = project(p.lat, p.lng);
            if (z < 0) return null;
            const pulseR = 3 + pulsePhase * 18;
            const pulseOpacity = Math.max(0, 1 - pulsePhase) * 0.8;
            const pulseColor = TYPE_COLORS[p.type];
            return (
              <circle
                cx={x}
                cy={y}
                r={pulseR}
                fill="none"
                stroke={pulseColor}
                strokeWidth={1.2}
                opacity={pulseOpacity}
              />
            );
          })()}

          {/* Pôles marqués */}
          <circle cx={cx} cy={cy - r} r={1.5} fill={color} opacity={0.35} />
          <circle cx={cx} cy={cy + r} r={1.5} fill={color} opacity={0.35} />
        </g>

        {/* ───── Particules en orbite (en dehors du groupe incliné) ───── */}
        {orbits.map((o, i) => {
          const orbitAngle = tick * o.speed + o.offset;
          const tiltRad = (o.tilt * Math.PI) / 180;
          const orbitR = r * 1.18;
          const x = cx + Math.cos(orbitAngle) * orbitR;
          const y = cy + Math.sin(orbitAngle) * orbitR * Math.sin(tiltRad);
          // Profondeur = z en fonction de l'orbite (pour l'opacité front/back)
          const z = Math.sin(orbitAngle) * Math.cos(tiltRad);
          const depth = 0.3 + 0.7 * ((z + 1) / 2);
          return (
            <g key={`orbit-${i}`}>
              {/* Trail discret (cercle de l'orbite) */}
              <ellipse
                cx={cx}
                cy={cy}
                rx={orbitR}
                ry={orbitR * Math.abs(Math.sin(tiltRad))}
                fill="none"
                stroke={o.color}
                strokeWidth={0.3}
                strokeDasharray="1 3"
                opacity={0.1}
                transform={`rotate(${i * 20} ${cx} ${cy})`}
              />
              {/* La particule */}
              <circle
                cx={x}
                cy={y}
                r={1.8}
                fill={o.color}
                opacity={depth}
                style={{ filter: `drop-shadow(0 0 4px ${o.color})` }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
