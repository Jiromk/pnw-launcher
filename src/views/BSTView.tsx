import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  FaChartLine,
  FaDatabase,
  FaArrowLeft,
  FaMagnifyingGlass,
  FaGrip,
  FaTableList,
  FaLayerGroup,
  FaLeaf,
  FaBolt,
  FaStar,
  FaPaw,
  FaXmark,
  FaHeartPulse,
  FaHandFist,
  FaShield,
  FaWandMagicSparkles,
  FaGem,
  FaGaugeHigh,
  FaCalculator,
  FaListCheck,
  FaImage,
  FaTag,
  FaShieldHalved,
  FaBookOpen,
  FaSpinner,
} from "react-icons/fa6";
import { buildPokedexLookup, findSprite } from "../utils/pokedexLookup";

const PLACEHOLDER_SPRITE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect fill="%23222" width="96" height="96" rx="12"/><text x="48" y="56" fill="%23555" font-size="24" text-anchor="middle" font-family="sans-serif">?</text></svg>'
  );

const FILTER_OPTIONS = [
  { id: "all", label: "Tout afficher", icon: FaLayerGroup },
  { id: "fakemon", label: "Fakemon + Formes Régionales", icon: FaLeaf },
  { id: "megas", label: "Nouvelles Mégas", icon: FaBolt },
  { id: "speciaux", label: "Pokémons Spéciaux", icon: FaStar },
];

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

const FALLBACK_TYPE_COLORS = ["#e91e63", "#9c27b0", "#673ab7", "#00bcd4", "#009688", "#8bc34a", "#ff9800", "#ff5722", "#795548", "#607d8b"];

