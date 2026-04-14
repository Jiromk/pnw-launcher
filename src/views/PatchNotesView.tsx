import { useState, useEffect, type ReactNode } from "react";
import {
  FaScroll,
  FaSpinner,
  FaFileLines,
  FaWandMagicSparkles,
  FaWrench,
  FaScaleBalanced,
  FaPalette,
  FaMusic,
  FaStar,
  FaList,
  FaArrowDown,
  FaArrowUp,
  FaArrowsLeftRight,
} from "react-icons/fa6";
import PatchMarkdownText from "../components/PatchMarkdownText";

/* ───── Types ───── */
interface PatchItem {
  text?: string;
  kind?: string;
}

interface PatchSection {
  title: string;
  icon?: string;
  items: (string | PatchItem)[];
  image?: string;
}

interface PatchVersion {
  version: string;
  date?: string;
  image?: string;
  sections: PatchSection[];
}

interface PatchnotesData {
  versions: PatchVersion[];
  background?: string;
}

/* ───── FA class → react-icons mapping ───── */
const FA_ICON_MAP: Record<string, ReactNode> = {
  "fa-wand-magic-sparkles": <FaWandMagicSparkles />,
  "fa-wrench": <FaWrench />,
  "fa-scale-balanced": <FaScaleBalanced />,
  "fa-palette": <FaPalette />,
  "fa-music": <FaMusic />,
  "fa-star": <FaStar />,
  "fa-scroll": <FaScroll />,
  "fa-file-lines": <FaFileLines />,
  "fa-list": <FaList />,
};

/** Emoji en début de titre → icône FA */
const EMOJI_TO_FA: Record<string, string> = {
  "\u{1F195}": "fa-wand-magic-sparkles", // 🆕
  "\u{1F527}": "fa-wrench",              // 🔧
  "\u2696\uFE0F": "fa-scale-balanced",   // ⚖️
  "\u{1F3A8}": "fa-palette",             // 🎨
  "\u{1F3B5}": "fa-music",               // 🎵
  "\u{1F31F}": "fa-star",                // 🌟
};

const EMOJI_LEAD = /^(\p{Extended_Pictographic}|\uFE0F|\u200D)+(\s+)*/u;

