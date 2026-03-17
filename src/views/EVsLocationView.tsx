import { useState, useEffect, useMemo } from "react";
import {
  FaChartLine,
  FaMagnifyingGlass,
  FaMapLocationDot,
  FaChevronDown,
  FaHeart,
  FaHandFist,
  FaShield,
  FaWandMagicSparkles,
  FaGem,
  FaGaugeHigh,
  FaCircle,
  FaSpinner,
} from "react-icons/fa6";
import { buildPokedexLookup, findSprite } from "../utils/pokedexLookup";

interface EvPokemon {
  name: string;
  imageUrl?: string;
  points?: number;
  zones?: string[];
}

interface EvEntry {
  id: string;
  label: string;
  icon?: string;
  zone?: string;
  pokemon: EvPokemon[];
}

function normalize(str: string) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const EV_ICONS: Record<string, React.ReactNode> = {
  "fa-heart": <FaHeart size={20} />,
  "fa-heart-pulse": <FaHeart size={20} />,
  "fa-hand-fist": <FaHandFist size={20} />,
  "fa-shield": <FaShield size={20} />,
  "fa-wand-magic-sparkles": <FaWandMagicSparkles size={20} />,
  "fa-gem": <FaGem size={20} />,
  "fa-gauge-high": <FaGaugeHigh size={20} />,
  "fa-circle": <FaCircle size={16} />,
};

function getEvIcon(iconName: string | undefined) {
  const key = (iconName || "fa-circle").toLowerCase().trim();
  return EV_ICONS[key] ?? <FaCircle size={16} />;
}

const PLACEHOLDER_SPRITE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect fill="%23313538" width="96" height="96" rx="8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%237ecdf2" font-size="10" font-family="sans-serif">?</text></svg>'
  );