function normalizeName(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getTypeKey(label: string): string {
  const v = (label || "").toLowerCase();
  const entry = Object.entries(TYPE_LABELS).find(([, val]) => val.toLowerCase() === v);
  return entry ? entry[0] : v.replace(/[^a-z]/g, "") || "normal";
}

function getColorForType(label: string): string {
  const key = getTypeKey(label);
  if (TYPE_COLORS[key]) return TYPE_COLORS[key];
  let h = 0;
  const s = (key || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return FALLBACK_TYPE_COLORS[Math.abs(h) % FALLBACK_TYPE_COLORS.length];
}

/** Extrait les types depuis row.type (ex. "Eau/Psy") ou row.types */
function getTypes(row: { type?: string; types?: string[] }): string[] {
  const str = (row.type || "").trim();
  if (str) {
    return str
      .split(/[/\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((part) => TYPE_LABELS[getTypeKey(part)] || part);
  }
  if (Array.isArray(row.types) && row.types.length) {
    return row.types.map((t) => TYPE_LABELS[getTypeKey(String(t))] || String(t));
  }
  return [];
}

type TalentSlot = { name: string; desc: string; hidden: boolean };

/** Talents : format admin `talents[]` ou ancien abilities/abilityDescs (comme BSTPage.jsx). */
function normalizeAbilities(row: {
  ability?: string;
  abilityDesc?: string;
  abilities?: string[];
  abilityDescs?: string[];
  talents?: Array<{ name?: string; desc?: string; hidden?: boolean }>;
}): { talents: TalentSlot[]; abilities: string[]; abilityDescs: string[] } {
  if (Array.isArray(row?.talents)) {
    const talents = row.talents.map((t) => ({
      name: (t.name || "").trim(),
      desc: (t.desc || "").trim(),
      hidden: !!t.hidden,
    }));
    return {
      talents,
      abilities: talents.map((t) => t.name),
      abilityDescs: talents.map((t) => t.desc),
    };
  }
  const abilities = Array.isArray(row?.abilities) ? [...row.abilities] : [];
  const abilityDescs = Array.isArray(row?.abilityDescs) ? [...row.abilityDescs] : [];
  if (abilities.length < 3 && row?.ability != null && String(row.ability).trim() !== "") {
    abilities[0] = row.ability ?? "";
    if (abilityDescs.length < 1) abilityDescs[0] = row?.abilityDesc ?? "";
  }
  while (abilities.length < 3) abilities.push("");
  while (abilityDescs.length < 3) abilityDescs.push("");
  const abilitiesTrim = abilities.slice(0, 3).map((a) => (a || "").trim());
  const descsTrim = abilityDescs.slice(0, 3).map((d) => (d || "").trim());
  const talents = abilitiesTrim.map((name, i) => ({
    name,
    desc: descsTrim[i] || "",
    hidden: i === 2,
  }));
  return {
    talents,
    abilities: abilitiesTrim,
    abilityDescs: descsTrim,
  };
}

/** Attaques signature : tableau d'objets ou chaîne multi-lignes « 1) Nom : desc » (comme le site). */
function normalizeAttacks(row: {
  attacks?: string | Array<{ name?: string; desc?: string }>;
}): { name: string; desc: string }[] {
  if (Array.isArray(row?.attacks)) {
    return row.attacks
      .map((a) => ({
        name: (a.name || "").trim(),
        desc: (a.desc || "").trim(),
      }))
      .filter((a) => a.name || a.desc);
  }
  const attacksStr = typeof row?.attacks === "string" ? row.attacks.trim() : "";
  if (!attacksStr) return [];
  const lines = attacksStr.split(/\n/).filter((l) => l.trim());
  const attacks: { name: string; desc: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:\d+\))\s*([^:]+)(?:\s*:\s*(.*))?$/);
    if (match) {
      attacks.push({ name: match[1].trim(), desc: (match[2] || "").trim() });
    } else {
      attacks.push({ name: line.trim(), desc: "" });
    }
  }
  return attacks.filter((a) => a.name || a.desc);
}

interface BSTRow {
  name: string;
  imageUrl?: string;
  type?: string;
  types?: string[];
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
  total?: number;
  ability?: string;
  abilityDesc?: string;
  abilities?: string[];
  abilityDescs?: string[];
  talents?: Array<{ name?: string; desc?: string; hidden?: boolean }>;
  attacks?: string | Array<{ name?: string; desc?: string }>;
}

function TypeBadges({ types }: { types: string[] }) {
  if (!types?.length) return <span className="bst-type-empty">—</span>;
  return (
    <span className="bst-type-badges">
      {types.map((t) => {
        const color = getColorForType(t);
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

function BSTModal({
  pokemon,
  spriteUrl,
  onClose,
}: {
  pokemon: BSTRow;
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

  if (!pokemon) return null;
  const types = getTypes(pokemon);
  const { talents } = normalizeAbilities(pokemon);
  const slots = talents.filter((t) => (t.name || "").trim() || (t.desc || "").trim());
  const signatureAttacks = normalizeAttacks(pokemon);

  return createPortal(
    <div
      ref={overlayRef}
      className="bst-modal-overlay"
      onClick={onClose}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bst-modal-title"
    >
      <div className="bst-modal" onClick={(e) => e.stopPropagation()}>
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
        <h2 id="bst-modal-title" className="bst-modal-name">
          {pokemon.name}
        </h2>
        <div className="bst-modal-types">
          <TypeBadges types={types} />
        </div>
        <div className="bst-modal-stats">
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaHeartPulse aria-hidden /> PV</span>
            <span>{pokemon.hp ?? "—"}</span>
          </div>
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaHandFist aria-hidden /> ATK</span>
            <span>{pokemon.atk ?? "—"}</span>
          </div>
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaShield aria-hidden /> DEF</span>
            <span>{pokemon.def ?? "—"}</span>
          </div>
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaWandMagicSparkles aria-hidden /> ATK SPE</span>
            <span>{pokemon.spa ?? "—"}</span>
          </div>
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaGem aria-hidden /> DEF SPE</span>
            <span>{pokemon.spd ?? "—"}</span>
          </div>
          <div className="bst-modal-stat">
            <span className="bst-modal-stat-label"><FaGaugeHigh aria-hidden /> SPE</span>
            <span>{pokemon.spe ?? "—"}</span>
          </div>
          <div className="bst-modal-stat bst-modal-stat-total">
            <span className="bst-modal-stat-label"><FaCalculator aria-hidden /> Total</span>
            <span>{pokemon.total ?? "—"}</span>
          </div>
        </div>
        {slots.length > 0 && (
          <div className="bst-modal-talents-wrap">
            <div className="bst-modal-talents-label"><FaStar aria-hidden /> Talents</div>
            <div className="bst-modal-talents-list">
              {(() => {
                let normalCount = 0;
                return slots.map((slot, i) => {
                  if (!slot.hidden) normalCount++;
                  const talentTitle = slot.hidden ? (
                    <>
                      <FaWandMagicSparkles aria-hidden /> Talent Caché
                    </>
                  ) : (
                    <>Talent {normalCount}</>
                  );
                  return (
                    <div key={i} className="bst-modal-talent-slot">
                      <div className="bst-modal-talent-title">{talentTitle}</div>
                      {slot.name && (
                        <div className="bst-modal-talent-name">
                          <FaWandMagicSparkles aria-hidden /> {slot.name}
                        </div>
                      )}
                      {slot.desc && <div className="bst-modal-talent-desc">{slot.desc}</div>}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
        {signatureAttacks.length > 0 && (
          <div className="bst-modal-attacks-wrap">
            <div className="bst-modal-talents-label">
              <FaBolt aria-hidden /> Attaque{signatureAttacks.length > 1 ? "s" : ""} signature
            </div>
            <div className="bst-modal-attacks-list">
              {signatureAttacks.map((attack, i) => (
                <div key={i} className="bst-modal-attack-item">
                  <div className="bst-modal-attack-header">
                    <span className="bst-modal-attack-num">{i + 1})</span>
                    <span className="bst-modal-attack-name">{attack.name}</span>
                  </div>
                  {attack.desc ? <p className="bst-modal-attack-desc">{attack.desc}</p> : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function BSTTableSection({
  id,
  title,
  icon: Icon,
  data,
  spriteUrlMap,
  viewMode,
  onSelect,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  data: BSTRow[];
  spriteUrlMap: (row: BSTRow) => string;
  viewMode: "grid" | "table";
  onSelect: (row: BSTRow) => void;
}) {
  const rows = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        sprite: spriteUrlMap(row),
        types: getTypes(row),
      })),
    [data, spriteUrlMap]
  );

  if (viewMode === "grid") {
    return (
      <section className="bst-section bst-section--grid" data-accent={id}>
        <div className="bst-section-header">
          <span className="bst-section-icon" aria-hidden><Icon /></span>
          <h2 className="bst-section-title">{title}</h2>
          <span className="bst-section-count"><FaPaw size={12} aria-hidden /> {rows.length} Pokémon</span>
        </div>
        <div className="bst-grid">
          {rows.map((row, i) => (
            <button
              key={`${row.name}-${i}`}
              type="button"
              className="bst-card"
              onClick={() => onSelect(row)}
            >
              <div className="bst-card-sprite-wrap">
                <img
                  src={row.sprite}
                  alt=""
                  className="bst-card-sprite"
                  loading="lazy"
                  onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_SPRITE)}
                />
              </div>
              <span className="bst-card-name">{row.name}</span>
              <div className="bst-card-types">
                <TypeBadges types={row.types} />
              </div>
              <span className="bst-card-total"><FaCalculator size={12} aria-hidden /> {row.total ?? "—"}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="bst-section" data-accent={id}>
      <div className="bst-section-header">
        <span className="bst-section-icon"><Icon /></span>
        <h2 className="bst-section-title">{title}</h2>
        <span className="bst-section-count">{rows.length} Pokémon</span>
      </div>
      <div className="bst-table-wrap">
        <table className="bst-table">
          <thead>
            <tr>
              <th className="bst-th-sprite"><FaImage aria-hidden /> Sprite</th>
              <th><FaTag aria-hidden /> Nom</th>
              <th><FaShieldHalved aria-hidden /> Type</th>
              <th className="bst-th-stat"><FaHeartPulse aria-hidden /> PV</th>
              <th className="bst-th-stat"><FaHandFist aria-hidden /> ATK</th>
              <th className="bst-th-stat"><FaShield aria-hidden /> DEF</th>
              <th className="bst-th-stat"><FaWandMagicSparkles aria-hidden /> ATK SPE</th>
              <th className="bst-th-stat"><FaGem aria-hidden /> DEF SPE</th>
              <th className="bst-th-stat"><FaGaugeHigh aria-hidden /> SPE</th>
              <th className="bst-th-total"><FaCalculator aria-hidden /> Total</th>
              <th><FaStar aria-hidden /> Talent</th>
              <th className="bst-th-desc"><FaBookOpen aria-hidden /> Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const filled = normalizeAbilities(row).abilities.filter(Boolean);
              const filledDescs = normalizeAbilities(row).abilityDescs.filter(Boolean);
              return (
                <tr
                  key={`${row.name}-${i}`}
                  className="bst-row bst-row-clickable"
                  onClick={() => onSelect(row)}
                >
                  <td className="bst-td-sprite">
                    <div className="bst-sprite-wrap">
                      <img
                        src={row.sprite}
                        alt=""
                        className="bst-sprite"
                        loading="lazy"
                        onError={(e) => ((e.target as HTMLImageElement).src = PLACEHOLDER_SPRITE)}
                      />
                    </div>
                  </td>
                  <td className="bst-td-name">{row.name}</td>
                  <td className="bst-td-type"><TypeBadges types={row.types} /></td>
                  <td className="bst-td-stat">{row.hp ?? "—"}</td>
                  <td className="bst-td-stat">{row.atk ?? "—"}</td>
                  <td className="bst-td-stat">{row.def ?? "—"}</td>
                  <td className="bst-td-stat">{row.spa ?? "—"}</td>
                  <td className="bst-td-stat">{row.spd ?? "—"}</td>
                  <td className="bst-td-stat">{row.spe ?? "—"}</td>
                  <td className="bst-td-total">
                    <span className="bst-total-value">{row.total ?? "—"}</span>
                  </td>
                  <td className="bst-td-ability">{filled.length ? filled.join(" · ") : "—"}</td>
                  <td className="bst-td-desc">
                    {filledDescs.length
                      ? filledDescs.map((d) => (d.length > 40 ? `${d.slice(0, 37)}…` : d)).join(" · ")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function BSTView({
  siteUrl,
  onBack,
}: {
  siteUrl: string;
  onBack?: () => void;
}) {
  const base = siteUrl.replace(/\/$/, "");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [selectedPokemon, setSelectedPokemon] = useState<BSTRow | null>(null);
  const [bstSource, setBstSource] = useState<{ fakemon: BSTRow[]; megas: BSTRow[]; speciaux: BSTRow[] }>({
    fakemon: [],
    megas: [],
    speciaux: [],
  });
  const [pokedexLookup, setPokedexLookup] = useState<ReturnType<typeof buildPokedexLookup>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${base}/api/bst?t=${Date.now()}`).then((r) => r.json()),
      fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json()),
    ])
      .then(([bstRes, pokedexRes]) => {
        if (bstRes?.success && bstRes?.bst) {
          setBstSource({
            fakemon: Array.isArray(bstRes.bst.fakemon) ? bstRes.bst.fakemon : [],
            megas: Array.isArray(bstRes.bst.megas) ? bstRes.bst.megas : [],
            speciaux: Array.isArray(bstRes.bst.speciaux) ? bstRes.bst.speciaux : [],
          });
        }
        if (pokedexRes?.success && Array.isArray(pokedexRes.pokedex?.entries)) {
          setPokedexLookup(buildPokedexLookup(pokedexRes.pokedex.entries));
        }
      })
      .catch((e) => { console.warn("[PNW] BST/Pokedex:", e); })
      .finally(() => setLoading(false));
  }, [base]);

  const fullImageUrl = (url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const getSpriteForRow = (row: BSTRow): string => {
    const direct = row.imageUrl?.trim();
    if (direct) return fullImageUrl(direct);
    const fromPokedex = findSprite(pokedexLookup, row.name);
    return fromPokedex ? fullImageUrl(fromPokedex) : PLACEHOLDER_SPRITE;
  };

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filterData = (arr: BSTRow[]) =>
      !q ? arr : arr.filter((r) => normalizeName(r.name || "").includes(q));
    const list = [
      {
        id: "fakemon",
        title: "Fakemon + Formes Régionales",
        icon: FaLeaf,
        data: filterData(bstSource.fakemon),
      },
      { id: "megas", title: "Nouvelles Mégas", icon: FaBolt, data: filterData(bstSource.megas) },
      { id: "speciaux", title: "Pokémons Spéciaux", icon: FaStar, data: filterData(bstSource.speciaux) },
    ];
    if (filter === "all") return list;
    return list.filter((s) => s.id === filter);
  }, [filter, search, bstSource]);

  const totalCount = useMemo(
    () => sections.reduce((acc, s) => acc + (s.data?.length || 0), 0),
    [sections]
  );

  if (loading) return <Loading />;

  return (
    <div className="bst-page animate-in">
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
              <FaChartLine className="bst-title-icon" aria-hidden />
              All BST + new Abilities
            </h1>
            <p className="bst-subtitle">
              <FaDatabase className="bst-subtitle-icon" aria-hidden />
              Statistiques de base et talents des Fakemon, Mégas et Pokémon spéciaux
            </p>
          </div>

          <section className="bst-toolbar container">
            <div className="bst-toolbar-row">
              <div className="bst-search-wrap">
                <FaMagnifyingGlass className="bst-search-icon" aria-hidden />
                <input
                  type="search"
                  className="bst-search"
                  placeholder="Rechercher un Pokémon..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Recherche"
                />
              </div>
              <div className="bst-view-toggle" role="group" aria-label="Mode d'affichage">
                <button
                  type="button"
                  className={`bst-view-btn ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  title="Vue grille"
                  aria-pressed={viewMode === "grid"}
                >
                  <FaGrip aria-hidden /> Grille
                </button>
                <button
                  type="button"
                  className={`bst-view-btn ${viewMode === "table" ? "active" : ""}`}
                  onClick={() => setViewMode("table")}
                  title="Vue tableau"
                  aria-pressed={viewMode === "table"}
                >
                  <FaTableList aria-hidden /> Tableau
                </button>
              </div>
            </div>
            <div className="bst-filter-panel">
              <span className="bst-filter-label">
                <FaMagnifyingGlass aria-hidden /> Filtrer par catégorie
              </span>
              <div className="bst-filter-pills">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`bst-filter-pill ${filter === opt.id ? "active" : ""}`}
                    onClick={() => setFilter(opt.id)}
                  >
                    <opt.icon size={14} aria-hidden />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="bst-content-wrap container">
            <p className="bst-count">
              <FaListCheck className="bst-count-icon" aria-hidden />
              {totalCount} résultat{totalCount !== 1 ? "s" : ""}
            </p>
            <div className="bst-content">
              {sections.map((s) => (
                <BSTTableSection
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  icon={s.icon}
                  data={s.data}
                  spriteUrlMap={getSpriteForRow}
                  viewMode={viewMode}
                  onSelect={setSelectedPokemon}
                />
              ))}
            </div>
          </div>
        </header>
      </main>

      {selectedPokemon && (
        <BSTModal
          pokemon={selectedPokemon}
          spriteUrl={getSpriteForRow(selectedPokemon)}
          onClose={() => setSelectedPokemon(null)}
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
              <FaChartLine className="bst-title-icon" aria-hidden />
              All BST + new Abilities
            </h1>
            <p className="bst-subtitle">
              <FaDatabase className="bst-subtitle-icon" aria-hidden />
              Statistiques de base et talents des Fakemon, Mégas et Pokémon spéciaux
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 py-12" style={{ color: "var(--muted)" }}>
            <FaSpinner className="animate-spin" size={20} aria-hidden />
            <span className="text-sm">Chargement des BST…</span>
          </div>
        </header>
      </div>
    </div>
  );
}
