import { useState, useEffect } from "react";
import { FaArrowLeft, FaHeart, FaCrown, FaSpinner } from "react-icons/fa6";

const DEFAULT_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle fill="%23313538" cx="50" cy="50" r="50"/><circle fill="%237ecdf2" cx="50" cy="38" r="18"/><path fill="%237ecdf2" d="M20 95c0-25 13-40 30-40s30 15 30 40z"/></svg>'
  );

const DEFAULT_ROLE_COLOR = "#7ecdf2";

const TEXTS = {
  subtitle: "Qui fait vivre l'aventure",
  title: "L'équipe Pokemon New World",
  loading: "Chargement…",
  teamHeading: "Membres de l'équipe",
  thanksTitle: "Remerciements",
  thanksIntro:
    "Un grand merci à toutes les personnes qui rendent ce projet possible.",
};

interface TeamMember {
  id?: string;
  pseudo?: string;
  name?: string;
  role?: string;
  roleColor?: string;
  avatar?: string;
}

type ThanksItem = string | { pseudo?: string; name?: string; role?: string };

function getThanksLabel(item: ThanksItem): string {
  if (typeof item === "string") return item;
  return (item.pseudo || item.name || "—").trim() || "—";
}

export default function TeamView({
  siteUrl,
  onBack,
}: {
  siteUrl: string;
  onBack?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [thanks, setThanks] = useState<ThanksItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const base = siteUrl.replace(/\/$/, "");
    fetch(`${base}/api/config/team?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success) return;
        const config = data.config || {};
        setMembers(
          Array.isArray(config.members) ? config.members : []
        );
        setThanks(Array.isArray(config.thanks) ? config.thanks : []);
      })
      .catch((e) => { console.warn("[PNW] Team config:", e); })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteUrl]);

  return (
    <main className="team-page animate-in">
      <div className="team-container container">
        <header className="team-hero">
          {onBack && (
            <button
              type="button"
              className="bst-back"
              onClick={onBack}
              aria-label="Retour"
            >
              <FaArrowLeft size={14} aria-hidden />
              Retour
            </button>
          )}
          <p className="team-hero-subtitle">{TEXTS.subtitle}</p>
          <h1 className="team-hero-title">
            <span className="team-hero-title-inner">{TEXTS.title}</span>
          </h1>
          <div className="team-hero-line" aria-hidden />
        </header>

        <section
          className={`team-grid ${visible ? "team-grid--visible" : ""}`}
          aria-labelledby="team-heading"
        >
          <h2 id="team-heading" className="sr-only">
            {TEXTS.teamHeading}
          </h2>
          {loading ? (
            <p className="team-loading">
              <FaSpinner className="animate-spin" size={16} aria-hidden />{" "}
              {TEXTS.loading}
            </p>
          ) : (
            members.map((member, i) => {
              const isFounder =
                (member.role || "").trim().toLowerCase() === "fondateur";
              return (
                <article
                  key={member.id || (member.pseudo ?? "") + i}
                  className={`team-card ${isFounder ? "team-card--founder" : ""}`}
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <div className="team-card-glow" aria-hidden />
                  <div className="team-card-avatar-wrap">
                    <img
                      src={member.avatar || DEFAULT_AVATAR}
                      alt=""
                      className="team-card-avatar"
                      loading="lazy"
                    />
                  </div>
                  <h3 className="team-card-pseudo">
                    {member.pseudo || member.name || "—"}
                  </h3>
                  <span
                    className="team-card-role"
                    style={{
                      ["--team-role-color" as string]:
                        member.roleColor || DEFAULT_ROLE_COLOR,
                      color: member.roleColor || DEFAULT_ROLE_COLOR,
                      borderColor: member.roleColor || DEFAULT_ROLE_COLOR,
                      backgroundColor: member.roleColor
                        ? `${member.roleColor}22`
                        : "rgba(126,205,242,.15)",
                    }}
                  >
                    {member.role || "—"}
                  </span>
                  {isFounder && (
                    <span
                      className="team-card-founder-badge"
                      aria-hidden
                    >
                      <FaCrown size={14} />
                    </span>
                  )}
                </article>
              );
            })
          )}
        </section>

        {!loading && thanks.length > 0 && (
          <section
            className="team-thanks"
            aria-labelledby="thanks-heading"
          >
            <h2 id="thanks-heading" className="team-thanks-title">
              <FaHeart aria-hidden />
              {TEXTS.thanksTitle}
            </h2>
            <p className="team-thanks-intro">{TEXTS.thanksIntro}</p>
            <ul className="team-thanks-list">
              {thanks.map((item, i) => (
                <li key={i} className="team-thanks-item">
                  <span className="team-thanks-bullet" aria-hidden>
                    ✦
                  </span>
                  {getThanksLabel(item)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