function stripLeadingEmoji(title: string): string {
  let t = title.trimStart();
  for (let i = 0; i < 12; i++) {
    const next = t.replace(EMOJI_LEAD, "").trimStart();
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

function getSectionIcon(section: PatchSection): ReactNode {
  // 1. Explicit icon field (FA class string)
  if (section.icon && typeof section.icon === "string") {
    const key = section.icon.replace(/^fa-solid\s+/, "").trim();
    if (FA_ICON_MAP[key]) return FA_ICON_MAP[key];
  }
  // 2. Infer from emoji in title
  const first = [...(section.title?.trimStart() ?? "")][0];
  if (first && EMOJI_TO_FA[first]) {
    return FA_ICON_MAP[EMOJI_TO_FA[first]] ?? <FaList />;
  }
  return <FaList />;
}

function getSectionTitle(section: PatchSection): string {
  return stripLeadingEmoji(section.title ?? "") || section.title?.trim() || "";
}

function getItemText(item: string | PatchItem): string {
  return typeof item === "string" ? item : item.text ?? "";
}

function getItemKind(item: string | PatchItem): string | undefined {
  return typeof item === "object" ? item.kind : undefined;
}

const BALANCE_CONFIG: Record<string, { label: string; icon: ReactNode; cls: string }> = {
  nerf: { label: "Nerf", icon: <FaArrowDown />, cls: "patchnotes-balance-li--nerf" },
  buff: { label: "Buff", icon: <FaArrowUp />, cls: "patchnotes-balance-li--buff" },
  ajustement: { label: "Ajustement", icon: <FaArrowsLeftRight />, cls: "patchnotes-balance-li--ajustement" },
};

function resolveAssetUrl(base: string, value?: string) {
  if (!value) return "";
  try { return new URL(value, `${base}/`).toString(); }
  catch { return value; }
}

/* ───── Component ───── */
export default function PatchNotesView({ siteUrl }: { siteUrl: string }) {
  const [data, setData] = useState<PatchnotesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const base = siteUrl.replace(/\/$/, "");

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/api/patchnotes/fr?t=${Date.now()}`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res?.success && res?.patchnotes) setData(res.patchnotes);
      })
      .catch((e) => console.warn("[PNW] PatchNotes:", e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base]);

  const versions = data?.versions ?? [];
  const selectedVersion = versions[selectedIndex] ?? versions[0];
  const selectedVersionImage = resolveAssetUrl(base, selectedVersion?.image);

  useEffect(() => {
    if (versions.length > 0 && selectedIndex >= versions.length) setSelectedIndex(0);
  }, [versions.length, selectedIndex]);

  return (
    <main className="patchnotes-page animate-in">
      <div className="patchnotes-container patchnotes-container--with-sidebar">
        <aside className="patchnotes-sidebar">
          <div className="patchnotes-sidebar-header">
            <h2 className="patchnotes-sidebar-title">Versions</h2>
          </div>
          <nav className="patchnotes-sidebar-nav" aria-label="Anciennes notes de patch">
            {versions.map((v, idx) => (
              <button
                key={v.version || idx}
                type="button"
                className={`patchnotes-sidebar-item ${idx === selectedIndex ? "patchnotes-sidebar-item--selected" : ""}`}
                onClick={() => setSelectedIndex(idx)}
              >
                <span className="patchnotes-sidebar-item-version">Version {v.version}</span>
                {v.date && <span className="patchnotes-sidebar-item-date">{v.date}</span>}
              </button>
            ))}
          </nav>
        </aside>

        <div className="patchnotes-main">
          <header className="patchnotes-header">
            <h1 className="patchnotes-title">
              <span className="patchnotes-title-icon" aria-hidden="true">
                <FaScroll />
              </span>
              <span>Notes de patch</span>
            </h1>
            <p className="patchnotes-desc">Historique des mises à jour du jeu.</p>
          </header>

          {loading ? (
            <div className="patchnotes-loading">
              <FaSpinner className="animate-spin" size={20} aria-hidden />
              <span>Chargement...</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="patchnotes-empty card">
              <FaFileLines size={32} aria-hidden style={{ opacity: 0.6, display: "block", marginBottom: "1rem" }} />
              <p>Aucune note de patch pour le moment.</p>
            </div>
          ) : selectedVersion ? (
            <section className="patchnotes-version card patchnotes-version--single">
              <div className="patchnotes-version-header">
                <h2 className="patchnotes-version-heading">Version {selectedVersion.version}</h2>
                {selectedVersion.date && (
                  <span className="patchnotes-version-date-badge">{selectedVersion.date}</span>
                )}
              </div>

              {selectedVersionImage && (
                <div className="patchnotes-version-image-wrap">
                  <img
                    src={selectedVersionImage}
                    alt={`Patch ${selectedVersion.version}`}
                    className="patchnotes-version-image"
                  />
                </div>
              )}

              <div className="patchnotes-version-sections">
                {(selectedVersion.sections || []).map((section, i) => (
                  <div key={i} className="patchnotes-section">
                    <h3 className="patchnotes-section-title">
                      <span className="patchnotes-section-title-inner">
                        <span className="patchnotes-section-icon">{getSectionIcon(section)}</span>
                        <span>{getSectionTitle(section)}</span>
                      </span>
                    </h3>

                    {resolveAssetUrl(base, section.image) && (
                      <div className="patchnotes-section-image-wrap">
                        <img
                          src={resolveAssetUrl(base, section.image)}
                          alt=""
                          className="patchnotes-section-image"
                        />
                      </div>
                    )}

                    <ul>
                      {(section.items || []).map((item, j) => {
                        const text = getItemText(item);
                        const kind = getItemKind(item);
                        const balance = kind ? BALANCE_CONFIG[kind] : undefined;
                        return (
                          <li key={j} className={balance ? `patchnotes-balance-li ${balance.cls}` : undefined}>
                            {balance && (
                              <span className={`patchnotes-balance-tag patchnotes-balance-tag--${kind}`}>
                                {balance.icon}
                                <span>{balance.label}</span>
                              </span>
                            )}
                            <PatchMarkdownText text={text} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
