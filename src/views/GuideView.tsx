import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FaArrowLeft, FaTriangleExclamation, FaBookOpen, FaXmark, FaSpinner, FaCrown } from "react-icons/fa6";

interface GuideStep {
  num: number;
  text: string;
  imageUrl?: string;
  highlight?: string[];
  characters?: { name: string; imageUrl?: string; description?: string }[];
}

interface GuideData {
  title: string;
  subtitle?: string;
  disclaimer?: string;
  steps: GuideStep[];
}

const PLACEHOLDER_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Découpe le texte en segments (texte normal / termes à mettre en évidence) */
function splitByHighlights(
  text: string,
  highlight: string[] = []
): { type: "text" | "highlight"; value: string }[] {
  if (!text || !Array.isArray(highlight) || highlight.length === 0) {
    return [{ type: "text", value: text }];
  }
  const escaped = highlight.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex).filter(Boolean);
  return parts.map((p) => ({
    type: highlight.some((h) => p.toLowerCase() === h.toLowerCase()) ? "highlight" : "text",
    value: p,
  }));
}

function CharacterBubble({
  character,
  onClick,
}: {
  character: { name: string; imageUrl?: string };
  onClick: () => void;
}) {
  const imgSrc = character.imageUrl?.trim() || PLACEHOLDER_IMG;
  return (
    <button
      type="button"
      className="guide-character-bubble"
      onClick={onClick}
      title={character.name}
      aria-label={`Voir la fiche de ${character.name}`}
    >
      <div className="guide-character-bubble-inner">
        <img
          src={imgSrc}
          alt=""
          className="guide-character-bubble-img"
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_IMG)}
        />
      </div>
    </button>
  );
}

function CharacterModal({
  character,
  onClose,
}: {
  character: { name: string; imageUrl?: string; description?: string };
  onClose: () => void;
}) {
  if (!character) return null;
  const imgSrc = character.imageUrl?.trim() || PLACEHOLDER_IMG;
  return createPortal(
    <div
      className="guide-character-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-character-modal-title"
    >
      <div className="guide-character-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="guide-character-modal-close"
          onClick={onClose}
          aria-label="Fermer"
        >
          <FaXmark size={18} />
        </button>
        <h3 id="guide-character-modal-title" className="guide-character-modal-title">
          {character.name}
        </h3>
        <div className="guide-character-modal-content">
          <div className="guide-character-modal-sprite">
            <img
              src={imgSrc}
              alt={character.name}
              onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_IMG)}
            />
          </div>
          <p className="guide-character-modal-desc">
            {character.description || "Aucune description."}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function StepCard({
  step,
  onCharacterClick,
}: {
  step: GuideStep;
  onCharacterClick: (c: { name: string; imageUrl?: string; description?: string }) => void;
}) {
  const parts = splitByHighlights(step.text, step.highlight);
  const imageSrc = step.imageUrl?.trim() || PLACEHOLDER_IMG;
  const characters = Array.isArray(step.characters) ? step.characters : [];

  return (
    <article className="guide-step" id={`guide-step-${step.num}`}>
      <div className="guide-step-header">
        <span className="guide-step-badge">Étape {step.num}</span>
        {characters.length > 0 && (
          <div className="guide-step-characters">
            {characters.map((c, i) => (
              <CharacterBubble
                key={`${c.name}-${i}`}
                character={c}
                onClick={() => onCharacterClick(c)}
              />
            ))}
          </div>
        )}
      </div>
        <div className="guide-step-body">
        <p className="guide-step-text">
          {Array.isArray(parts)
            ? parts.map((p, i) =>
                p.type === "highlight" ? (
                  <strong key={i} className="guide-step-highlight">
                    {p.value}
                  </strong>
                ) : (
                  <span key={i}>{p.value}</span>
                )
              )
            : step.text}
        </p>
        <div className="guide-step-image-wrap">
            <img
              src={imageSrc}
              alt={`Carte — Étape ${step.num}`}
              className="guide-step-image"
              loading="lazy"
              onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_IMG)}
            />
          </div>
      </div>
    </article>
  );
}

export default function GuideView({
  siteUrl,
  onBack,
  onNavigateBoss,
}: {
  siteUrl: string;
  onBack?: () => void;
  onNavigateBoss?: () => void;
}) {
  const [data, setData] = useState<GuideData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState<{
    name: string;
    imageUrl?: string;
    description?: string;
  } | null>(null);

  useEffect(() => {
    const base = siteUrl.replace(/\/$/, "");
    fetch(`${base}/api/guide?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d?.guide) {
          setData({
            title: d.guide.title || "Guide",
            subtitle: d.guide.subtitle,
            disclaimer: d.guide.disclaimer,
            steps: Array.isArray(d.guide.steps) ? d.guide.steps : [],
          });
        }
      })
      .catch((e) => { console.warn("[PNW] Guide:", e); })
      .finally(() => setLoading(false));
  }, [siteUrl]);

  if (loading) return <Loading />;

  const steps = data?.steps || [];
  const title = data?.title || "Guide";
  const subtitle = data?.subtitle;
  const disclaimer = data?.disclaimer;

  return (
    <main className="guide-page animate-in">
      <div className="guide-wrap">
        <header className="guide-hero">
          <div className="container guide-hero-content">
            <div className="guide-nav-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
              {onBack && (
                <button
                  type="button"
                  className="guide-back"
                  onClick={onBack}
                  aria-label="Retour"
                >
                  <FaArrowLeft size={14} aria-hidden />
                  Retour
                </button>
              )}
              {onNavigateBoss && (
                <button
                  type="button"
                  className="guide-boss-btn"
                  onClick={onNavigateBoss}
                >
                  <FaCrown size={14} aria-hidden />
                  Boss du jeu
                </button>
              )}
            </div>
            <div className="guide-title-block">
              <h1 className="guide-title">{title}</h1>
              {subtitle && <p className="guide-subtitle">{subtitle}</p>}
              {disclaimer && (
                <div className="guide-disclaimer">
                  <FaTriangleExclamation size={18} aria-hidden />
                  <span>{disclaimer}</span>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="guide-content container">
          <ol className="guide-steps">
            {steps.map((step, i) => (
              <li key={`${step.num}-${i}`} className="guide-step-item">
                <StepCard
                  step={step}
                  onCharacterClick={setSelectedCharacter}
                />
              </li>
            ))}
          </ol>
          {steps.length === 0 && (
            <p className="guide-empty">
              <FaBookOpen size={18} aria-hidden />
              Aucune étape pour le moment.
            </p>
          )}
        </section>
      </div>

      {selectedCharacter && (
        <CharacterModal
          character={selectedCharacter}
          onClose={() => setSelectedCharacter(null)}
        />
      )}
    </main>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-3 py-12 justify-center" style={{ color: "var(--muted)" }}>
      <FaSpinner className="animate-spin" size={20} aria-hidden />
      <span className="text-sm">Chargement du guide…</span>
    </div>
  );
}
