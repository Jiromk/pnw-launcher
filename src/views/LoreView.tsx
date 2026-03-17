import { useState, useEffect } from "react";
import { FaScroll, FaMusic, FaBolt, FaArrowRight, FaArrowLeft, FaClock } from "react-icons/fa6";

interface LoreStory {
  slug: string;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  backgroundImage?: string;
  musicYoutubeId?: string;
  isNew?: boolean;
  content?: string[] | string;
  contentEn?: string[] | string;
  intro?: string;
  introEn?: string;
  author?: string;
  authorEn?: string;
}

const DEFAULT_LORE_BG =
  "https://cdn.discordapp.com/attachments/418440039652130816/1482703693680873584/photo-1749062671992-ea1d9676487e.png?ex=69b7eaeb&is=69b6996b&hm=90deaeaf1108be720d0f0ef1c5e2a70c905c764e5b9d3c6821791720cb55ce77&";

const CHAPTER_BANNER_IMAGES = [
  "https://i.ibb.co/0VVYY8Kr/background-administrateur4.jpg",
  "https://i.ibb.co/5hTQRLsT/background-login-admin.jpg",
  "https://i.ibb.co/SDW19HLT/background-administrateur2.jpg",
];

/** Parse **gras** et *italique* comme sur le site */
function renderMarkdown(text: string): React.ReactNode {
  if (!text || typeof text !== "string") return text;
  let k = 0;
  function parseBold(str: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let rest = str;
    while (rest) {
      const a = rest.indexOf("**");
      if (a === -1) {
        out.push(...parseItalic(rest));
        break;
      }
      const b = rest.indexOf("**", a + 2);
      if (b === -1) {
        out.push(...parseItalic(rest));
        break;
      }
      if (a > 0) out.push(...parseItalic(rest.slice(0, a)));
      out.push(<strong key={`b${k++}`}>{parseItalic(rest.slice(a + 2, b))}</strong>);
      rest = rest.slice(b + 2);
    }
    return out;
  }
  function parseItalic(str: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let rest = str;
    while (rest) {
      const a = rest.indexOf("*");
      if (a === -1) {
        if (rest) out.push(rest);
        break;
      }
      const b = rest.indexOf("*", a + 1);
      if (b === -1) {
        out.push(rest);
        break;
      }
      if (a > 0) out.push(rest.slice(0, a));
      out.push(<em key={`i${k++}`}>{rest.slice(a + 1, b)}</em>);
      rest = rest.slice(b + 1);
    }
    return out;
  }
  const parts = parseBold(text);
  return parts.length ? parts : text;
}

function RenderContent({ paragraphs }: { paragraphs: string[] }) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return null;
  return (
    <>
      {paragraphs.map((p, i) => {
        if (typeof p === "string" && p.startsWith("![")) {
          const m = p.match(/!\[.*?\]\((.*?)\)/);
          const src = m ? m[1] : "";
          if (src) return <img key={i} src={src} alt="" className="lore-story-image" />;
          return null;
        }
        return (
          <p key={i} className="lore-story-p">
            {renderMarkdown(p)}
          </p>
        );
      })}
    </>
  );
}

function getBanner(story: LoreStory | null, index: number): string {
  if (story?.backgroundImage?.trim()) return story.backgroundImage.trim();
  return CHAPTER_BANNER_IMAGES[index >= 0 ? index % CHAPTER_BANNER_IMAGES.length : 0];
}