export default function EVsLocationView({ siteUrl }: { siteUrl: string }) {
  const [entries, setEntries] = useState<EvEntry[]>([]);
  const [pokedexLookup, setPokedexLookup] = useState<ReturnType<typeof buildPokedexLookup>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pokemonSearch, setPokemonSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const base = siteUrl.replace(/\/$/, "");

  useEffect(() => {
    const evsPromise = fetch(`${base}/api/evs-location?t=${Date.now()}`).then((r) => r.json());
    const pokedexPromise = fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json());
    Promise.all([evsPromise, pokedexPromise])
      .then(([evsRes, pokedexRes]) => {
        if (evsRes?.success && Array.isArray(evsRes.evs?.entries)) {
          setEntries(
            evsRes.evs.entries.map((ev: any) => ({
              id: ev.id || "",
              label: ev.label || "",
              icon: ev.icon || "fa-circle",
              zone: ev.zone || "",
              pokemon: Array.isArray(ev.pokemon)
                ? ev.pokemon.map((p: any) =>
                    typeof p === "object" && p !== null
                      ? {
                          name: p.name || "",
                          imageUrl: (p.imageUrl || "").trim() || undefined,
                          points: p.points || 0,
                          zones: Array.isArray(p.zones) ? p.zones : [],
                        }
                      : { name: String(p), points: 0, zones: [] }
                  )
                : [],
            }))
          );
        }
        if (pokedexRes?.success && Array.isArray(pokedexRes.pokedex?.entries)) {
          setPokedexLookup(buildPokedexLookup(pokedexRes.pokedex.entries));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base]);

  const zones = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((ev) =>
      ev.pokemon.forEach((p) => (p.zones || []).forEach((z) => z && set.add(z)))
    );
    return Array.from(set).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = normalize(pokemonSearch);
    return entries
      .map((ev) => {
        let pokemon = ev.pokemon;
        if (zoneFilter) pokemon = pokemon.filter((p) => (p.zones || []).includes(zoneFilter));
        if (q) pokemon = pokemon.filter((p) => normalize(p.name).includes(q));
        return { ...ev, pokemon };
      })
      .filter((ev) => ev.pokemon.length > 0);
  }, [entries, pokemonSearch, zoneFilter]);

  const fullImageUrl = (url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const getSpriteUrl = (p: EvPokemon): string => {
    const direct = fullImageUrl(p.imageUrl);
    if (direct) return direct;
    const fromPokedex = findSprite(pokedexLookup, p.name);
    return fromPokedex ? fullImageUrl(fromPokedex) : "";
  };

  if (loading) return <Loading />;

  return (
    <div className="evs-location-page animate-in">
      <div className="evs-location-container">
        <header className="evs-location-header">
          <h1 className="evs-location-title">
            <FaChartLine className="evs-location-title-icon" aria-hidden />
            EVs par lieu
          </h1>
          <p className="evs-location-desc">
            Voici un tableau vous permettant de farm un EV en fonction de la zone. Table des EV
            basée sur les Pokémon du jeu Pokémon New World (run HopeGrave). Cliquez sur une stat
            pour afficher les Pokémon qui donnent cet EV.
          </p>
        </header>

        <div className="evs-location-filters">
          <div className="evs-location-filter-group">
            <label htmlFor="evs-zone-filter" className="evs-location-filter-label">
              <FaMapLocationDot className="evs-location-filter-icon" aria-hidden /> Zone
            </label>
            <select
              id="evs-zone-filter"
              className="evs-location-select"
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
            >
              <option value="">Toutes les zones</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div className="evs-location-filter-group">
            <label htmlFor="evs-pokemon-search" className="evs-location-filter-label">
              <FaMagnifyingGlass className="evs-location-filter-icon" aria-hidden /> Pokémon
            </label>
            <input
              id="evs-pokemon-search"
              type="search"
              className="evs-location-search"
              value={pokemonSearch}
              onChange={(e) => setPokemonSearch(e.target.value)}
              placeholder="Rechercher un Pokémon…"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="evs-location-grid">
          {filteredEntries.map((ev) => {
            const isOpen = expandedId === ev.id;
            return (
              <article
                key={ev.id}
                className={`card evs-location-card ${isOpen ? "evs-location-card--open" : ""}`}
              >
                <button
                  type="button"
                  className="evs-location-card-head"
                  onClick={() => setExpandedId(isOpen ? null : ev.id)}
                  aria-expanded={isOpen}
                  aria-controls={`evs-panel-${ev.id}`}
                  id={`evs-trigger-${ev.id}`}
                >
                  <span className="evs-location-card-icon" aria-hidden>
                    {getEvIcon(ev.icon)}
                  </span>
                  <span className="evs-location-card-label">{ev.label}</span>
                  <span className="evs-location-card-count">{ev.pokemon.length} Pokémon</span>
                  <FaChevronDown
                    className={`evs-location-card-chevron ${isOpen ? "open" : ""}`}
                    aria-hidden
                  />
                </button>
                <div
                  id={`evs-panel-${ev.id}`}
                  role="region"
                  aria-labelledby={`evs-trigger-${ev.id}`}
                  className="evs-location-card-body"
                  hidden={!isOpen}
                >
                  <div className="evs-location-pokemon-grid">
                    {ev.pokemon.map((p, i) => {
                      const name = p.name;
                      const points = p.points ?? 0;
                      const pokemonZones = p.zones || [];
                      const spriteUrl =
                        getSpriteUrl(p) || PLACEHOLDER_SPRITE;
                      return (
                        <div
                          key={`${ev.id}-${name}-${i}`}
                          className={`evs-location-pokemon-item ${points > 0 ? "evs-location-pokemon-item--has-pts" : ""}`}
                        >
                          {pokemonZones.length > 0 && (
                            <span
                              className="evs-location-pokemon-zone-fa"
                              title={`Vous pouvez le farm ici : ${pokemonZones.join(", ")}`}
                              aria-label={`Farm possible ici : ${pokemonZones.join(", ")}`}
                            >
                              <FaMapLocationDot />
                            </span>
                          )}
                          {points > 0 && (
                            <span className="evs-location-pokemon-tooltip" role="tooltip">
                              {points} EV par KO
                            </span>
                          )}
                          <div className="evs-location-pokemon-sprite-wrap">
                            <img
                              src={spriteUrl}
                              alt=""
                              className="evs-location-pokemon-sprite"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = PLACEHOLDER_SPRITE;
                              }}
                            />
                            {points > 0 && (
                              <span className="evs-location-pokemon-pts">{points}</span>
                            )}
                          </div>
                          <span className="evs-location-pokemon-name">{name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="evs-location-page animate-in">
      <div className="evs-location-container">
        <header className="evs-location-header">
          <h1 className="evs-location-title">
            <FaChartLine className="evs-location-title-icon" aria-hidden />
            EVs par lieu
          </h1>
          <p className="evs-location-desc">
            Voici un tableau vous permettant de farm un EV en fonction de la zone. Table des EV
            basée sur les Pokémon du jeu Pokémon New World (run HopeGrave). Cliquez sur une stat
            pour afficher les Pokémon qui donnent cet EV.
          </p>
        </header>
        <div className="evs-location-loading">
          <FaSpinner className="evs-location-loading-spinner animate-spin" aria-hidden />
          <span>Chargement…</span>
        </div>
      </div>
    </div>
  );
}
