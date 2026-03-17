import { useState, useEffect } from "react";
import {
  FaArrowLeft,
  FaEnvelope,
  FaBug,
  FaLightbulb,
  FaUserPlus,
  FaCircleQuestion,
  FaEllipsis,
  FaCircleCheck,
  FaCircleExclamation,
  FaSpinner,
  FaPaperPlane,
} from "react-icons/fa6";

const CATEGORIES = [
  {
    id: "bug",
    label: "Bug / Problème technique",
    icon: FaBug,
    color: "#e74c3c",
  },
  {
    id: "suggestion",
    label: "Suggestion",
    icon: FaLightbulb,
    color: "#f1c40f",
  },
  {
    id: "recrutement",
    label: "Recrutement",
    icon: FaUserPlus,
    color: "#3498db",
  },
  {
    id: "question",
    label: "Question générale",
    icon: FaCircleQuestion,
    color: "#9b59b6",
  },
  {
    id: "autre",
    label: "Autre",
    icon: FaEllipsis,
    color: "#95a5a6",
  },
];

export default function ContactView({
  siteUrl,
  onBack,
}: {
  siteUrl: string;
  onBack?: () => void;
}) {
  const base = siteUrl.replace(/\/$/, "");
  const apiBase = `${base}/api`;

  const [category, setCategory] = useState("");
  const [contact, setContact] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [bgImage, setBgImage] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/config/contact-webhook?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.backgroundImage) setBgImage(d.backgroundImage);
      })
      .catch(() => {});
  }, [apiBase]);

  const canSubmit =
    !!category &&
    contact.trim().length > 0 &&
    subject.trim().length > 0 &&
    message.trim().length > 0 &&
    !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${apiBase}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          contact: contact.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setResult({
          type: "success",
          text: "Votre message a bien été envoyé. Merci !",
        });
        setCategory("");
        setContact("");
        setSubject("");
        setMessage("");
      } else {
        setResult({
          type: "error",
          text: data?.error || "Une erreur est survenue.",
        });
      }
    } catch {
      setResult({
        type: "error",
        text: "Impossible de joindre le serveur.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <main
      className="contact-page animate-in"
      style={
        bgImage
          ? {
              backgroundImage: `url(${bgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }
          : undefined
      }
    >
      <div className="contact-page-inner">
        {onBack && (
          <button
            type="button"
            className="bst-back contact-back"
            onClick={onBack}
            aria-label="Retour"
          >
            <FaArrowLeft size={14} aria-hidden />
            Retour
          </button>
        )}

        <header className="contact-hero">
          <div className="contact-hero-icon" aria-hidden>
            <FaEnvelope size={24} />
          </div>
          <h1 className="contact-hero-title">Contacter l&apos;équipe</h1>
          <p className="contact-hero-subtitle">
            Un bug, une suggestion, ou une simple question ? Nous sommes là pour
            vous aider.
          </p>
        </header>

        <form className="contact-form" onSubmit={handleSubmit}>
          <div className="contact-field">
            <span className="contact-label">
              Catégorie <span className="contact-required">*</span>
            </span>
            <div className="contact-categories">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`contact-cat-btn${category === cat.id ? " contact-cat-btn--active" : ""}`}
                  onClick={() => setCategory(cat.id)}
                  style={
                    category === cat.id
                      ? { borderColor: cat.color, background: `${cat.color}18` }
                      : undefined
                  }
                >
                  <cat.icon
                    size={14}
                    style={category === cat.id ? { color: cat.color } : undefined}
                  />
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="contact-field">
            <span className="contact-label">
              Votre email ou Discord <span className="contact-required">*</span>
            </span>
            <input
              type="text"
              className="contact-input"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="email@exemple.com ou Pseudo#1234"
              required
            />
          </label>

          <label className="contact-field">
            <span className="contact-label">
              Sujet <span className="contact-required">*</span>
            </span>
            <input
              type="text"
              className="contact-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Résumé bref de votre demande"
              required
            />
          </label>

          <label className="contact-field">
            <span className="contact-label">
              Message <span className="contact-required">*</span>
            </span>
            <textarea
              className="contact-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Décrivez votre demande en détail..."
              required
            />
          </label>

          {result && (
            <div
              className={`contact-result contact-result--${result.type}`}
              role="alert"
            >
              {result.type === "success" ? (
                <FaCircleCheck size={18} aria-hidden />
              ) : (
                <FaCircleExclamation size={18} aria-hidden />
              )}
              {result.text}
            </div>
          )}

          <button
            type="submit"
            className="contact-submit"
            disabled={!canSubmit}
          >
            {sending ? (
              <>
                <FaSpinner className="animate-spin" size={16} aria-hidden />
                Envoi...
              </>
            ) : (
              <>
                <FaPaperPlane size={16} aria-hidden />
                Envoyer le message
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