/** Normalise content (API peut renvoyer string ou array) */
function normalizeContent(raw: string[] | string | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw === "string" && raw.trim()) return raw.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export default function LoreView({ siteUrl }: { siteUrl: string }) {
  const [stories, setStories] = useState<LoreStory[]>([]);
  const [pageBg, setPageBg] = useState(DEFAULT_LORE_BG);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LoreStory | null>(null);
  const base = siteUrl.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${base}/api/lore?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) {
          if (Array.isArray(d.lore?.stories)) setStories(d.lore.stories);
          if (d.lore?.pageBackground?.trim()) setPageBg(d.lore.pageBackground.trim());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  if (loading) return <Loading label="Chargement du lore…" />;

  // ───── Vue lecture chapitre (structure identique à LoreStoryPage.jsx) ─────
  if (selected) {
    const storyIndex = stories.findIndex((s) => s.slug === selected.slug);
    const bannerImage = getBanner(selected, storyIndex);
    const title = selected.title ?? selected.titleEn ?? "Sans titre";
    const description = selected.description ?? selected.descriptionEn ?? "";
    const author = selected.author ?? selected.authorEn ?? "";
    const intro = selected.intro ?? selected.introEn ?? "";
    const paragraphs = normalizeContent(selected.content ?? selected.contentEn);
    const wordCount =
      (intro?.split(/\s+/).length || 0) +
      paragraphs.filter((p) => !p.startsWith("![")).join(" ").split(/\s+/).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));

    return (
      <main className="lore-story-page animate-in">
        <aside className="lore-story-sidebar" aria-hidden>
          <span className="lore-story-sidebar-title">{title}</span>
          <span className="lore-story-sidebar-dot" aria-hidden />
        </aside>

        <header className="lore-story-hero" style={{ backgroundImage: `url(${bannerImage})` }}>
          <div className="lore-story-hero-overlay" aria-hidden />
          <div className="lore-story-hero-inner">
            <h1 className="lore-story-hero-title">{title}</h1>
            {description && (
              <p className="lore-story-hero-description">{renderMarkdown(description)}</p>
            )}
          </div>
        </header>

        <div className="lore-story-content-wrap">
          <div className="lore-story-content">
            <div className="lore-story-toolbar">
              <button
                type="button"
                className="lore-story-back"
                onClick={() => setSelected(null)}
              >
                <FaArrowLeft size={14} /> Retour au Lore
              </button>
              <span className="lore-story-reading-time">
                <FaClock className="lore-story-reading-icon" size={14} /> {readingTime} min lecture
              </span>
            </div>

            <span className="lore-story-chapter-label">Chapitre</span>
            <h2 className="lore-story-content-title">{title}</h2>
            <div className="lore-story-meta">
              {intro && <p className="lore-story-intro">{renderMarkdown(intro)}</p>}
              {author && <p className="lore-story-author">Rapporté par {author}.</p>}
            </div>
            <div className="lore-story-body">
              <RenderContent paragraphs={paragraphs} />
              {paragraphs.length === 0 && (
                <p className="lore-story-p" style={{ color: "var(--muted)" }}>
                  Aucun contenu disponible pour ce chapitre.
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ───── Liste des chapitres (structure identique à LorePage.jsx) ─────
  return (
    <main
      className="lore-page animate-in"
      style={{
        backgroundImage: `url(${pageBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "100vh",
        paddingBottom: "4rem",
      }}
    >
      <div className="lore-page-bg-overlay" aria-hidden />
      <div className="lore-page-inner">
        <header className="lore-hero">
          <div className="lore-hero-card">
            <h1 className="lore-title">
              <FaScroll className="lore-title-icon" size={28} aria-hidden />
              <span>Le Lore</span>
            </h1>
            <p className="lore-subtitle">
              L'histoire et l'univers de Pokémon New World.
            </p>
          </div>
        </header>

        <section className="lore-banners">
          {stories.length === 0 && (
            <p style={{ color: "var(--muted)", textAlign: "center" }}>Aucune histoire pour le moment.</p>
          )}
          {stories.map((story, index) => {
            const title = story.title ?? story.titleEn ?? "Sans titre";
            const description = story.description ?? story.descriptionEn ?? "";
            const bannerImage = (story.backgroundImage?.trim())
              ? story.backgroundImage.trim()
              : CHAPTER_BANNER_IMAGES[index % CHAPTER_BANNER_IMAGES.length];

            return (
              <article key={story.slug} className="lore-banner-wrap">
                {index > 0 && <div className="lore-banner-sep" aria-hidden />}
                <button
                  type="button"
                  className="lore-banner"
                  onClick={() => setSelected(story)}
                >
                  <div
                    className="lore-banner-bg"
                    style={{ backgroundImage: `url(${bannerImage})` }}
                    aria-hidden
                  />
                  <div className="lore-banner-overlay" aria-hidden />
                  {story.musicYoutubeId && (
                    <span className="lore-banner-music" title="Fond sonore">
                      <FaMusic size={16} aria-hidden />
                    </span>
                  )}
                  {story.isNew && (
                    <span className="lore-banner-new" title="Nouveau chapitre">
                      <FaBolt size={16} aria-hidden />
                    </span>
                  )}
                  <div className="lore-banner-content">
                    <h2 className="lore-banner-title">{title}</h2>
                    {description ? <p className="lore-banner-desc">{description}</p> : <p className="lore-banner-desc" aria-hidden>&nbsp;</p>}
                    <span className="lore-banner-btn">
                      LIRE L'HISTOIRE
                      <FaArrowRight className="lore-banner-btn-arrow" size={12} aria-hidden />
                    </span>
                  </div>
                </button>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-12 justify-center" style={{ color: "var(--muted)" }}>
      <div className="w-5 h-5 border-2 border-white/20 border-t-[var(--primary-2)] rounded-full animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
