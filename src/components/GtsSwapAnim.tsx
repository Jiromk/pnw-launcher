import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FaArrowRightArrowLeft, FaStar, FaCheck, FaBoxOpen } from "react-icons/fa6";

interface GtsSwapAnimProps {
  mySpriteUrl: string | null;
  myName: string;
  myShiny?: boolean;
  myAltShiny?: boolean;
  theirSpriteUrl: string | null;
  theirName: string;
  theirShiny?: boolean;
  theirAltShiny?: boolean;
  boxName?: string | null;
  onComplete: () => void;
}

/**
 * Full-screen animated overlay for GTS trade swap.
 *
 * Two sprites slide toward the center, cross with a flash, then settle on opposite sides.
 * After ~3.5s, shows a polished result modal.
 */
export default function GtsSwapAnim({
  mySpriteUrl,
  myName,
  myShiny = false,
  myAltShiny = false,
  theirSpriteUrl,
  theirName,
  theirShiny = false,
  theirAltShiny = false,
  boxName,
  onComplete,
}: GtsSwapAnimProps) {
  const [phase, setPhase] = useState<"anim" | "result">("anim");

  useEffect(() => {
    const t = setTimeout(() => setPhase("result"), 3500);
    return () => clearTimeout(t);
  }, []);

  const hasShiny = myShiny || theirShiny;
  const hasAltShiny = myAltShiny || theirAltShiny;

  const overlay = (
    <div className={`gts-swap-overlay${hasAltShiny ? " gts-swap-alt-shiny" : hasShiny ? " gts-swap-shiny" : ""}`}>
      {phase === "anim" ? (
        <div className="gts-swap-scene">
          <div className="gts-swap-sprite gts-swap-sprite--left">
            {mySpriteUrl ? <img src={mySpriteUrl} alt={myName} /> : <span style={{ fontSize: "3rem" }}>?</span>}
          </div>
          <div className="gts-swap-sprite gts-swap-sprite--right">
            {theirSpriteUrl ? <img src={theirSpriteUrl} alt={theirName} /> : <span style={{ fontSize: "3rem" }}>?</span>}
          </div>
          <div className="gts-swap-flash" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="gts-swap-particles" />
          ))}
        </div>
      ) : (
        <div className="gts-swap-success-modal">
          {/* Header with check icon */}
          <div className="gts-swap-success-icon">
            <FaCheck />
          </div>
          <h2 className="gts-swap-success-title">Échange réussi !</h2>

          {/* Two cards side by side */}
          <div className="gts-swap-success-cards">
            <div className={`gts-swap-success-card gts-swap-success-card--sent${myAltShiny ? " gts-swap-success-card--alt-shiny" : myShiny ? " gts-swap-success-card--shiny" : ""}`}>
              <div className="gts-swap-success-card-label gts-swap-success-card-label--sent">Envoyé</div>
              <div className="gts-swap-success-card-sprite">
                {mySpriteUrl ? <img src={mySpriteUrl} alt="" /> : <span className="gts-swap-success-placeholder">?</span>}
              </div>
              <div className="gts-swap-success-card-name">
                {myAltShiny && <FaStar style={{ color: "#c084fc", fontSize: ".7em", marginRight: 3 }} />}
                {myShiny && !myAltShiny && <FaStar style={{ color: "#facc15", fontSize: ".7em", marginRight: 3 }} />}
                {myName}
              </div>
            </div>

            <div className="gts-swap-success-arrow">
              <FaArrowRightArrowLeft />
            </div>

            <div className={`gts-swap-success-card gts-swap-success-card--received${theirAltShiny ? " gts-swap-success-card--alt-shiny" : theirShiny ? " gts-swap-success-card--shiny" : ""}`}>
              <div className="gts-swap-success-card-label gts-swap-success-card-label--received">Reçu</div>
              <div className="gts-swap-success-card-sprite">
                {theirSpriteUrl ? <img src={theirSpriteUrl} alt="" /> : <span className="gts-swap-success-placeholder">?</span>}
              </div>
              <div className="gts-swap-success-card-name">
                {theirAltShiny && <FaStar style={{ color: "#c084fc", fontSize: ".7em", marginRight: 3 }} />}
                {theirShiny && !theirAltShiny && <FaStar style={{ color: "#facc15", fontSize: ".7em", marginRight: 3 }} />}
                {theirName}
              </div>
            </div>
          </div>

          {/* Box info */}
          {boxName && (
            <div className="gts-swap-success-box">
              <FaBoxOpen style={{ opacity: .6 }} />
              <span>Placé dans <strong>{boxName}</strong></span>
            </div>
          )}

          <button className="gts-confirm-btn gts-confirm-btn--confirm" onClick={onComplete} style={{ margin: "0 auto" }}>
            <FaCheck /> Fermer
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
