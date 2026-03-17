import { useState, useEffect, useMemo, useRef } from "react";
import {
  FaBookOpen,
  FaStar,
  FaMagnifyingGlass,
  FaGrip,
  FaTableList,
  FaFilter,
  FaListCheck,
  FaXmark,
  FaFingerprint,
  FaGem,
  FaMapLocationDot,
  FaChevronDown,
  FaPaw,
} from "react-icons/fa6";
import { getTypeStyle, getTypeLabel } from "../utils/typeStyles";

interface PokeEntry {
  num?: string;
  number?: string;
  name: string;
  types?: string[];
  imageUrl?: string;
  evolution?: string;
  rarity?: string;
  obtention?: string;
  location?: string;
}

function normalize(str: string) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function TypeDropdown({
  value,
  options,
  onChange,
  label,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const displayLabel = value ? getTypeLabel(value) : "— Aucun —";
  const displayStyle = value ? getTypeStyle(value) : { background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.2)", color: "var(--text)" };

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</span>
      <div className="pokedex-type-dropdown">
        <button
          type="button"
          className="pokedex-type-dropdown-trigger"
          style={displayStyle}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="pokedex-type-dropdown-value">{displayLabel}</span>
          <FaChevronDown className={`pokedex-type-dropdown-chevron ${open ? "open" : ""}`} />
        </button>
        {open && (
          <ul className="pokedex-type-dropdown-list">
            <li
              className="pokedex-type-dropdown-option pokedex-type-dropdown-option-none"
              onClick={() => { onChange(null); setOpen(false); }}
            >
              — Aucun —
            </li>
            {options.map((t) => (
              <li
                key={t}
                className="pokedex-type-dropdown-option"
                style={getTypeStyle(t)}
                onClick={() => { onChange(t); setOpen(false); }}
              >
                {getTypeLabel(t)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PokedexView({ siteUrl }: { siteUrl: string }) {
  const [entries, setEntries] = useState<PokeEntry[]>([]);
  const [extradexEntries, setExtradexEntries] = useState<PokeEntry[]>([]);
  const [activeDex, setActiveDex] = useState<"pokedex" | "extradex">("pokedex");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type1, setType1] = useState<string | null>(null);
  const [type2, setType2] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [selected, setSelected] = useState<PokeEntry | null>(null);

  const base = siteUrl.replace(/\/$/, "");

  useEffect(() => {
    Promise.all([
      fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json()),
      fetch(`${base}/api/extradex?t=${Date.now()}`).then((r) => r.json()),
    ])
      .then(([pokedexRes, extradexRes]) => {
        if (pokedexRes?.success && Array.isArray(pokedexRes.pokedex?.entries)) {
          setEntries(pokedexRes.pokedex.entries);
        }
        if (extradexRes?.success && Array.isArray(extradexRes.extradex?.entries)) {
          setExtradexEntries(extradexRes.extradex.entries);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  const currentEntries = activeDex === "pokedex" ? entries : extradexEntries;

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    currentEntries.forEach((e) => e.types?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [currentEntries]);

  const sortByNum = (a: PokeEntry, b: PokeEntry) =>
    (parseInt(String(a.num ?? a.number), 10) || 0) - (parseInt(String(b.num ?? b.number), 10) || 0);

  const filtered = useMemo(() => {
    const q = normalize(search);
    const types = [type1, type2].filter(Boolean).map((t) => t!.toLowerCase());
    const list = currentEntries.filter((e) => {
      const num = e.num || e.number || "";
      if (q && !normalize(e.name).includes(q) && !num.includes(q)) return false;
      if (types.length) {
        const et = (e.types || []).map((t) => t.toLowerCase());
        if (!types.every((t) => et.includes(t))) return false;
      }
      return true;
    });
    return [...list].sort(sortByNum);
  }, [currentEntries, search, type1, type2]);

  const fullImageUrl = (url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-5 animate-in">
      {/* Hero: Pokédex / Extradex (clic pour basculer) */}
      <div className="dex-hero-tabs">
        <button
          type="button"
          className={`dex-panel dex-panel--pokedex ${activeDex === "pokedex" ? "dex-panel--active" : "dex-panel--dimmed"}`}
          onClick={() => setActiveDex("pokedex")}
        >
          <div className="dex-panel-icon">
            <FaBookOpen size={28} />
          </div>
          <div>
            <h1 className="dex-panel-title">Pokédex</h1>
            <p className="dex-panel-subtitle">Pokémon New World — {entries.length} créatures</p>
          </div>
        </button>
        <button
          type="button"
          className={`dex-panel dex-panel--extradex ${activeDex === "extradex" ? "dex-panel--active" : "dex-panel--dimmed"}`}
          onClick={() => setActiveDex("extradex")}
        >
          <div className="dex-panel-icon">
            <FaStar size={28} />
          </div>
          <div>
            <h1 className="dex-panel-title">Extradex</h1>
            <p className="dex-panel-subtitle">Pokémon New World — {extradexEntries.length} créatures</p>
          </div>
        </button>
      </div>

      {/* Toolbar */}
      <section className="pokedex-toolbar">
        <div className="pokedex-toolbar-row">
          <div className="pokedex-search-wrap">
            <FaMagnifyingGlass className="pokedex-search-icon" />
            <input
              type="search"
              className="pokedex-search"
              placeholder="Rechercher un Pokémon ou un nº..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="pokedex-view-toggle" role="group">
            <button
              type="button"
              className={`pokedex-view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <FaGrip /> Grille
            </button>
            <button
              type="button"
              className={`pokedex-view-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              <FaTableList /> Tableau
            </button>
          </div>
        </div>
        <div className="pokedex-filter-panel">
          <span className="pokedex-filter-label">
            <FaFilter /> Filtrer par type (1 ou 2 types)
          </span>
          <div className="pokedex-filter-dropdown-wrap">
            <TypeDropdown label="Type 1" value={type1} options={allTypes} onChange={setType1} />
            <span className="pokedex-filter-plus">+</span>
            <TypeDropdown label="Type 2" value={type2} options={allTypes} onChange={setType2} />
          </div>
        </div>
      </section>

      <p className="pokedex-count">
        <FaListCheck /> {filtered.length} résultat{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Grid or Table */}
      <div style={{ maxHeight: "calc(100vh - 380px)", overflowY: "auto", paddingRight: 4 }}>
        {viewMode === "grid" && (
          <div className="pokedex-grid">
            {filtered.map((p, i) => (
              <button
                key={`${p.num}-${p.name}-${i}`}
                type="button"
                className="pokedex-card"
                onClick={() => setSelected(p)}
              >
                <div className="pokedex-card-sprite">
                  {fullImageUrl(p.imageUrl) ? (
                    <img src={fullImageUrl(p.imageUrl)} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <FaPaw size={32} style={{ color: "var(--muted)", opacity: 0.6 }} />
                  )}
                </div>
                <span className="pokedex-card-num">#{p.num ?? p.number ?? "?"}</span>
                <span className="pokedex-card-name">{p.name}</span>
                <div className="pokedex-card-types">
                  {p.types?.map((t) => (
                    <span key={t} className="pokedex-type-pill" style={getTypeStyle(t)}>{t}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
        {viewMode === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg)" }}>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 px-2">N°</th>
                  <th className="text-left py-2 px-2">Pokémon</th>
                  <th className="text-left py-2 px-2">Image</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Rareté</th>
                  <th className="text-left py-2 px-2">Obtention</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr
                    key={`table-${i}-${p.num}-${p.name}`}
                    className="border-b cursor-pointer hover:bg-white/5"
                    style={{ borderColor: "rgba(255,255,255,.06)" }}
                    onClick={() => setSelected(p)}
                  >
                    <td className="py-2 px-2">#{p.num ?? p.number ?? "?"}</td>
                    <td className="py-2 px-2 font-semibold">{p.name}</td>
                    <td className="py-2 px-2">
                      {fullImageUrl(p.imageUrl) ? (
                        <img src={fullImageUrl(p.imageUrl)} alt="" width={40} height={40} style={{ objectFit: "contain", imageRendering: "pixelated" }} loading="lazy" />
                      ) : (
                        <FaPaw size={20} style={{ color: "var(--muted)" }} />
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {p.types?.length ? p.types.map((t) => (
                        <span key={t} className="pokedex-type-pill mr-1" style={getTypeStyle(t)}>{t}</span>
                      )) : "—"}
                    </td>
                    <td className="py-2 px-2">{p.rarity ?? "—"}</td>
                    <td className="py-2 px-2">{p.obtention ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal détail */}
      {selected && (
        <div
          className="pokedex-modal-overlay"
          onClick={() => setSelected(null)}
          onKeyDown={(e) => e.key === "Escape" && setSelected(null)}
          role="button"
          tabIndex={0}
          aria-label="Fermer"
        >
          <div className="pokedex-modal card" onClick={(e) => e.stopPropagation()} role="dialog">
            <button type="button" className="pokedex-modal-close" onClick={() => setSelected(null)} aria-label="Fermer">
              <FaXmark size={18} />
            </button>
            <div className="pokedex-modal-content">
              <div className="pokedex-modal-sprite">
                {fullImageUrl(selected.imageUrl) ? (
                  <img src={fullImageUrl(selected.imageUrl)} alt="" />
                ) : (
                  <FaPaw size={64} style={{ color: "var(--muted)" }} />
                )}
              </div>
              <h2 className="pokedex-modal-name">{selected.name}</h2>
              <p className="pokedex-modal-num">
                <FaFingerprint /> #{selected.num ?? selected.number ?? "?"}
              </p>
              <div className="pokedex-modal-types">
                {selected.types?.length
                  ? selected.types.map((t) => (
                      <span key={t} className="pokedex-type-pill" style={getTypeStyle(t)}>{t}</span>
                    ))
                  : "—"}
              </div>
              {selected.rarity && (
                <div className="pokedex-modal-row">
                  <span className="pokedex-modal-label"><FaGem /> Rareté</span>
                  <span>{selected.rarity}</span>
                </div>
              )}
              {selected.evolution && (
                <div className="pokedex-modal-row">
                  <span className="pokedex-modal-label">Évolution</span>
                  <span>{selected.evolution}</span>
                </div>
              )}
              {(selected.obtention || selected.location) && (
                <div className="pokedex-modal-row">
                  <span className="pokedex-modal-label"><FaMapLocationDot /> Obtention</span>
                  <span>{selected.obtention || selected.location}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-3 py-12 justify-center" style={{ color: "var(--muted)" }}>
      <div className="w-5 h-5 border-2 border-white/20 border-t-[var(--primary-2)] rounded-full animate-spin" />
      <span className="text-sm">Chargement du Pokédex…</span>
    </div>
  );
}
