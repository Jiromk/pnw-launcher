import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

type AnimMode = "deposit" | "withdraw";

interface GtsTransferAnimProps {
  mode: AnimMode;
  spriteUrl: string | null;
  pokemonName: string;
  isShiny?: boolean;
  isAltShiny?: boolean;
  /** For withdraw: the box name where the Pokémon was placed */
  boxName?: string | null;
  /** Called when the full animation sequence is done and user dismisses */
  onComplete: () => void;
}

/**
 * Full-screen animated overlay for GTS deposit / withdrawal.
 *
 * Deposit (~5.5s):
 *   sprite visible → aura grows → orbiting rings spin → pulse + glow intensifies
 *   → vibrate → ripple waves → squish → LAUNCH upward with beam → shake → flash → done
 *
 * Withdraw (~4s):
 *   particles fall → flash → sprite materializes bright → bounce → energy ring → done
 */
export default function GtsTransferAnim({
  mode,
  spriteUrl,
  pokemonName,
  isShiny = false,
  isAltShiny = false,
  boxName,
  onComplete,
}: GtsTransferAnimProps) {
  const [phase, setPhase] = useState<"anim" | "result">("anim");

  useEffect(() => {
    const dur = mode === "deposit" ? 5800 : 4200;
    const t = setTimeout(() => setPhase("result"), dur);
    return () => clearTimeout(t);
  }, [mode]);

  const gold = isShiny && !isAltShiny;
  const particleClass = gold ? " gts-anim-particle--gold" : "";

  const particles = Array.from({ length: 8 }, (_, i) => (
    <div
      key={i}
      className={`gts-anim-particle gts-anim-particle--${mode === "deposit" ? "up" : "down"}-${i + 1}${particleClass}`}
      style={{ "--dx": `${(i % 2 === 0 ? 1 : -1) * (14 + i * 10)}px` } as React.CSSProperties}
    />
  ));

  const shinySparkles = gold ? (
    <>
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className={`gts-anim-sparkle gts-anim-sparkle--${n}`}>✦</div>
      ))}
    </>
  ) : null;

  const overlay = (
    <div className="gts-anim-overlay" onClick={(e) => e.stopPropagation()}>
      {phase === "anim" && (
        <>
          <div className={`gts-anim-scene${mode === "deposit" ? " gts-anim-scene--deposit" : ""}`}>
            {/* Pulsating aura (deposit only) */}
            {mode === "deposit" && (
              <div className={`gts-anim-aura${gold ? " gts-anim-aura--gold" : ""}`} />
            )}

            {/* Halo ring */}
            <div className={`gts-anim-halo${gold ? " gts-anim-halo--gold" : ""}`} />

            {/* Spinning orbit rings (deposit only) */}
            {mode === "deposit" && (
              <div className="gts-anim-orbit">
                <div className={`gts-anim-orbit-ring${gold ? " gts-anim-orbit-ring--gold" : ""}`} />
                <div className={`gts-anim-orbit-ring${gold ? " gts-anim-orbit-ring--gold" : ""}`} />
              </div>
            )}

            {/* Ripple waves (deposit only) */}
            {mode === "deposit" && (
              <>
                <div className={`gts-anim-ripple gts-anim-ripple--1${gold ? " gts-anim-ripple--gold" : ""}`} />
                <div className={`gts-anim-ripple gts-anim-ripple--2${gold ? " gts-anim-ripple--gold" : ""}`} />
                <div className={`gts-anim-ripple gts-anim-ripple--3${gold ? " gts-anim-ripple--gold" : ""}`} />
              </>
            )}

            {/* Particles */}
            <div className="gts-anim-particles">{particles}</div>

            {/* Shiny sparkles */}
            {shinySparkles}

            {/* Flash */}
            <div className={`gts-anim-flash gts-anim-flash--${mode}`} />

            {/* Light beam shooting up (deposit only) */}
            {mode === "deposit" && (
              <div className={`gts-anim-beam${gold ? " gts-anim-beam--gold" : ""}`} />
            )}

            {/* Energy ring (withdraw only) */}
            {mode === "withdraw" && (
              <div className={`gts-anim-ring${gold ? " gts-anim-ring--gold" : ""}`} />
            )}

            {/* Sprite */}
            <div className={`gts-anim-sprite gts-anim-sprite--${mode}`}>
              {spriteUrl ? (
                <img src={spriteUrl} alt={pokemonName} />
              ) : (
                <div style={{ fontSize: "3rem", color: "rgba(255,255,255,.2)" }}>?</div>
              )}
            </div>
          </div>

          <div className="gts-anim-label">
            {mode === "deposit" ? "Envoi en cours..." : "Récupération..."}
          </div>
        </>
      )}

      {phase === "result" && (
        <div className="gts-anim-result">
          <div className="gts-anim-result-title">
            {mode === "deposit" ? "Pokémon déposé !" : "Pokémon récupéré !"}
          </div>
          <div className="gts-anim-result-sub">
            {mode === "deposit"
              ? `${pokemonName} a été envoyé sur le GTS.`
              : boxName
                ? `${pokemonName} a été placé dans ${boxName} !`
                : `${pokemonName} est de retour !`}
          </div>
          <button type="button" className="gts-anim-result-btn" onClick={onComplete}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
