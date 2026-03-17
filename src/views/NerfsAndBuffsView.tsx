import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FaScaleBalanced,
  FaFilter,
  FaLayerGroup,
  FaArrowDown,
  FaArrowUp,
  FaArrowsLeftRight,
  FaArrowLeft,
  FaChevronDown,
  FaClockRotateLeft,
  FaPaw,
  FaXmark,
  FaArrowRight,
  FaHeartPulse,
  FaHandFist,
  FaShield,
  FaWandMagicSparkles,
  FaGem,
  FaGaugeHigh,
  FaCalculator,
  FaStar,
  FaBookOpen,
  FaSpinner,
  FaListCheck,
} from "react-icons/fa6";
import { buildPokedexLookup, findSprite } from "../utils/pokedexLookup";

const PLACEHOLDER_SPRITE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect fill="%23222" width="96" height="96" rx="12"/><text x="48" y="56" fill="%23555" font-size="24" text-anchor="middle" font-family="sans-serif">?</text></svg>'
  );

const SECTIONS = [
  { id: "nerfs" as const, title: "Nerf", icon: FaArrowDown, accent: "nerf" },
  { id: "buffs" as const, title: "Buff", icon: FaArrowUp, accent: "buff" },
  { id: "ajustements" as const, title: "Ajustement", icon: FaArrowsLeftRight, accent: "ajustement" },
];

const FILTER_OPTIONS = [
  { id: "all", label: "Tout", icon: FaLayerGroup },
  { id: "nerfs", label: "Nerf", icon: FaArrowDown },
  { id: "buffs", label: "Buff", icon: FaArrowUp },
  { id: "ajustements", label: "Ajustement", icon: FaArrowsLeftRight },
];

const STAT_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  hp: { icon: <FaHeartPulse size={12} />, label: "PV" },
  atk: { icon: <FaHandFist size={12} />, label: "ATK" },
  def: { icon: <FaShield size={12} />, label: "DEF" },
  spa: { icon: <FaWandMagicSparkles size={12} />, label: "ATK SPE" },
  spd: { icon: <FaGem size={12} />, label: "DEF SPE" },
  spe: { icon: <FaGaugeHigh size={12} />, label: "SPE" },
};

interface NerfBuffEntry {
  name: string;
  imageUrl?: string;
  typeFrom?: string;
  typeTo?: string;
  stats?: Record<string, number[] | number>;
  talents?: { from: string; to: string }[];
  movepool?: string;
}

interface NerfsBuffsData {
  lastModified: string | null;
  nerfs: NerfBuffEntry[];
  buffs: NerfBuffEntry[];
  ajustements: NerfBuffEntry[];
}

