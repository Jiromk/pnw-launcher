import React, { useState, useEffect } from "react";
import {
  FaHouse, FaScroll, FaBook, FaBookOpen, FaFileLines,
  FaLocationDot, FaTable, FaScaleBalanced, FaUsers,
  FaBars, FaXmark, FaGamepad, FaEnvelope, FaCrown,
} from "react-icons/fa6";

const ICON_MAP: Record<string, React.ReactNode> = {
  "fa-house": <FaHouse />,
  "fa-gamepad": <FaGamepad />,
  "fa-scroll": <FaScroll />,
  "fa-book": <FaBook />,
  "fa-book-open": <FaBookOpen />,
  "fa-file-lines": <FaFileLines />,
  "fa-location-dot": <FaLocationDot />,
  "fa-table": <FaTable />,
  "fa-scale-balanced": <FaScaleBalanced />,
  "fa-users": <FaUsers />,
  "fa-crown": <FaCrown />,
};

const VIEW_MAP: Record<string, string> = {
  accueil: "launcher",
  lore: "lore",
  pokedex: "pokedex",
  guide: "guide",
  boss: "boss",
  patchnotes: "patchnotes",
  items: "items",
  evs: "evs",
  bst: "bst",
  nerfs: "nerfs",
  equipe: "team",
};

interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  to: string;
  highlight?: boolean;
}

interface SidebarProps {
  siteUrl: string;
  activeView: string;
  onNavigate: (view: string) => void;
  /** URL d'image de fond de la sidebar (depuis le manifest du site). Prioritaire sur config/sidebar. */
  sidebarImageUrl?: string;
  /** Libellé de l’entrée d’accueil (FR: Launcher, EN: Home). */
  homeNavLabel?: string;
  openMenuAria?: string;
  closeMenuAria?: string;
  contactLabel?: string;
}

const DEFAULT_ITEMS: SidebarItem[] = [
  { id: "accueil", label: "Launcher", icon: "fa-gamepad", to: "/" },
  { id: "lore", label: "Le Lore", icon: "fa-scroll", to: "/lore", highlight: true },
  { id: "pokedex", label: "Pokedex", icon: "fa-book", to: "/pokedex" },
  { id: "guide", label: "Guide", icon: "fa-book-open", to: "/guide" },
  { id: "patchnotes", label: "PatchNotes", icon: "fa-file-lines", to: "/patchnotes" },
  { id: "items", label: "Items locations", icon: "fa-location-dot", to: "/item-location" },
  { id: "evs", label: "EVs locations", icon: "fa-location-dot", to: "/evs-location" },
  { id: "bst", label: "All BST + Abilities", icon: "fa-table", to: "/bst" },
  { id: "nerfs", label: "Nerfs and buffs", icon: "fa-scale-balanced", to: "/nerfs-and-buffs" },
  { id: "equipe", label: "L'équipe", icon: "fa-users", to: "/equipe" },
];

/** Retire les entrées gérées ailleurs (ex. GTS via le menu du launcher). */
function ensureLauncherSidebarItems(items: SidebarItem[]): SidebarItem[] {
  return items.filter((i) => i.id !== "gts");
}

export default function Sidebar({
  siteUrl,
  activeView,
  onNavigate,
  sidebarImageUrl,
  homeNavLabel = "Launcher",
  openMenuAria = "Ouvrir le menu",
  closeMenuAria = "Fermer le menu",
  contactLabel = "Contacter l'équipe",
}: SidebarProps) {
  const [items, setItems] = useState<SidebarItem[]>(DEFAULT_ITEMS);
  const [bgUrl, setBgUrl] = useState("");
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const base = siteUrl.replace(/\/$/, "");
    fetch(`${base}/api/config/sidebar?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d?.config) {
          const cfg = d.config;
          if (Array.isArray(cfg.items) && cfg.items.length) {
            const siteItems = cfg.items as SidebarItem[];
            const launcherItem: SidebarItem = { id: "accueil", label: homeNavLabel, icon: "fa-gamepad", to: "/" };
            const merged = ensureLauncherSidebarItems([
              launcherItem,
              ...siteItems.filter((i) => i.id !== "accueil" && i.id !== "gts"),
            ]);
            setItems(merged);
          }
          if (typeof cfg.backgroundImage === "string" && cfg.backgroundImage.trim()) {
            setBgUrl(cfg.backgroundImage.trim());
          }
        }
      })
      .catch((e) => {
        console.warn("[PNW] Sidebar config:", e);
      });
  }, [siteUrl, homeNavLabel]);

  const resolvedBgUrl = (sidebarImageUrl && sidebarImageUrl.trim()) ? sidebarImageUrl.trim() : bgUrl;
  const innerBg = resolvedBgUrl
    ? `linear-gradient(180deg, rgba(8,14,28,.85) 0%, rgba(5,9,20,.92) 100%), url(${resolvedBgUrl})`
    : undefined;

  return (
    <>
      {collapsed && (
        <button
          className="pnw-sidebar-toggle"
          onClick={() => setCollapsed(false)}
          aria-label={openMenuAria}
        >
          <FaBars />
        </button>
      )}

      <aside
        className={`pnw-sidebar ${collapsed ? "pnw-sidebar--collapsed" : ""}`}
        style={innerBg ? { backgroundImage: innerBg, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {/* Header with centered logo */}
        <div className="pnw-sidebar-header">
          <img src="/logo.png" alt="Pokémon New World" className="pnw-sidebar-logo" />
          <button
            className="pnw-sidebar-close"
            onClick={() => setCollapsed(true)}
            aria-label={closeMenuAria}
          >
            <FaXmark />
          </button>
        </div>

        {/* Navigation */}
        <nav className="pnw-sidebar-nav">
          {items.map((item) => {
            const viewName = VIEW_MAP[item.id] || "launcher";
            const isActive = activeView === viewName;
            const icon = ICON_MAP[item.icon] || <FaHouse />;
            const isLore = item.highlight;
            const label = item.id === "accueil" ? homeNavLabel : item.label;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(viewName)}
                className={[
                  "pnw-sidebar-link",
                  isActive && "pnw-sidebar-link--active",
                  isLore && "pnw-sidebar-link--lore",
                ].filter(Boolean).join(" ")}
                title={label}
              >
                <span className={`pnw-sidebar-link-icon${isLore ? " pnw-sidebar-link-icon--lore" : ""}`}>
                  {icon}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Contact button at bottom */}
        <div className="pnw-sidebar-contact-wrap">
          <button
            type="button"
            onClick={() => onNavigate("contact")}
            className="pnw-sidebar-contact-btn"
            title={contactLabel}
          >
            <FaEnvelope />
            <span>{contactLabel}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
