import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
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
  FaSkull,
  FaRadiation,
  FaPersonRunning,
  FaEye,
  FaCircleCheck,
  FaCrosshairs,
  FaBurst,
} from "react-icons/fa6";
import { getTypeStyle, getTypeLabel } from "../utils/typeStyles";
import type { PlayerProfile } from "../types";

const SECRET_HASH = "53f7981a8813ea030341e0e6fb3c146a2977a230cc0ef43070f5579228bf898c";

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type EasterPhase = "idle" | "glitch" | "card";

function GighastonEasterEgg({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<EasterPhase>("glitch");
  const [glitchNumbers, setGlitchNumbers] = useState("0x00000000");
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    if (phase !== "glitch") return;
    const interval = setInterval(() => {
      const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, "0");
      setGlitchNumbers(`0x${hex}`);
    }, 50);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setPhase("card");
    }, 2000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [phase]);

  useEffect(() => {
    if (phase !== "card") return;
    if (countdown <= 0) { onClose(); return; }
    const interval = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(interval);
  }, [phase, countdown, onClose]);

  if (phase === "glitch") {
    return (
      <div className="gighaston-overlay gighaston-glitch">
        <div className="gighaston-glitch-content">
          <pre className="gighaston-console">
            <span className="gighaston-console-prompt">&gt;</span> console.log(<span className="gighaston-string">"Entrée Pokédex corrompue..."</span>);
          </pre>
          <div className="gighaston-hex">{glitchNumbers}</div>
          <div className="gighaston-scanlines" />
        </div>
      </div>
    );
  }

  return (
    <div className="gighaston-overlay gighaston-card-phase">
      <div className="gighaston-card">
        <div className="gighaston-card-glow" />
        <div className="gighaston-card-inner">
          <div className="gighaston-card-header">
            <span className="gighaston-card-number">
              <FaRadiation className="gighaston-icon-pulse" /> #???
            </span>
            <span className="gighaston-card-rarity">
              <FaSkull /> Corrompu ⚠️
            </span>
          </div>
          
          <div className="gighaston-sprite-container">
            <div className="gighaston-sprite-glitch" />
            <img 
              src="https://i.imgur.com/4ypJ2kX.gif" 
              alt="???" 
              className="gighaston-sprite"
            />
          </div>

          <h2 className="gighaston-name">
            <span className="gighaston-name-glitch">G̸̢͝i̶̛̱g̷̨̈́h̸̰̾a̵̰͝s̶̱͠t̷̨̛o̶̰̊n̸̰̈́</span>
          </h2>

          <div className="gighaston-info-box">
            <div className="gighaston-warning-icon">
              <FaRadiation size={20} />
            </div>
            <p className="gighaston-info-text">
              Une anomalie a été détectée dans cette entrée.<br />
              <span className="gighaston-info-warning">Le sujet semble réagir à la présence du lecteur.</span>
            </p>
          </div>

          <div className="gighaston-stats">
            <div className="gighaston-stat">
              <span className="gighaston-stat-label">Type</span>
              <span className="gighaston-stat-value gighaston-type-corrupted">???</span>
            </div>
            <div className="gighaston-stat">
              <span className="gighaston-stat-label">Statut</span>
              <span className="gighaston-stat-value gighaston-status-danger">INSTABLE</span>
            </div>
          </div>
        </div>
      </div>

      <div className="gighaston-eject-warning">
        <div className="gighaston-eject-text">
          <FaSkull className="gighaston-eject-icon" />
          <span>Vous n'avez strictement rien à faire ici.</span>
        </div>
        <div className="gighaston-countdown">
          Éjection dans <span className="gighaston-countdown-number">{countdown}</span> seconde{countdown !== 1 ? "s" : ""}
        </div>
        <div className="gighaston-progress-bar">
          <div 
            className="gighaston-progress-fill" 
            style={{ width: `${((15 - countdown) / 15) * 100}%` }} 
          />
        </div>
        <button type="button" className="gighaston-flee-btn" onClick={onClose}>
          <FaPersonRunning className="gighaston-flee-icon" />
          FUIR
        </button>
      </div>
    </div>
  );
}

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

/** Alias manuels : nom Data/2.dat → nom(s) utilisé(s) sur le site. */
const NAME_ALIASES: Record<string, string[]> = {
  "scovillain": ["scovilain"],
  "scorrompu": ["scorruption"],
  "medhyena": ["medhyena"],
  "grahyena": ["grahyena"],
  "chamallot": ["chamallot"],
  "camerupt": ["camerupt"],
  "grelacon": ["grelacon"],
  "seracrawl": ["seracrawl"],
  "kungfouine": ["kungfouine"],
  "farigiraf": ["farigiraf"],
  "galvaptor": ["galvaptor"],
  "gigagla": ["gigagla"],
  "ixon": ["ixon"],
  "dogrino": ["dogrino"],
};

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