function formatDateFR(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function parseTypeLabel(str: string | undefined): string[] {
  if (!str || typeof str !== "string") return [];
  return str
    .split(/[/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Couleurs types comme sur le site (NerfsAndBuffsPage.jsx) */
const TYPE_COLORS: Record<string, string> = {
  plante: "#7ec850", feu: "#f08030", eau: "#6890f0", glace: "#98d8d8",
  malice: "#705898", poison: "#a040a0", vol: "#a890f0", dragon: "#7038f8",
  sol: "#e0c068", combat: "#c03028", spectre: "#705898", psy: "#f85888",
  electrik: "#f8d030", electr: "#f8d030", fee: "#ee99ac", tenebres: "#705848",
  roche: "#b8a038", acier: "#b8b8d0", normal: "#a8a878", insecte: "#a8b820",
  aspic: "#a08060", neant: "#5a5a8a",
};

const TYPE_LABELS: Record<string, string> = {
  plante: "Plante", feu: "Feu", eau: "Eau", glace: "Glace", malice: "Malice",
  poison: "Poison", vol: "Vol", dragon: "Dragon", sol: "Sol", combat: "Combat",
  spectre: "Spectre", psy: "Psy", electrik: "Électrik", electr: "Électrik",
  fee: "Fée", tenebres: "Ténèbres", roche: "Roche", acier: "Acier",
  normal: "Normal", insecte: "Insecte", aspic: "Aspic", neant: "Néant",
};

function getTypeKey(label: string): string {
  const normalized = (label || "").toLowerCase().trim();
  const entry = Object.entries(TYPE_LABELS).find(
    ([, v]) => (v || "").toLowerCase() === normalized
  );
  if (entry) return entry[0];
  return normalized.replace(/[^a-z]/g, "") || "normal";
}

function totalFromStats(stats: Record<string, number[] | number> | undefined): number {
  if (!stats || typeof stats !== "object") return 0;
  return ["hp", "atk", "def", "spa", "spd", "spe"].reduce(
    (sum, key) =>
      sum +
      (Array.isArray(stats[key]) ? (stats[key][1] ?? stats[key][0]) : (stats[key] as number) ?? 0),
    0
  );
}

/** Bannières types identiques au site : gradient, bordure, glow */
function TypeBadges({ types }: { types: string[] }) {
  if (!types?.length) return <span className="bst-type-empty">—</span>;
  return (
    <span className="bst-type-badges">
      {types.map((t) => {
        const key = getTypeKey(t);
        const color = TYPE_COLORS[key] || TYPE_COLORS.normal;
        return (
          <span
            key={t}
            className="bst-type-badge"
            style={{
              background: `linear-gradient(135deg, ${color}44, ${color}22)`,
              borderColor: color,
              color: color,
              boxShadow: `0 0 12px ${color}40`,
            }}
          >
            {t}
          </span>
        );
      })}
    </span>
  );
}

function NerfBuffModal({
  entry,
  spriteUrl,
  onClose,
}: {
  entry: NerfBuffEntry;
  spriteUrl: string;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", fn);
    overlayRef.current?.focus();
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  if (!entry) return null;

  const typesDisplay = parseTypeLabel(entry.typeTo);
  const typeChanged = (entry.typeFrom || "") !== (entry.typeTo || "");
  const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"];

  return createPortal(
    <div
      ref={overlayRef}
      className="bst-modal-overlay nerfbuff-modal-overlay"
      onClick={onClose}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nerfbuff-modal-title"
    >
      <div className="bst-modal nerfbuff-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="bst-modal-close" onClick={onClose} aria-label="Fermer">
          <FaXmark />
        </button>
        <div className="bst-modal-sprite-wrap">
          <img
            src={spriteUrl}
            alt=""
            className="bst-modal-sprite"
            onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_SPRITE)}
          />
        </div>
        <h2 id="nerfbuff-modal-title" className="bst-modal-name">
          {entry.name}
        </h2>

        <div className="bst-modal-types">
          {typeChanged ? (
            <div className="nerfbuff-modal-type-change">
              <TypeBadges types={parseTypeLabel(entry.typeFrom)} />
              <span className="nerfbuff-arrow" aria-hidden>
                <FaArrowRight size={12} />
              </span>
              <TypeBadges types={typesDisplay} />
            </div>
          ) : (
            <TypeBadges types={typesDisplay} />
          )}
        </div>

        <div className="bst-modal-stats nerfbuff-modal-stats">
          {statKeys.map((key) => {
            const arr = entry.stats?.[key];
            const fromVal = Array.isArray(arr) ? arr[0] : arr;
            const toVal = Array.isArray(arr) ? arr[1] : arr;
            const changed = fromVal !== toVal;
            const isNerf = changed && Number(toVal) < Number(fromVal);
            const isBuff = changed && Number(toVal) > Number(fromVal);
            const { icon, label } = STAT_LABELS[key] || {};
            return (
              <div
                key={key}
                className={`bst-modal-stat ${changed ? (isNerf ? "nerfbuff-stat-nerf" : "nerfbuff-stat-buff") : ""}`}
              >
                <span className="bst-modal-stat-label">
                  {icon} {label}
                </span>
                <span className="nerfbuff-stat-values">
                  {changed ? (
                    <>
                      <span className="nerfbuff-stat-from">{fromVal}</span>
                      <span className="nerfbuff-arrow-inline">
                        <FaArrowRight size={10} />
                      </span>
                      <span
                        className={`nerfbuff-stat-to ${isNerf ? "nerfbuff-stat-to--nerf" : ""} ${isBuff ? "nerfbuff-stat-to--buff" : ""}`}
                      >
                        {toVal}
                      </span>
                    </>
                  ) : (
                    <span>{toVal ?? fromVal}</span>
                  )}
                </span>
              </div>
            );
          })}
          <div className="bst-modal-stat bst-modal-stat-total">
            <span className="bst-modal-stat-label">
              <FaCalculator size={12} /> Total
            </span>
            <span>{totalFromStats(entry.stats)}</span>
          </div>
        </div>

        {entry.talents && entry.talents.length > 0 && (
          <div className="bst-modal-talents-wrap">
            <div className="bst-modal-talents-label">
              <FaStar size={12} /> Talents
            </div>
            <div className="bst-modal-talents-list">
              {entry.talents.map((t, i) => (
                <div key={i} className="bst-modal-talent-slot nerfbuff-talent-slot">
                  {t.from !== t.to ? (
                    <div className="bst-modal-talent-name">
                      <span className="nerfbuff-talent-from">{t.from}</span>
                      <span className="nerfbuff-arrow-inline">
                        <FaArrowRight size={10} />
                      </span>
                      <span className="nerfbuff-talent-to">{t.to}</span>
                    </div>
                  ) : (
                    <div className="bst-modal-talent-name">{t.to}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {entry.movepool && entry.movepool.trim() && (
          <div className="nerfbuff-movepool-wrap">
            <div className="bst-modal-talents-label">
              <FaBookOpen size={12} /> Movepool
            </div>
            <p className="nerfbuff-movepool-text">{entry.movepool}</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function NerfsAndBuffsView({
  siteUrl,
  onBack,
}: {
  siteUrl: string;
  onBack?: () => void;
}) {
  const [dataSource, setDataSource] = useState<NerfsBuffsData>({
    lastModified: null,
    nerfs: [],
    buffs: [],
    ajustements: [],
  });
  const [pokedexLookup, setPokedexLookup] = useState<ReturnType<typeof buildPokedexLookup>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selectedEntry, setSelectedEntry] = useState<NerfBuffEntry | null>(null);
  const [gotoOpen, setGotoOpen] = useState(false);
  const gotoRef = useRef<HTMLDivElement>(null);
  const base = siteUrl.replace(/\/$/, "");

  useEffect(() => {
    if (!gotoOpen) return;
    const close = (e: MouseEvent) => {
      if (gotoRef.current && !gotoRef.current.contains(e.target as Node)) setGotoOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [gotoOpen]);

  useEffect(() => {
    Promise.all([
      fetch(`${base}/api/nerfs-and-buffs?t=${Date.now()}`).then((r) => r.json()),
      fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json()),
    ])
      .then(([nbRes, pokedexRes]) => {
        if (nbRes?.success && nbRes?.nerfsBuffs) {
          const nb = nbRes.nerfsBuffs;
          setDataSource({
            lastModified: nb.lastModified ?? null,
            nerfs: Array.isArray(nb.nerfs) ? nb.nerfs : [],
            buffs: Array.isArray(nb.buffs) ? nb.buffs : [],
            ajustements: Array.isArray(nb.ajustements) ? nb.ajustements : [],
          });
        }
        if (pokedexRes?.success && Array.isArray(pokedexRes.pokedex?.entries)) {
          setPokedexLookup(buildPokedexLookup(pokedexRes.pokedex.entries));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  const fullImageUrl = (url: string | undefined): string => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const getSpriteForEntry = (entry: NerfBuffEntry): string => {
    const direct = entry.imageUrl?.trim();
    if (direct) return fullImageUrl(direct);
    const fromPokedex = findSprite(pokedexLookup, entry.name);
    return fromPokedex ? fullImageUrl(fromPokedex) : PLACEHOLDER_SPRITE;
  };

  const totalCount =
    (dataSource.nerfs?.length || 0) +
    (dataSource.buffs?.length || 0) +
    (dataSource.ajustements?.length || 0);
  const sectionsToShow =
    filter === "all" ? SECTIONS : SECTIONS.filter((s) => s.id === filter);

  const scrollToSection = (sectionId: string) => {
    setFilter(sectionId);
    const el = document.getElementById(`section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) return <Loading />;

  const handleGoto = (id: string) => {
    if (id === "all") setFilter("all");
    else scrollToSection(id);
    setGotoOpen(false);
  };

  return (
    <div className="bst-page nerfbuff-page animate-in">
      <main className="bst-main">
        <header className="bst-header">
          {onBack && (
            <button type="button" className="bst-back" onClick={onBack} aria-label="Retour">
              <FaArrowLeft size={14} aria-hidden />
              Retour
            </button>
          )}
          <div className="bst-title-block">
            <h1 className="bst-title">
              <FaScaleBalanced className="bst-title-icon" aria-hidden />
              Nerfs and Buffs
            </h1>
            <p className="bst-subtitle">
              <FaArrowsLeftRight className="bst-subtitle-icon" aria-hidden />
              Modifications des statistiques, types et talents
            </p>
            {dataSource.lastModified && (
              <p className="nerfbuff-last-update">
                <FaClockRotateLeft size={14} aria-hidden />
                Dernière mise à jour : {formatDateFR(dataSource.lastModified)}
              </p>
            )}
          </div>

          <section className="nerfbuff-toolbar container">
            <div className="nerfbuff-filter-pills" role="group" aria-label="Filtrer par catégorie">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`nerfbuff-filter-pill ${filter === opt.id ? "active" : ""}`}
                  onClick={() => (opt.id === "all" ? setFilter("all") : scrollToSection(opt.id))}
                  aria-pressed={filter === opt.id}
                >
                  <opt.icon size={14} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="nerfbuff-goto-wrap" ref={gotoRef}>
              <button
                type="button"
                className="nerfbuff-goto-btn"
                onClick={() => setGotoOpen((o) => !o)}
                aria-expanded={gotoOpen}
                aria-haspopup="true"
                aria-label="Aller à une section"
              >
                <FaChevronDown size={12} aria-hidden />
                Aller à
              </button>
              {gotoOpen && (
                <div className="nerfbuff-goto-dropdown" role="menu">
                  {FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitem"
                      className={filter === opt.id ? "active" : ""}
                      onClick={() => handleGoto(opt.id)}
                    >
                      <opt.icon size={14} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="bst-content-wrap container">
            <p className="bst-count">
              <FaListCheck className="bst-count-icon" />
              {totalCount} Pokémon concerné{totalCount !== 1 ? "s" : ""}
            </p>
            <div
              className={`nerfbuff-sections-wrap ${sectionsToShow.length === 1 ? "nerfbuff-sections-wrap--single" : ""}`}
            >
              {sectionsToShow.map((s) => {
                const entries = dataSource[s.id] || [];
                return (
                  <section
                    key={s.id}
                    id={`section-${s.id}`}
                    className="bst-section bst-section--grid nerfbuff-section"
                    data-accent={s.id}
                  >
                    <div className="bst-section-header">
                      <span className="bst-section-icon" aria-hidden>
                        <s.icon size={20} />
                      </span>
                      <h2 className="bst-section-title">{s.title}</h2>
                      <span className="bst-section-count">
                        <FaPaw size={12} /> {entries.length} Pokémon
                      </span>
                    </div>
                    <div className="bst-grid">
                      {entries.map((entry, i) => {
                        const spriteUrl = getSpriteForEntry(entry);
                        const types = parseTypeLabel(entry.typeTo);
                        const total = totalFromStats(entry.stats);
                        return (
                          <button
                            key={`${entry.name}-${i}`}
                            type="button"
                            className="bst-card"
                            onClick={() => setSelectedEntry(entry)}
                          >
                            <div className="bst-card-sprite-wrap">
                              <img
                                src={spriteUrl}
                                alt=""
                                className="bst-card-sprite"
                                loading="lazy"
                                onError={(e) =>
                                  ((e.target as HTMLImageElement).src = PLACEHOLDER_SPRITE)
                                }
                              />
                            </div>
                            <span className="bst-card-name">{entry.name}</span>
                            <div className="bst-card-types">
                              <TypeBadges types={types} />
                            </div>
                            <span className="bst-card-total">
                              <FaListCheck size={12} /> {total}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </header>
      </main>

      {selectedEntry && (
        <NerfBuffModal
          entry={selectedEntry}
          spriteUrl={getSpriteForEntry(selectedEntry)}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="bst-page animate-in">
      <div className="bst-main">
        <header className="bst-header">
          <div className="bst-title-block">
            <h1 className="bst-title">
              <FaScaleBalanced className="bst-title-icon" aria-hidden />
              Nerfs and Buffs
            </h1>
            <p className="bst-subtitle">
              <FaArrowsLeftRight className="bst-subtitle-icon" aria-hidden />
              Modifications des statistiques, types et talents
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 py-12" style={{ color: "var(--muted)" }}>
            <FaSpinner className="animate-spin" size={20} aria-hidden />
            <span className="text-sm">Chargement…</span>
          </div>
        </header>
      </div>
    </div>
  );
}
