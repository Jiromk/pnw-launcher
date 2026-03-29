import { useState, useEffect } from "react";
import { FaFileLines, FaSpinner } from "react-icons/fa6";

interface PatchSection {
  title: string;
  items: string[];
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

function resolveAssetUrl(base: string, value?: string) {
  if (!value) return "";
  try {
    return new URL(value, `${base}/`).toString();
  } catch {
    return value;
  }
}

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
      .catch((e) => {
        console.warn("[PNW] PatchNotes:", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
              <FaFileLines size={22} aria-hidden style={{ color: "var(--primary-2)", opacity: 0.95 }} />
              Notes de patch
            </h1>
            <p className="patchnotes-desc">Historique des mises à jour du jeu.</p>
          </header>

          {loading ? (
            <div className="patchnotes-loading">
              <FaSpinner className="animate-spin" size={20} aria-hidden />
              <span>Chargement…</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="patchnotes-empty card">
              <FaFileLines size={32} aria-hidden style={{ opacity: 0.6, display: "block", marginBottom: "1rem" }} />
              <p>Aucune note de patch pour le moment.</p>
            </div>
          ) : selectedVersion ? (
            <section className="patchnotes-version card patchnotes-version--single">
              <div className="patchnotes-version-header">
                <h2>Version {selectedVersion.version}</h2>
                {selectedVersion.date && (
                  <span className="patchnotes-version-date">{selectedVersion.date}</span>
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
                    <h3>{section.title}</h3>
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
                      {(section.items || []).map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
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
