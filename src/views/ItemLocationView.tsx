import { useState, useEffect, useMemo } from "react";
import {
  FaLocationDot,
  FaMagnifyingGlass,
  FaMapPin,
  FaCube,
  FaHandHolding,
  FaGift,
  FaRoute,
  FaChevronDown,
  FaXmark,
  FaMapLocationDot,
  FaSpinner,
} from "react-icons/fa6";

interface ItemEntry {
  item: string;
  zone: string;
  obtention: string;
}
interface ZoneGroup {
  zone: string;
  items: { item: string; obtention: string }[];
}

function normalize(str: string) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function groupByZone(entries: ItemEntry[]): ZoneGroup[] {
  const order: string[] = [];
  const map: Record<string, { item: string; obtention: string }[]> = {};
  for (const e of entries) {
    const zone = (e.zone || "").trim() || "—";
    if (!map[zone]) {
      order.push(zone);
      map[zone] = [];
    }
    map[zone].push({
      item: (e.item || "").trim() || "—",
      obtention: (e.obtention || "").trim() || "—",
    });
  }
  return order.map((zone) => ({ zone, items: map[zone] }));
}

export default function ItemLocationView({ siteUrl }: { siteUrl: string }) {
  const [entries, setEntries] = useState<ItemEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [openZoneDropdown, setOpenZoneDropdown] = useState(false);
  const [openItemDropdown, setOpenItemDropdown] = useState(false);

  useEffect(() => {
    const close = () => {
      setOpenZoneDropdown(false);
      setOpenItemDropdown(false);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".item-location-dropdown")) close();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    const base = siteUrl.replace(/\/$/, "");
    fetch(`${base}/api/config/item-location?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d?.config) {
          const cfg = d.config;
          if (Array.isArray(cfg.entries)) setEntries(cfg.entries);
          else if (Array.isArray(cfg)) setEntries(cfg);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [siteUrl]);

  const groups = useMemo(() => groupByZone(entries), [entries]);

  const zoneOptions = useMemo(() => {
    return [...new Set(groups.map((g) => g.zone))].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const itemOptions = useMemo(() => {
    const items = new Set<string>();
    groups.forEach((g) => g.items.forEach((row) => row.item && items.add(row.item)));
    return [...items].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const q = normalize(searchQuery);
    let byZone = filterZone ? groups.filter((g) => g.zone === filterZone) : groups;
    if (filterItem) {
      byZone = byZone
        .map((g) => ({
          zone: g.zone,
          items: g.items.filter((row) => row.item === filterItem),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (!q) return byZone;
    return byZone
      .map((g) => ({
        zone: g.zone,
        items: g.items.filter(
          (row) =>
            normalize(row.item).includes(q) ||
            normalize(row.obtention).includes(q) ||
            normalize(g.zone).includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, searchQuery, filterZone, filterItem]);

  if (loading) return <Loading />;

  return (
    <div className="item-location-page animate-in">
      <div className="item-location-container">
        <header className="item-location-header">
          <h1 className="item-location-title">
            <FaLocationDot className="item-location-title-icon" aria-hidden />
            Item Location
          </h1>
          <p className="item-location-desc">
            Où trouver les objets et comment les obtenir dans la région de Bélamie.
          </p>
        </header>

        {groups.length === 0 ? (
          <div className="card item-location-empty">
            <FaMapLocationDot className="item-location-empty-icon" aria-hidden />
            <p>Aucune donnée pour le moment.</p>
          </div>
        ) : (
          <>
            <div className="card item-location-toolbar">
              <div className="item-location-search-wrap">
                <FaMagnifyingGlass className="item-location-search-icon" aria-hidden />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher (objet, zone, obtention)…"
                  className="item-location-search-input"
                  aria-label="Recherche"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="item-location-search-clear"
                    aria-label="Effacer la recherche"
                  >
                    <FaXmark />
                  </button>
                )}
              </div>
              <div className="item-location-dropdown-wrap">
                <span className="item-location-dropdown-label">
                  <FaMapPin className="item-location-dropdown-icon" aria-hidden /> Zone
                </span>
                <div className="item-location-dropdown">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenZoneDropdown((v) => !v);
                      setOpenItemDropdown(false);
                    }}
                    className="item-location-dropdown-trigger"
                    aria-expanded={openZoneDropdown}
                    aria-haspopup="listbox"
                  >
                    <span>{filterZone || "Toutes les zones"}</span>
                    <FaChevronDown
                      className={`item-location-dropdown-chevron ${openZoneDropdown ? "open" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {openZoneDropdown && (
                    <ul
                      className="item-location-dropdown-list"
                      role="listbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <li>
                        <button
                          type="button"
                          role="option"
                          onClick={() => {
                            setFilterZone("");
                            setOpenZoneDropdown(false);
                          }}
                          className="item-location-dropdown-option"
                        >
                          Toutes les zones
                        </button>
                      </li>
                      {zoneOptions.map((z) => (
                        <li key={z}>
                          <button
                            type="button"
                            role="option"
                            onClick={() => {
                              setFilterZone(z);
                              setOpenZoneDropdown(false);
                            }}
                            className={`item-location-dropdown-option ${filterZone === z ? "selected" : ""}`}
                          >
                            {z}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="item-location-dropdown-wrap">
                <span className="item-location-dropdown-label">
                  <FaCube className="item-location-dropdown-icon" aria-hidden /> Objet
                </span>
                <div className="item-location-dropdown">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenItemDropdown((v) => !v);
                      setOpenZoneDropdown(false);
                    }}
                    className="item-location-dropdown-trigger"
                    aria-expanded={openItemDropdown}
                    aria-haspopup="listbox"
                  >
                    <span>{filterItem || "Tous les objets"}</span>
                    <FaChevronDown
                      className={`item-location-dropdown-chevron ${openItemDropdown ? "open" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {openItemDropdown && (
                    <ul
                      className="item-location-dropdown-list"
                      role="listbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <li>
                        <button
                          type="button"
                          role="option"
                          onClick={() => {
                            setFilterItem("");
                            setOpenItemDropdown(false);
                          }}
                          className="item-location-dropdown-option"
                        >
                          Tous les objets
                        </button>
                      </li>
                      {itemOptions.map((it) => (
                        <li key={it}>
                          <button
                            type="button"
                            role="option"
                            onClick={() => {
                              setFilterItem(it);
                              setOpenItemDropdown(false);
                            }}
                            className={`item-location-dropdown-option ${filterItem === it ? "selected" : ""}`}
                          >
                            {it}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {filteredGroups.length === 0 ? (
              <div className="card item-location-empty item-location-no-results">
                <FaMagnifyingGlass className="item-location-empty-icon" aria-hidden />
                <p>Aucun résultat pour cette recherche ou ce filtre.</p>
              </div>
            ) : (
              <div className="item-location-sections">
                {filteredGroups.map((g) => (
                  <section key={g.zone} className="card item-location-zone">
                    <h2 className="item-location-zone-title">
                      <FaMapPin className="item-location-zone-icon" aria-hidden />
                      {g.zone}
                    </h2>
                    <div className="item-location-table-wrap">
                      <table className="item-location-table">
                        <colgroup>
                          <col className="item-location-col-item" />
                          <col className="item-location-col-obtention" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th scope="col" className="item-location-th-objet">
                              <span className="item-location-th-inner">
                                <FaCube className="item-location-th-icon" aria-hidden /> Objet
                              </span>
                            </th>
                            <th scope="col" className="item-location-th-obtention">
                              <span className="item-location-th-inner">
                                <FaHandHolding className="item-location-th-icon" aria-hidden /> Obtention
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((row, i) => (
                            <tr key={`${g.zone}-${i}`}>
                              <td className="item-location-cell-item">
                                <span className="item-location-cell-inner">
                                  <FaGift className="item-location-cell-fa" aria-hidden />
                                  <span>{row.item}</span>
                                </span>
                              </td>
                              <td className="item-location-cell-obtention">
                                <span className="item-location-cell-inner item-location-cell-inner--right">
                                  <FaRoute className="item-location-cell-fa" aria-hidden />
                                  <span>{row.obtention}</span>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="item-location-page animate-in">
      <div className="item-location-container">
        <header className="item-location-header">
          <h1 className="item-location-title">
            <FaLocationDot className="item-location-title-icon" aria-hidden />
            Item Location
          </h1>
          <p className="item-location-desc">
            Où trouver les objets et comment les obtenir dans la région de Bélamie.
          </p>
        </header>
        <div className="item-location-loading">
          <FaSpinner className="animate-spin" aria-hidden />
          <span>Chargement…</span>
        </div>
      </div>
    </div>
  );
}