export default function PokedexView({ siteUrl, profile }: { siteUrl: string; profile?: PlayerProfile | null }) {
  const [entries, setEntries] = useState<PokeEntry[]>([]);
  const [extradexEntries, setExtradexEntries] = useState<PokeEntry[]>([]);
  const [activeDex, setActiveDex] = useState<"pokedex" | "extradex">("pokedex");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type1, setType1] = useState<string | null>(null);
  const [type2, setType2] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [statusFilter, setStatusFilter] = useState<"all" | "seen" | "caught" | "unseen">("all");
  const [selected, setSelected] = useState<PokeEntry | null>(null);
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  const base = siteUrl.replace(/\/$/, "");

  // Table des noms d'espèces depuis les fichiers du jeu (index = ID interne PSDK)
  const [speciesNames, setSpeciesNames] = useState<string[]>([]);
  useEffect(() => {
    invoke<string>("cmd_psdk_french_species_names")
      .then((json) => { try { setSpeciesNames(JSON.parse(json)); } catch {} })
      .catch(() => {});
  }, []);

  // Données du Pokédex du joueur (depuis la sauvegarde)
  const capturedIds = profile?.pokedex?.capturedIds ?? [];
  const seenIds = profile?.pokedex?.seenIds ?? [];
  const foughtCounts = profile?.pokedex?.foughtCounts;
  const capturedCounts = profile?.pokedex?.capturedCounts;

  // Mapping : nom normalisé → { seen, caught, internalId }
  const nameStatusMap = useMemo(() => {
    const map = new Map<string, { seen: boolean; caught: boolean; internalId: number }>();
    if (speciesNames.length === 0) return map;
    const seenSet = new Set(seenIds);
    const capturedSet = new Set(capturedIds);
    for (let i = 0; i < speciesNames.length; i++) {
      const name = speciesNames[i];
      if (!name) continue;
      const id1 = i + 1;
      if (seenSet.has(id1) || capturedSet.has(id1)) {
        const norm = normalize(name);
        const status = {
          seen: seenSet.has(id1),
          caught: capturedSet.has(id1),
          internalId: id1,
        };
        map.set(norm, status);
        // Enregistrer aussi les alias (noms alternatifs utilisés sur le site)
        const aliases = NAME_ALIASES[norm];
        if (aliases) {
          for (const alias of aliases) map.set(alias, status);
        }
      }
    }
    return map;
  }, [speciesNames, seenIds, capturedIds]);

  const hasSaveData = nameStatusMap.size > 0;

  // Lookup pour une entrée du Pokédex
  const getStatus = useCallback((entry: PokeEntry) => {
    return nameStatusMap.get(normalize(entry.name)) ?? null;
  }, [nameStatusMap]);

  // Compteurs filtrés par les entrées existantes dans le Pokédex du site
  const { matchedCaught, matchedSeenOnly } = useMemo(() => {
    let caught = 0;
    let seenOnly = 0;
    entries.forEach((e) => {
      const s = nameStatusMap.get(normalize(e.name));
      if (s?.caught) caught++;
      else if (s?.seen) seenOnly++;
    });
    return { matchedCaught: caught, matchedSeenOnly: seenOnly };
  }, [entries, nameStatusMap]);

  // Debug: diagnostic matching (console uniquement)
  useEffect(() => {
    if (speciesNames.length === 0 || entries.length === 0) return;
    console.log(`[PNW Pokédex] Sauvegarde: ${seenIds.length} vus, ${capturedIds.length} capturés | Matchés sur le site: ${matchedCaught} capturés, ${matchedSeenOnly} vus seulement`);
  }, [speciesNames, entries, seenIds, capturedIds, matchedCaught, matchedSeenOnly]);

  const handleSearchChange = useCallback(async (value: string) => {
    setSearch(value);
    const inputHash = await hashString(value);
    if (inputHash === SECRET_HASH) {
      setShowEasterEgg(true);
      setSearch("");
    }
  }, []);

  const closeEasterEgg = useCallback(() => {
    setShowEasterEgg(false);
  }, []);

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
      .catch((e) => {
        console.warn("[PNW] Pokedex/Extradex:", e);
      })
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
      if (hasSaveData && statusFilter !== "all") {
        const s = nameStatusMap.get(normalize(e.name));
        const seen = s?.seen ?? false;
        const caught = s?.caught ?? false;
        if (statusFilter === "caught" && !caught) return false;
        if (statusFilter === "seen" && (!seen || caught)) return false;
        if (statusFilter === "unseen" && seen) return false;
      }
      return true;
    });
    return [...list].sort(sortByNum);
  }, [currentEntries, search, type1, type2, statusFilter, hasSaveData, nameStatusMap]);

  const fullImageUrl = (url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-5 animate-in">
      {showEasterEgg && createPortal(<GighastonEasterEgg onClose={closeEasterEgg} />, document.body)}
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
            {hasSaveData && activeDex === "pokedex" && (
              <div className="dex-panel-progress">
                <span className="dex-progress-item dex-progress-item--seen">
                  <FaEye size={11} /> {seenIds.length} vus
                </span>
                <span className="dex-progress-item dex-progress-item--caught">
                  <FaCircleCheck size={11} /> {capturedIds.length} capturés
                </span>
              </div>
            )}
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
              onChange={(e) => handleSearchChange(e.target.value)}
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
        {hasSaveData && (
          <div className="pokedex-status-filter">
            <span className="pokedex-filter-label">
              <FaEye /> Progression
            </span>
            <div className="pokedex-status-filter-btns" role="group">
              <button
                type="button"
                className={`pokedex-status-btn ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                Tous
              </button>
              <button
                type="button"
                className={`pokedex-status-btn pokedex-status-btn--caught ${statusFilter === "caught" ? "active" : ""}`}
                onClick={() => setStatusFilter("caught")}
              >
                <FaCircleCheck size={11} /> Capturés
              </button>
              <button
                type="button"
                className={`pokedex-status-btn pokedex-status-btn--seen ${statusFilter === "seen" ? "active" : ""}`}
                onClick={() => setStatusFilter("seen")}
              >
                <FaEye size={11} /> Vus
              </button>
              <button
                type="button"
                className={`pokedex-status-btn pokedex-status-btn--unseen ${statusFilter === "unseen" ? "active" : ""}`}
                onClick={() => setStatusFilter("unseen")}
              >
                <FaXmark size={11} /> Non vus
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="pokedex-count">
        <FaListCheck /> {filtered.length} résultat{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Grid or Table */}
      <div style={{ maxHeight: "calc(100vh - 380px)", overflowY: "auto", paddingRight: 4 }}>
        {viewMode === "grid" && (
          <div className="pokedex-grid">
            {filtered.map((p, i) => {
              const st = hasSaveData ? getStatus(p) : null;
              const isSeen = st?.seen ?? false;
              const isCaught = st?.caught ?? false;
              return (
                <button
                  key={`${p.num}-${p.name}-${i}`}
                  type="button"
                  className={`pokedex-card${isCaught ? " pokedex-card--caught" : isSeen ? " pokedex-card--seen" : ""}`}
                  onClick={() => setSelected(p)}
                >
                  {hasSaveData && (
                    <div className="pokedex-card-badges">
                      {isCaught ? (
                        <span className="pokedex-badge pokedex-badge--caught" title="Capturé">
                          <FaCircleCheck size={13} />
                        </span>
                      ) : isSeen ? (
                        <span className="pokedex-badge pokedex-badge--seen" title="Vu">
                          <FaEye size={13} />
                        </span>
                      ) : null}
                    </div>
                  )}
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
              );
            })}
          </div>
        )}
        {viewMode === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg)" }}>
                <tr style={{ color: "var(--muted)" }}>
                  {hasSaveData && <th className="text-center py-2 px-2" style={{ width: 40 }}>Statut</th>}
                  <th className="text-left py-2 px-2">N°</th>
                  <th className="text-left py-2 px-2">Pokémon</th>
                  <th className="text-left py-2 px-2">Image</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Rareté</th>
                  <th className="text-left py-2 px-2">Obtention</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const st = hasSaveData ? getStatus(p) : null;
                  const isSeen = st?.seen ?? false;
                  const isCaught = st?.caught ?? false;
                  return (
                  <tr
                    key={`table-${i}-${p.num}-${p.name}`}
                    className="border-b cursor-pointer hover:bg-white/5"
                    style={{ borderColor: "rgba(255,255,255,.06)" }}
                    onClick={() => setSelected(p)}
                  >
                    {hasSaveData && (
                      <td className="py-2 px-2 text-center">
                        {isCaught ? (
                          <FaCircleCheck size={14} style={{ color: "#4ade80" }} />
                        ) : isSeen ? (
                          <FaEye size={14} style={{ color: "#60a5fa" }} />
                        ) : null}
                      </td>
                    )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal détail — portail sur document.body pour couvrir tout l'écran */}
      {selected && createPortal(
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
              {hasSaveData && (() => {
                const st = getStatus(selected);
                const isSeen = st?.seen ?? false;
                const isCaught = st?.caught ?? false;
                const internalId = st?.internalId ?? 0;
                const fought = foughtCounts && internalId > 0 ? (foughtCounts[internalId] ?? 0) : 0;
                const caught = capturedCounts && internalId > 0 ? (capturedCounts[internalId] ?? 0) : 0;
                if (!isSeen && !isCaught) return null;
                return (
                  <div className="pokedex-modal-save-stats">
                    <div className="pokedex-modal-save-title">Progression du joueur</div>
                    <div className="pokedex-modal-save-row">
                      {isCaught ? (
                        <span className="pokedex-save-tag pokedex-save-tag--caught">
                          <FaCircleCheck size={12} /> Capturé
                        </span>
                      ) : isSeen ? (
                        <span className="pokedex-save-tag pokedex-save-tag--seen">
                          <FaEye size={12} /> Vu
                        </span>
                      ) : null}
                    </div>
                    {(fought > 0 || caught > 0) && (
                      <div className="pokedex-modal-save-details">
                        {fought > 0 && (
                          <span className="pokedex-save-detail">
                            <FaCrosshairs size={11} /> {fought} combat{fought > 1 ? "s" : ""}
                          </span>
                        )}
                        {caught > 0 && (
                          <span className="pokedex-save-detail">
                            <FaBurst size={11} /> {caught} capture{caught > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
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
