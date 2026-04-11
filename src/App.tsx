// src/App.tsx
import React from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress, Modal } from "./ui";
import { check as checkUpdater } from "@tauri-apps/plugin-updater";
import type { Manifest, PlayerProfile, ChatProfile } from "./types";
import { getSession, getChatProfile, onAuthStateChange } from "./chatAuth";
import type { Session } from "@supabase/supabase-js";
import { LauncherSelfUpdateDialog } from "./LauncherSelfUpdateDialog";
import { GameUpdateDialog } from "./GameUpdateDialog";
import { fetchPatchNotes, findVersionNotes, type PatchVersion } from "./utils/patchNotes";
import { parseSave } from "./profile";
import {
  FaFolderOpen,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaRotateRight,
  FaArrowsRotate,
  FaLanguage,
  FaIdCard,
  FaUser,
  FaCoins,
  FaCalendarDays,
  FaClock,
  FaEye,
  FaCircleCheck,
  FaGamepad,
  FaCrown,
  FaPlus,
  FaFileImport,
  FaChevronDown,
  FaFloppyDisk,
  FaShieldHalved,
  FaStar,
  FaHeart,
  FaHandFist,
  FaShield,
  FaBolt,
  FaWandMagicSparkles,
  FaChartPie,
  FaDna,
  FaLeaf,
  FaMars,
  FaVenus,
  FaVenusMars,
  FaLayerGroup,
  FaBagShopping,
  FaChartLine,
  FaCommentDots,
} from "react-icons/fa6";
import { NATURE_FR } from "./gtsDepositedPokemon";
import { ThemeMenu, useTheme, usePfp, LauncherMenu } from "./themes";
import Sidebar from "./Sidebar";
import Titlebar from "./Titlebar";
import LoreView from "./views/LoreView";
import GuideView from "./views/GuideView";
import PatchNotesView from "./views/PatchNotesView";
import PokedexView from "./views/PokedexView";
import ItemLocationView from "./views/ItemLocationView";
import EVsLocationView from "./views/EVsLocationView";
import BSTView from "./views/BSTView";
import NerfsAndBuffsView from "./views/NerfsAndBuffsView";
import TeamView from "./views/TeamView";
import ContactView from "./views/ContactView";
import GTSView from "./views/GTSView";
import BossView from "./views/BossView";
import ChatView from "./views/ChatView";
import {
  formatErrorForUser,
  getLauncherUi,
  uiLangFromGameLang,
  type LauncherUi,
  type UiLang,
} from "./launcherUiLocale";

/* ==================== Constantes ==================== */
const PNW_SITE_BASE = import.meta.env.VITE_PNW_SITE_URL?.replace(/\/$/, "") || "https://www.pokemonnewworld.fr";
const MANIFEST_BASE = `${PNW_SITE_BASE}/api/downloads/manifest`;
/** Titre de fenêtre (suffixe `v…` ajouté au montage avec la version Tauri). */
const LAUNCHER_WINDOW_TITLE_BASE = "Pokémon New World — Launcher";
/** Taille minimale du fichier distant pour activer la piste EN (évite placeholders ~128 o). */
const MIN_EN_ARCHIVE_BYTES = 2 * 1024 * 1024;

/**
 * URL du site Pokémon New World. Toutes les vues (Lore, Pokédex, Extradex, EVs, BST, etc.)
 * chargent leurs données via les API du site (ex. /api/lore, /api/pokedex, /api/extradex).
 * Tout contenu ajouté ou modifié sur le site est donc automatiquement reflété dans le launcher
 * à chaque chargement de vue (aucun cache de contenu côté launcher).
 */
const PNW_SITE_URL = PNW_SITE_BASE;

type DlEvent = {
  stage: "download" | "extract" | "paused" | "canceled" | "done" | "reconnect";
  downloaded?: number;
  total?: number;
  extracted?: number;
  eta_secs?: number | null;
  speed_bps?: number;
};
type UiState =
  | "idle"
  | "checking"
  | "ready"
  | "downloading"
  | "paused"
  | "extracting"
  | "done"
  | "reconnecting"
  | "error";

function getZipUrl(m: Manifest) {
  return (m as any).downloadUrl || (m as any).zip_url || "";
}
/** Compare des versions type 0.8, 0.52, 1.0 (0.8 > 0.52, 1.0 > 0.8). */
function cmpSemver(a: string, b: string) {
  const A = a.split(".").map(Number);
  const B = b.split(".").map(Number);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    let x = A[i] ?? 0;
    let y = B[i] ?? 0;
    if (i === 1 && A.length === 2 && A[1] < 10) x = x * 10;
    if (i === 1 && B.length === 2 && B[1] < 10) y = y * 10;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(1)} ${u[i]}`;
}
function fmtTime(s?: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60),
    r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
function prependUnique(list: string[], line: string) {
  return list[0] === line ? list : [line, ...list];
}

/** Append a line to %APPDATA%\Local\PNW Launcher\logs\launcher-YYYY-MM-DD.log via the Rust backend. */
async function logToFile(level: "INFO" | "WARN" | "ERROR", message: string) {
  try {
    await invoke("cmd_append_log", { level, message });
  } catch (e) {
    console.warn("[logToFile] failed:", e);
  }
}

/* ===== Helpers chemins + sprites/ico ===== */
import { normPath as norm, joinPath as join, pad2, pad3, toFileUrl, rootFromSavePath, monIconCandidates } from "./utils/monSprite";


/** Sous-dossier dédié sous le dossier parent choisi (évite d’extraire à la racine du Bureau). */
function childFolderForNewLangInstall(lang: "fr" | "en"): string {
  return lang === "en" ? "Pokemon New World (EN)" : "Pokemon New World (FR)";
}
/** Chemin d’installation = parent choisi + sous-dossier (même logique qu’un « emplacement dédié » sous ce parent). */
function installRootFromParentDirectory(parentPath: string, lang: "fr" | "en"): string {
  const base = norm(String(parentPath)).replace(/\/+$/, "");
  const j = join(base, childFolderForNewLangInstall(lang));
  return j.replaceAll("/", "\\");
}


/* Dossier AppData\Local\PNW Launcher */
function looksLikeLauncherDir(p?: string | null) {
  if (!p) return false;
  const s = p.toLowerCase().replaceAll("/", "\\");
  return s.includes("\\appdata\\local\\pnw launcher");
}

/* Base64 robuste */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** Formate les secondes en "X XXX h YY min" (espaces milliers, unités claires). */
function formatPlayTime(sec: number, lang: UiLang = "fr"): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const loc = lang === "en" ? "en-US" : "fr-FR";
  const hStr = h.toLocaleString(loc);
  const mStr = m.toString().padStart(2, "0");
  if (h === 0) return `${mStr} min`;
  if (m === 0) return `${hStr} h`;
  return `${hStr} h ${mStr} min`;
}

/** Ligne "détails" Rich Presence : Pseudo #ID + nombre d’heures. */
function buildDiscordDetails(p: PlayerProfile | null): string | null {
  if (!p) return null;
  const name = (p.name ?? "—").toString().trim();
  const id = p.id != null ? `#${p.id.toString().padStart(5, "0")}` : "";
  const sec = p.playTimeSec ?? 0;
  const hours = Math.floor(sec / 3600);
  const time = hours > 0 ? `${hours.toLocaleString("fr-FR")} h` : `${Math.floor(sec / 60)} min`;
  const parts = [name + (id ? ` ${id}` : ""), time].filter(Boolean);
  return parts.length ? parts.join(" • ") : null;
}

/* Sprite joueur (fallback) */
function playerSpriteUrl(p?: PlayerProfile | null) {
  if (!p) return "/male_sprite.png";
  if (p.gender === 1) return "/male_sprite.png";
  if (p.gender === 0) return "/female_sprite.png";
  const ch = (p.charset || "").toLowerCase();
  if (/female|girl|heroin/.test(ch)) return "/female_sprite.png";
  return "/male_sprite.png";
}

/** Badge boss : PNG du jeu, ou icône FA si le fichier est absent / illisible. */
function BossBadgeIcon({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (failed) {
    return (
      <FaShieldHalved
        className="boss-badge-icon boss-badge-icon--fa"
        aria-hidden
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="boss-badge-icon"
      onError={() => setFailed(true)}
    />
  );
}

/* ==================== Bouton avec icône ==================== */
type IconButtonProps = React.ComponentProps<typeof Button> & {
  icon: React.ReactNode;
  label: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "primary" | "secondary" | "ghost" | "success";
};
function IconButton({
  icon,
  label,
  size = "md",
  tone = "primary",
  className = "",
  ...props
}: IconButtonProps) {
  const sizes = {
    sm: {
      pad: "px-3 py-2",
      iconBox: "w-6 h-6",
      icon: "text-[12px]",
      gap: "gap-2",
      text: "text-sm",
    },
    md: {
      pad: "px-4 py-2.5",
      iconBox: "w-7 h-7",
      icon: "text-[14px]",
      gap: "gap-2.5",
      text: "text-sm",
    },
    lg: {
      pad: "px-5 py-3",
      iconBox: "w-9 h-9",
      icon: "text-[16px]",
      gap: "gap-3",
      text: "text-base",
    },
  }[size];
  const tones = {
    primary: "accent-glow-btn ring-1 ring-white/5",
    secondary: "bg-white/8 hover:bg-white/12 ring-1 ring-white/8 hover:ring-white/12",
    ghost: "bg-white/5 hover:bg-white/10 ring-1 ring-white/6 hover:ring-white/10",
    success: "accent-glow-btn ring-1 ring-white/5",
  };
  return (
    <Button
      className={[
        "group rounded-xl shadow-[0_2px_12px_-4px_rgba(0,0,0,0.35)] hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.45)] backdrop-blur transition-all duration-200 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        sizes.pad,
        sizes.gap,
        sizes.text,
        tones[tone],
        className,
      ].join(" ")}
      style={{ backgroundImage: "none" }}
      {...props}
    >
      <span
        className={[
          "grid place-items-center rounded-lg bg-white/10 ring-1 ring-white/8",
          sizes.iconBox,
          "transition-transform duration-200 group-active:scale-95",
        ].join(" ")}
      >
        <span className={sizes.icon}>{icon}</span>
      </span>
      <span className="font-medium tracking-wide text-white/95">{label}</span>
    </Button>
  );
}

/* ==================== Types de vues ==================== */
type ViewName = "launcher" | "lore" | "pokedex" | "guide" | "boss" | "patchnotes" | "items" | "evs" | "bst" | "nerfs" | "team" | "contact" | "gts" | "battle";

/* ==================== Dropdown Dossier (portail) ==================== */
function FolderDropdown({
  anchorRef,
  onClose,
  onChooseFolder,
  onInsertSave,
  chooseLabel,
  insertLabel,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onChooseFolder: () => void;
  onInsertSave: () => void;
  chooseLabel: string;
  insertLabel: string;
}) {
  const [pos, setPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, [anchorRef]);
  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="pnw-folder-menu fixed w-64 rounded-xl bg-black/90 text-white/90 ring-1 ring-white/15 backdrop-blur-xl shadow-2xl z-[9999]"
        style={{ top: pos.top, right: pos.right }}
      >
        <button
          className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-t-xl flex items-center gap-2 transition-colors duration-200"
          onClick={onChooseFolder}
        >
          <FaFolderOpen /> {chooseLabel}
        </button>
        <button
          className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-b-xl flex items-center gap-2 transition-colors duration-200"
          onClick={onInsertSave}
        >
          <FaFileImport /> {insertLabel}
        </button>
      </div>
    </>
  );
}

/** Menu langue du jeu (portail) — aligné sur le sélecteur de save, sans select natif. */
function GameLanguageMenu({
  anchorRef,
  onClose,
  gameLang,
  canUseEnglishTrack,
  enTrack,
  hasLocalEnInstall,
  ui,
  onPick,
  disabled,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  gameLang: "fr" | "en" | null;
  canUseEnglishTrack: boolean;
  enTrack: "loading" | "ok" | "unavailable";
  hasLocalEnInstall: boolean;
  ui: LauncherUi;
  onPick: (lang: "fr" | "en") => void;
  disabled: boolean;
}) {
  const [pos, setPos] = useState({ top: 0, right: 0, minW: 176 });
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 8,
      right: window.innerWidth - r.right,
      minW: Math.max(176, r.width),
    });
  }, [anchorRef]);

  const enLabel =
    enTrack === "loading" && !hasLocalEnInstall
      ? ui.enChecking
      : !canUseEnglishTrack
        ? ui.enUnavailable
        : "English";

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} aria-hidden />
      <div
        role="listbox"
        aria-label={ui.gameLanguage}
        className="lang-menu-dropdown fixed z-[9999] overflow-hidden rounded-xl p-1.5 text-white/90 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl"
        style={{
          top: pos.top,
          right: pos.right,
          minWidth: pos.minW,
        }}
      >
        <button
          type="button"
          role="option"
          aria-selected={gameLang !== "en"}
          disabled={disabled}
          className={`lang-menu-option ${gameLang !== "en" ? "lang-menu-option--active" : ""}`}
          onClick={() => {
            onClose();
            onPick("fr");
          }}
        >
          <FaLanguage className="lang-menu-option-icon shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 flex-1 text-left font-medium">Français</span>
          {gameLang !== "en" && <FaCircleCheck className="lang-menu-option-check shrink-0" />}
        </button>
        <button
          type="button"
          role="option"
          aria-selected={gameLang === "en"}
          disabled={disabled || !canUseEnglishTrack}
          title={!canUseEnglishTrack ? ui.welcome.enTrackWarn : undefined}
          className={`lang-menu-option ${gameLang === "en" ? "lang-menu-option--active" : ""} ${
            !canUseEnglishTrack ? "lang-menu-option--disabled" : ""
          }`}
          onClick={() => {
            if (!canUseEnglishTrack) return;
            onClose();
            onPick("en");
          }}
        >
          <FaLanguage className="lang-menu-option-icon shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left font-medium">{enLabel}</span>
          {gameLang === "en" && <FaCircleCheck className="lang-menu-option-check shrink-0" />}
        </button>
      </div>
    </>,
    document.body,
  );
}

/* ==================== App ==================== */
export default function App() {
  const [activeView, setActiveView] = useState<ViewName>("launcher");
  const [status, setStatus] = useState<UiState>("idle");
  /** Toujours aligné sur `status` (évite closures obsolètes dans polling / auto-update). */
  const statusRef = useRef(status);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState("—");
  const [speed, setSpeed] = useState("—/s");
  const [log, setLog] = useState<string[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  // ─── Chat session (lifté pour le GTS wishlist) ───
  const [chatSession, setChatSession] = useState<Session | null>(null);
  const [chatProfile, setChatProfile] = useState<ChatProfile | null>(null);
  useEffect(() => {
    getSession().then(setChatSession);
    const sub = onAuthStateChange(setChatSession);
    return () => sub.unsubscribe();
  }, []);
  useEffect(() => {
    if (!chatSession?.user?.id) { setChatProfile(null); return; }
    getChatProfile(chatSession.user.id).then(setChatProfile);
  }, [chatSession?.user?.id]);

  const [installDir, setInstallDir] = useState("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [hasExe, setHasExe] = useState(false);
  const [hasVersion, setHasVersion] = useState(false);

  const [openFolderMenu, setOpenFolderMenu] = useState(false);
  const folderBtnRef = useRef<HTMLDivElement>(null);
  const [openLangMenu, setOpenLangMenu] = useState(false);
  const langMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanText, setScanText] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  // Modals
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  const [showLauncherSelfUpdate, setShowLauncherSelfUpdate] = useState(false);
  const [launcherSelfUpdatePayload, setLauncherSelfUpdatePayload] = useState<{
    currentVersion: string;
    remoteVersion: string;
  } | null>(null);
  const launcherSelfUpdateCheckedRef = useRef(false);
  // ── État de la fenêtre dédiée de mise à jour du jeu ──
  const [showGameUpdateDialog, setShowGameUpdateDialog] = useState(false);
  const [gameUpdatePatchNotes, setGameUpdatePatchNotes] = useState<PatchVersion | null>(null);
  const [gameUpdatePatchNotesLoading, setGameUpdatePatchNotesLoading] = useState(false);
  const [gameUpdatePatchNotesError, setGameUpdatePatchNotesError] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  /** Référence vers l'objet Update du plugin (pour lancer downloadAndInstall). */
  const launcherUpdateRef = useRef<Awaited<ReturnType<typeof checkUpdater>> | null>(null);
  const [launcherInstallerDl, setLauncherInstallerDl] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  /** Langue du jeu (piste manifest). null = pas encore enregistré côté config. */
  const [gameLang, setGameLang] = useState<"fr" | "en" | null>(null);
  const [launcherVersion, setLauncherVersion] = useState<string | null>(null);
  /** Pour les logs d’événements (listeners) qui ne voient pas toujours le `gameLang` à jour. */
  const gameLangRef = useRef<"fr" | "en" | null>(null);
  gameLangRef.current = gameLang;
  const [showMigrationLangDialog, setShowMigrationLangDialog] = useState(false);
  const [showLangSwitchConfirm, setShowLangSwitchConfirm] = useState(false);
  const [pendingLang, setPendingLang] = useState<"fr" | "en" | null>(null);
  /** Manifest EN OK + fichier assez lourd si Content-Length connu (sinon on accepte). */
  const [enTrack, setEnTrack] = useState<"loading" | "ok" | "unavailable">("loading");
  /** Exe trouvé dans `install_dir_en` (même si le manifeste EN serveur est KO). */
  const [hasLocalEnInstall, setHasLocalEnInstall] = useState(false);
  const hasLocalEnInstallRef = useRef(false);
  /** Exe trouvé dans `install_dir_fr`. */
  const [hasLocalFrInstall, setHasLocalFrInstall] = useState(false);
  const hasLocalFrInstallRef = useRef(false);

  // Chat panel
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [gtsSharePending, setGtsSharePending] = useState<import("./types").GtsShareData | null>(null);
  const [gtsPendingOnlineId, setGtsPendingOnlineId] = useState<string | number | null>(null);
  const [gtsWishlistMatches, setGtsWishlistMatches] = useState(0);

  /* Noms d'espèces PSDK (index = ID interne) */
  const [speciesNames, setSpeciesNames] = useState<string[] | null>(null);
  /* Noms d'attaques PSDK (index = ID interne) */
  const [skillNames, setSkillNames] = useState<string[] | null>(null);
  /* Noms de talents PSDK (index = ID interne) */
  const [abilityNames, setAbilityNames] = useState<string[] | null>(null);
  /* Noms d'objets PSDK (index = ID interne, singulier) */
  const [itemNames, setItemNames] = useState<string[] | null>(null);
  /* Noms de talents depuis le game_state.json (clé = speciesId_form → ability_name) */
  const [liveAbilityNames, setLiveAbilityNames] = useState<Record<string, string>>({});

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileState, setProfileState] =
    useState<"idle" | "loading" | "ready" | "none" | "error">("idle");
  const [lastSavePath, setLastSavePath] = useState<string | null>(null);
  /* Cache sprites shiny pour l'équipe (clé = "speciesId_form", valeur = data URL ou null) */
  const [teamShinySpriteCache, setTeamShinySpriteCache] = useState<Record<string, string | null>>({});
  const teamShinyRequestedRef = useRef<Set<string>>(new Set());
  /* Cache sprites alt shiny pour l'équipe (loose files {id}a.png) */
  const [teamAltShinySpriteCache, setTeamAltShinySpriteCache] = useState<Record<string, string | null>>({});
  const teamAltShinyRequestedRef = useRef<Set<string>>(new Set());
  /* Cache sprites normaux pour l'équipe (fallback VD quand les fichiers pokefront n'existent pas) */
  const [teamNormalSpriteCache, setTeamNormalSpriteCache] = useState<Record<string, string | null>>({});
  const teamNormalRequestedRef = useRef<Set<string>>(new Set());
  const [saveList, setSaveList] = useState<{ path: string; name: string; modified: number; size: number }[]>([]);
  const [selectedSaveIdx, setSelectedSaveIdx] = useState(() => {
    const saved = localStorage.getItem("pnw_last_save_idx");
    return saved ? parseInt(saved, 10) : 0;
  });
  const selectedSaveIdxRef = useRef(parseInt(localStorage.getItem("pnw_last_save_idx") || "0", 10));
  const [openSaveMenu, setOpenSaveMenu] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  const pollingRef = useRef<number | null>(null);
  /** Dernières implémentations pour interval / visibility (évite check/loadProfile figés au 1er rendu). */
  const checkRef = useRef(check);
  const loadProfileRef = useRef(loadProfile);
  const initialCheckDone = useRef(false);
  const autoUpdateStarted = useRef(false);
  /** Empêche processInstallStatus de déclencher un auto-update pendant un switch de langue. */
  const langSwitchInProgress = useRef(false);
  const [langSwitching, setLangSwitching] = useState(false);
  /** Évite de re-scanner les version-hints tant que l’utilisateur n’a pas choisi la langue installée. */
  const awaitingMigrationChoiceRef = useRef(false);

  const { theme, bgUrl, setBgPublic } = useTheme();
  const { pfpUrl } = usePfp();

  const uiLang = uiLangFromGameLang(gameLang);
  const ui = getLauncherUi(uiLang);
  /** Piste EN utilisable : serveur OK **ou** installation déjà présente dans le dossier EN mémorisé. */
  const canUseEnglishTrack = enTrack === "ok" || hasLocalEnInstall;

  const probeEnglishTrack = useCallback(async () => {
    setEnTrack("loading");
    try {
      const m = await invoke<Manifest>("cmd_fetch_manifest", {
        manifestUrl: `${MANIFEST_BASE}?lang=en`,
      });
      const url = getZipUrl(m);
      if (!url) {
        setEnTrack("unavailable");
        return;
      }
      let len: number | null = null;
      try {
        len = await invoke<number | null>("cmd_http_head_content_length", { url });
      } catch {
        len = null;
      }
      if (len != null && len < MIN_EN_ARCHIVE_BYTES) {
        setEnTrack("unavailable");
        return;
      }
      setEnTrack("ok");
    } catch {
      setEnTrack("unavailable");
    }
  }, []);

  const probeEnglishTrackRef = useRef(probeEnglishTrack);

  useEffect(() => {
    void probeEnglishTrack();
  }, [probeEnglishTrack]);

  /* ====== Events de téléchargement ====== */
  useEffect(() => {
    const un1 = listen<DlEvent>("pnw://progress", (e) => {
      const p = e.payload;
      if (p.stage === "reconnect") {
        setStatus("reconnecting");
        return;
      }
      if (p.stage === "paused") {
        setStatus("paused");
        return;
      }
      if (p.stage === "canceled") {
        setStatus("ready");
        setProgress(0);
        setDownloadedBytes(0);
        setTotalBytes(0);
        setEta("—");
        setSpeed("—/s");
        autoUpdateStarted.current = false;
        setShowGameUpdateDialog(false);
        setLog((l) => prependUnique(l, ui.log.downloadCanceled));
        void logToFile("INFO", "Game update canceled");
        return;
      }
      if (p.stage === "done") {
        setStatus("done");
        setProgress(100);
        setEta("0:00");
        setLog((l) => prependUnique(l, ui.log.installComplete));
        setShowUpdateNotice(false);
        setShowGameUpdateDialog(false);
        autoUpdateStarted.current = false;
        void logToFile("INFO", "Game update completed successfully");

        setTimeout(async () => {
          const info = await readInstallInfo();
          setHasExe(info.hasExe);
          setHasVersion(info.hasVersion);
          setInstalledVersion(info.version);
          try {
            await fetchManifest({ lang: effectiveLangForInfo(info) });
          } catch {
            /* réseau : badges peuvent rester un instant périmés */
          }
          setStatus("ready");
          await loadProfileRef.current();
          void probeEnglishTrackRef.current();
        }, 200);
        return;
      }
      if (p.stage === "download") {
        setStatus("downloading");
        const tot = p.total || 0,
          dl = p.downloaded || 0;
        setProgress(tot ? (dl / tot) * 100 : 0);
        setDownloadedBytes(dl);
        setTotalBytes(tot);
        setEta(fmtTime(p.eta_secs ?? null));
        setSpeed(p.speed_bps ? `${fmtBytes(p.speed_bps)}/s` : "—/s");
        return;
      }
      if (p.stage === "extract") {
        setStatus("extracting");
        const tot = p.total || 0;
        const ext = p.extracted || 0;
        setProgress(tot ? (ext / tot) * 100 : 0);
        setEta("—");
        setSpeed("—");
        return;
      }
    });
    const un2 = listen<any>("pnw://error", (e) => {
      setStatus("error");
      const msg = formatErrorForUser(e.payload?.error, uiLang);
      setLog((l) => prependUnique(l, `❌ ${msg}`));
      void logToFile("ERROR", `Game update error: ${e.payload?.error ?? "(unknown)"}`);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [manifest, uiLang]);

  /* Le téléchargement/installation est géré par tauri-plugin-updater via downloadAndInstall() */

  /* ====== Backend helpers ====== */
  async function fetchManifest(opts?: { lang?: "fr" | "en" }): Promise<Manifest | null> {
    const L: "fr" | "en" =
      opts?.lang ?? (gameLang === "fr" || gameLang === "en" ? gameLang : "fr");
    const url = `${MANIFEST_BASE}?lang=${L}`;
    try {
      const m = await invoke<Manifest>("cmd_fetch_manifest", { manifestUrl: url });
      setManifest(m);
      // Mettre à jour le background depuis le manifest SAUF si l'utilisateur a choisi un fichier local
      // (kind === "file" = fichier personnalisé choisi par l'utilisateur)
      if (m?.launcherBackgroundUrl && theme.bg.kind !== "file") {
        setBgPublic(m.launcherBackgroundUrl);
      }
      setIsOffline(false);
      return m;
    } catch (err: any) {
      const str = String(err ?? "");
      if (!navigator.onLine || /connection|fetch|network|refused|timed out|timeout/i.test(str)) {
        setIsOffline(true);
      }
      throw err;
    }
  }
  
  async function readInstallInfo() {
    const info = await invoke<{
      installDir: string;
      hasExe: boolean;
      hasVersion: boolean;
      version: string | null;
      hasGame?: boolean;
      hasIntegrity?: boolean;
      missingFiles?: number;
      hasManifest?: boolean;
      gameLang?: string | null;
      hasLocalEnInstall?: boolean;
      hasLocalFrInstall?: boolean;
    }>("cmd_get_install_info", {});
    const localEn = !!info.hasLocalEnInstall;
    hasLocalEnInstallRef.current = localEn;
    setHasLocalEnInstall(localEn);
    const localFr = !!info.hasLocalFrInstall;
    hasLocalFrInstallRef.current = localFr;
    setHasLocalFrInstall(localFr);
    setInstallDir(info.installDir);
    setHasExe(info.hasExe);
    setHasVersion(info.hasVersion);
    setInstalledVersion(info.version);
    const gl = info.gameLang;
    if (gl === "fr" || gl === "en") {
      setGameLang(gl);
    } else {
      setGameLang(null);
    }
    return info;
  }

  function effectiveLangForInfo(info: { gameLang?: string | null }): "fr" | "en" {
    if (info.gameLang === "fr" || info.gameLang === "en") return info.gameLang;
    if (gameLang === "fr" || gameLang === "en") return gameLang;
    return "fr";
  }

  /** Migration : anciens installs sans game_lang. Retourne si le flux doit s’arrêter (dialogue ouvert). */
  async function tryResolveMigration(localV: string, info: { gameLang?: string | null }): Promise<boolean> {
    if (info.gameLang === "fr" || info.gameLang === "en") return false;
    if (awaitingMigrationChoiceRef.current) return true;
    try {
      const r = await fetch(`${PNW_SITE_BASE}/api/downloads/version-hints`);
      if (!r.ok) throw new Error(String(r.status));
      const hints = await r.json();
      const vFr = hints.fr?.version as string | undefined;
      const vEn = hints.en?.version as string | undefined;
      const frEq = !!(vFr && cmpSemver(localV, vFr) === 0);
      const enEq = !!(vEn && cmpSemver(localV, vEn) === 0);
      if (frEq && !enEq) {
        await invoke("cmd_set_game_lang", { lang: "fr" });
        setGameLang("fr");
        awaitingMigrationChoiceRef.current = false;
        return false;
      }
      if (enEq && !frEq) {
        await invoke("cmd_set_game_lang", { lang: "en" });
        setGameLang("en");
        awaitingMigrationChoiceRef.current = false;
        return false;
      }
      awaitingMigrationChoiceRef.current = true;
      setShowMigrationLangDialog(true);
      return true;
    } catch {
      awaitingMigrationChoiceRef.current = true;
      setShowMigrationLangDialog(true);
      return true;
    }
  }

  async function confirmMigrationLang(lang: "fr" | "en") {
    try {
      if (lang === "en" && enTrack !== "ok" && hasLocalEnInstallRef.current) {
        await invoke("cmd_set_game_lang", { lang });
        setGameLang("en");
        setShowMigrationLangDialog(false);
        awaitingMigrationChoiceRef.current = false;
        autoUpdateStarted.current = false;
        setLog((l) => prependUnique(l, ui.log.enLocalSwitch));
        await readInstallInfo();
        await resyncInstallUi();
        return;
      }
      await fetchManifest({ lang });
      await invoke("cmd_set_game_lang", { lang });
      setShowMigrationLangDialog(false);
      awaitingMigrationChoiceRef.current = false;
      autoUpdateStarted.current = false;
      await resyncInstallUi();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
    }
    // Toujours réaligner chemin + profil (même si resync réseau a échoué après changement de config).
    try {
      await readInstallInfo();
      await loadProfile(0);
    } catch {
      /* ignore */
    }
  }

  async function applyGameLangChange(lang: "fr" | "en") {
    let manifestOk = false;
    // Bloquer l'auto-update et masquer l'UI de version pendant le switch
    langSwitchInProgress.current = true;
    setLangSwitching(true);
    setShowUpdateNotice(false);
    autoUpdateStarted.current = false;
    try {
      try {
        await fetchManifest({ lang });
        manifestOk = true;
      } catch (e) {
        if (lang === "en" && hasLocalEnInstallRef.current) {
          setLog((l) => prependUnique(l, ui.log.enLocalSwitch));
        } else {
          // Le manifest a échoué, mais on applique quand même cmd_set_game_lang
          // pour que la config (install_dir, slots) reste cohérente.
          setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
        }
      }
      await invoke("cmd_set_game_lang", { lang });
      setShowLangSwitchConfirm(false);
      setPendingLang(null);
      autoUpdateStarted.current = false;
      if (manifestOk) {
        await resyncInstallUi();
      } else {
        // Pas de manifest → au moins relire l'état disque pour aligner l'UI.
        await readInstallInfo();
      }
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
    }
    // Recharger le profil depuis le dossier actif (FR/EN), même si fetchManifest/resync a planté après set_game_lang.
    try {
      await readInstallInfo();
      await loadProfile(0);
    } catch {
      /* ignore */
    }
    langSwitchInProgress.current = false;
    setLangSwitching(false);
  }

  /** Après changement de langue : nouvel emplacement (sans écraser l’installation précédente). */
  async function applyLangSwitchPickNewFolder(lang: "fr" | "en") {
    try {
      // Vérifier le manifest avant de modifier install_dir (évite dossier changé + langue inchangée si erreur réseau / 400).
      try {
        await fetchManifest({ lang });
      } catch (e: any) {
        setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
        return;
      }
      const dir = await open({
        title: ui.pickFolderDialog(lang),
        directory: true,
        multiple: false,
        defaultPath: installDir || "C:\\",
      });
      if (!dir) {
        setLog((l) => prependUnique(l, ui.log.folderPickCanceled));
        return;
      }
      const pathStr = installRootFromParentDirectory(String(dir), lang);
      // Mémoriser la piste cible (lang) : `game_lang` est encore l’ancienne tant qu’on n’a pas appelé `applyGameLangChange`.
      await invoke("cmd_set_install_dir", { path: pathStr, rememberForLang: lang });
      setInstallDir(pathStr);
      setLog((l) => prependUnique(l, ui.log.installDirUpdated(pathStr)));
      await applyGameLangChange(lang);
      const infoAfter = await readInstallInfo();
      if (!infoAfter.hasExe) {
        try {
          const m = await fetchManifest({ lang });
          if (m && getZipUrl(m)) {
            autoUpdateStarted.current = true;
            setShowUpdateNotice(true);
            setLog((l) => prependUnique(l, ui.log.autoUpdateStarted(m.version)));
            await startInstallOrUpdate(m);
          }
        } catch (e: any) {
          setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
        }
      }
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.folderError(String(e))}`));
    }
  }

  function requestGameLangChange(newLang: "fr" | "en") {
    if (newLang === gameLang) {
      void (async () => {
        await resyncInstallUi();
        await loadProfile(0);
      })();
      return;
    }
    // Déjà une install valide pour la langue cible (config install_dir_en / install_dir_fr) → bascule directe, sans modal.
    if (newLang === "en" && hasLocalEnInstall) {
      void applyGameLangChange("en");
      return;
    }
    if (newLang === "fr" && hasLocalFrInstall) {
      void applyGameLangChange("fr");
      return;
    }
    if (newLang === "en" && !canUseEnglishTrack) return;
    if (hasExe) {
      setPendingLang(newLang);
      setShowLangSwitchConfirm(true);
    } else {
      applyGameLangChange(newLang).catch((e) =>
        setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`)),
      );
    }
  }
  
  async function detectExistingGamePath(): Promise<string | null> {
    try {
      const detected: string | null = await invoke("cmd_detect_install_dir");
      if (detected && !looksLikeLauncherDir(detected)) return detected;
      return null;
    } catch {
      return null;
    }
  }
  
  async function startInstallOrUpdate(m: Manifest) {
    if (!getZipUrl(m)) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.manifestNoUrl}`));
      void logToFile("ERROR", `Game update aborted: manifest has no zip URL (v${m.version})`);
      return;
    }
    try {
      const check = await invoke<{ ok: boolean; message?: string }>("cmd_check_disk_space_for_update", {
        manifest: m,
      });
      if (!check.ok && check.message) {
        setStatus("ready");
        setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(check.message ?? "", uiLang)}`));
        autoUpdateStarted.current = false;
        setShowUpdateNotice(true);
        void logToFile("ERROR", `Disk space check failed: ${check.message}`);
        return;
      }
    } catch (e) {
      setStatus("ready");
      setLog((l) => prependUnique(l, `❌ ${ui.log.diskCheckFailed(String(e))}`));
      autoUpdateStarted.current = false;
      void logToFile("ERROR", `Disk space check threw: ${String(e)}`);
      return;
    }
    // Ouvre la fenêtre dédiée et logue le démarrage
    setShowGameUpdateDialog(true);
    void logToFile(
      "INFO",
      `Game update started: ${installedVersion ?? "?"} -> ${m.version}`,
    );
    setStatus("downloading");
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setEta("—");
    setSpeed("—/s");
    invoke("cmd_download_and_install", { manifest: m });
  }

  /* ====== Profil ====== */
  async function loadProfile(forceIdx?: number) {
    try {
      setProfileState("loading");
      const saves = await invoke<{ path: string; name: string; modified: number; size: number }[]>("cmd_list_saves");
      setSaveList(saves);
      if (!saves.length) {
        setProfile(null);
        setProfileState("none");
        return;
      }
      const rawIdx = forceIdx ?? selectedSaveIdxRef.current;
      const idx = Math.min(rawIdx, saves.length - 1);
      setSelectedSaveIdx(idx);
      localStorage.setItem("pnw_last_save_idx", String(idx));
      const blob = await invoke<{ path: string; modified: number; bytes_b64: string } | null>(
        "cmd_get_save_blob",
        { savePath: saves[idx].path },
      );
      if (!blob) {
        setProfile(null);
        setProfileState("none");
        return;
      }
      setLastSavePath(blob.path);
      const bytes = b64ToBytes(blob.bytes_b64);
      const p = parseSave(bytes);
      if (!p) {
        setProfile(null);
        setProfileState("error");
        setLog((l) => prependUnique(l, ui.log.profileParseFail));
        return;
      }
      setProfile(p);
      setProfileState("ready");
    } catch (e: any) {
      setProfile(null);
      setProfileState("error");
      setLog((l) => prependUnique(l, ui.log.profileError(String(e))));
    }
  }

  async function switchSave(idx: number) {
    setOpenSaveMenu(false);
    if (idx === selectedSaveIdx && profileState === "ready") return;
    setSelectedSaveIdx(idx);
    localStorage.setItem("pnw_last_save_idx", String(idx));
    await loadProfile(idx);
  }

  useEffect(() => {
    if (!openSaveMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setOpenSaveMenu(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openSaveMenu]);

  useEffect(() => {
    if (showLangSwitchConfirm) setOpenLangMenu(false);
  }, [showLangSwitchConfirm]);

  /* ====== Charger les noms d'espèces PSDK ====== */
  useEffect(() => {
    if (speciesNames != null) return;
    invoke<string>("cmd_psdk_french_species_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 100 && arr.every((x: unknown) => typeof x === "string")) {
            setSpeciesNames(arr as string[]);
          } else {
            setSpeciesNames([]);
          }
        } catch { setSpeciesNames([]); }
      })
      .catch(() => setSpeciesNames([]));
  }, [speciesNames]);

  /* ====== Charger les noms d'attaques PSDK ====== */
  useEffect(() => {
    if (skillNames != null) return;
    invoke<string>("cmd_psdk_french_skill_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 50 && arr.every((x: unknown) => typeof x === "string")) {
            setSkillNames(arr as string[]);
          } else {
            setSkillNames([]);
          }
        } catch { setSkillNames([]); }
      })
      .catch(() => setSkillNames([]));
  }, [skillNames]);

  /* ====== Charger les noms de talents PSDK ====== */
  useEffect(() => {
    if (abilityNames != null) return;
    invoke<string>("cmd_psdk_french_ability_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 50 && arr.every((x: unknown) => typeof x === "string")) {
            setAbilityNames(arr as string[]);
          } else {
            setAbilityNames([]);
          }
        } catch { setAbilityNames([]); }
      })
      .catch(() => setAbilityNames([]));
  }, [abilityNames]);

  /* ====== Ability names : game_state.json → localStorage ====== */
  useEffect(() => {
    try {
      const cached = localStorage.getItem("pnw_ability_names");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object") setLiveAbilityNames(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<any>("cmd_read_game_state").then((gs) => {
        if (cancelled || !gs?.party) return;
        const names: Record<string, string> = {};
        gs.party.forEach((pk: any) => {
          if (pk?.ability_name && pk?.species_id != null) {
            names[`${pk.species_id}_${pk.form ?? 0}`] = pk.ability_name;
          }
        });
        if (Object.keys(names).length > 0) {
          setLiveAbilityNames((prev: any) => {
            const merged = { ...prev, ...names };
            try { localStorage.setItem("pnw_ability_names", JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
      }).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  /* ====== Charger les noms d'objets PSDK ====== */
  useEffect(() => {
    if (itemNames != null) return;
    invoke<string>("cmd_psdk_french_item_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 50 && arr.every((x: unknown) => typeof x === "string")) {
            setItemNames(arr as string[]);
          } else {
            setItemNames([]);
          }
        } catch { setItemNames([]); }
      })
      .catch(() => setItemNames([]));
  }, [itemNames]);

  /* ====== Charger les sprites shiny pour l'équipe ====== */
  useEffect(() => {
    if (!profile?.team) return;
    if (import.meta.env.DEV) {
      for (const m of profile.team) {
        console.debug("[Team] Pokémon:", { code: m.code, form: m.form, isShiny: m.isShiny, isAltShiny: m.isAltShiny, ivHp: m.ivHp });
      }
    }
    const toFetch: { key: string; speciesId: number; form: number }[] = [];
    for (const m of profile.team) {
      if (!m.isShiny) continue;
      const speciesId =
        typeof m.code === "string" ? parseInt(m.code, 10) : Number(m.code);
      if (!Number.isFinite(speciesId) || speciesId <= 0) continue;
      const form = typeof m.form === "string" ? parseInt(m.form, 10) : (m.form ?? 0);
      const key = `${speciesId}_${form}`;
      if (teamShinyRequestedRef.current.has(key)) continue;
      toFetch.push({ key, speciesId, form });
    }
    if (toFetch.length === 0) {
      if (import.meta.env.DEV) console.debug("[Team] Aucun sprite shiny à charger");
      return;
    }
    /* Marquer comme demandés immédiatement (ref = synchrone, pas de re-render) */
    for (const { key } of toFetch) teamShinyRequestedRef.current.add(key);

    let cancelled = false;
    for (const { key, speciesId, form } of toFetch) {
      if (import.meta.env.DEV) console.debug("[Team] Fetching shiny sprite:", { key, speciesId, form });
      invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: form > 0 ? form : null })
        .then((dataUrl) => {
          if (cancelled) return;
          if (import.meta.env.DEV) console.debug("[Team] Shiny sprite result:", key, dataUrl ? `${dataUrl.slice(0, 40)}…` : null);
          setTeamShinySpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch((err) => {
          if (cancelled) return;
          if (import.meta.env.DEV) console.warn("[Team] Shiny sprite error:", key, err);
          setTeamShinySpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
    return () => {
      cancelled = true;
      /* StrictMode : nettoyer le ref pour que la 2e exécution puisse re-fetch */
      for (const { key } of toFetch) teamShinyRequestedRef.current.delete(key);
    };
  }, [profile?.team]);

  /* ====== Charger les sprites alt shiny pour l'équipe (loose files) ====== */
  useEffect(() => {
    if (!profile?.team) return;
    const toFetch: { key: string; speciesId: number; form: number }[] = [];
    for (const m of profile.team) {
      if (!m.isAltShiny) continue;
      const speciesId = typeof m.code === "string" ? parseInt(m.code, 10) : Number(m.code);
      if (!Number.isFinite(speciesId) || speciesId <= 0) continue;
      const form = typeof m.form === "string" ? parseInt(m.form, 10) : (m.form ?? 0);
      const key = `${speciesId}_${form}`;
      if (teamAltShinyRequestedRef.current.has(key)) continue;
      toFetch.push({ key, speciesId, form });
    }
    if (toFetch.length === 0) return;
    for (const { key } of toFetch) teamAltShinyRequestedRef.current.add(key);
    let cancelled = false;
    for (const { key, speciesId, form } of toFetch) {
      invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: form > 0 ? form : null })
        .then((dataUrl) => {
          if (cancelled) return;
          setTeamAltShinySpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch(() => {
          if (cancelled) return;
          setTeamAltShinySpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
    return () => {
      cancelled = true;
      for (const { key } of toFetch) teamAltShinyRequestedRef.current.delete(key);
    };
  }, [profile?.team]);

  /* ====== Charger les sprites normaux pour l'équipe (VD fallback) ====== */
  useEffect(() => {
    if (!profile?.team) return;
    const toFetch: { key: string; speciesId: number; form: number }[] = [];
    for (const m of profile.team) {
      const speciesId =
        typeof m.code === "string" ? parseInt(m.code, 10) : Number(m.code);
      if (!Number.isFinite(speciesId) || speciesId <= 0) continue;
      const form = typeof m.form === "string" ? parseInt(m.form, 10) : (m.form ?? 0);
      const key = `${speciesId}_${form}`;
      if (teamNormalRequestedRef.current.has(key)) continue;
      toFetch.push({ key, speciesId, form });
    }
    if (toFetch.length === 0) return;
    for (const { key } of toFetch) teamNormalRequestedRef.current.add(key);

    let cancelled = false;
    for (const { key, speciesId, form } of toFetch) {
      invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: form > 0 ? form : null })
        .then((dataUrl) => {
          if (cancelled) return;
          setTeamNormalSpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch(() => {
          if (cancelled) return;
          setTeamNormalSpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
    return () => {
      cancelled = true;
      for (const { key } of toFetch) teamNormalRequestedRef.current.delete(key);
    };
  }, [profile?.team]);

  /* ====== Discord Rich Presence : mettre à jour les détails (profil) quand dispo ====== */
  useEffect(() => {
    if (activeView !== "launcher" || profileState !== "ready" || !profile) return;
    const details = buildDiscordDetails(profile);
    invoke("cmd_discord_set_presence", {
      kind: "menu",
      startTimestampSecs: undefined,
      details: details ?? undefined,
    }).catch((e) => {
      console.warn("[PNW] Discord Rich Presence:", e);
    });
  }, [activeView, profileState, profile]);

  /* ====== Check principal amélioré avec choix initial ====== */
  async function check() {
    try {
      setStatus("checking");
      let info = await readInstallInfo();
      const installed = info.hasExe === true;

      // 1) Installé sans game_lang : migration ou dialogue
      if (installed && info.version && info.gameLang !== "fr" && info.gameLang !== "en") {
        const stopForMigration = await tryResolveMigration(info.version, info);
        if (stopForMigration) {
          setStatus("ready");
          return;
        }
        info = await readInstallInfo();
      }

      const langFetch = effectiveLangForInfo(info);
      let m: Manifest | null = null;
      try {
        m = await fetchManifest({ lang: langFetch });
      } catch (e: any) {
        const errStr = String(e ?? "");
        const networkError = !navigator.onLine || /connection|fetch|network|refused|timed out|timeout/i.test(errStr);
        const msg = formatErrorForUser(errStr, uiLang);
        setLog((l) => prependUnique(l, `❌ ${msg}`));
        if (/400|non configuré|anglais/i.test(errStr) && langFetch === "en") {
          setLog((l) =>
            prependUnique(
              l,
              ui.log.enBuildHint,
            ),
          );
        }
        if (networkError) {
          setIsOffline(true);
          setStatus("ready");
          if (installed) {
            setLog((l) => prependUnique(l, ui.log.offlineCanPlay));
          }
          return;
        }
        setStatus("error");
        return;
      }

      // 2) Dossier actuel absent/vide : chercher une autre langue installée ou afficher le welcome.
      const anyLangInstalled = installed || hasLocalEnInstallRef.current || hasLocalFrInstallRef.current;

      if (!installed && anyLangInstalled) {
        // Le dossier actuel n'a pas d'exe, mais l'autre langue en a un → auto-basculer.
        const curLang = info.gameLang;
        const otherLang: "fr" | "en" | null =
          curLang === "en" && hasLocalFrInstallRef.current ? "fr"
          : curLang === "fr" && hasLocalEnInstallRef.current ? "en"
          : !curLang && hasLocalFrInstallRef.current ? "fr"
          : !curLang && hasLocalEnInstallRef.current ? "en"
          : null;
        if (otherLang) {
          try {
            await invoke("cmd_set_game_lang", { lang: otherLang });
            setGameLang(otherLang);
            info = await readInstallInfo();
            setLog((l) => prependUnique(l, `ℹ️ ${otherLang === "fr" ? "Installation FR" : "Installation EN"} détectée, langue basculée automatiquement.`));
            // Relancer le manifest pour la nouvelle langue.
            try { m = await fetchManifest({ lang: otherLang }); } catch { /* on continue sans manifest */ }
            processInstallStatus(m, info, info.hasExe === true);
            void probeEnglishTrack();
            return;
          } catch {
            /* fallthrough vers le comportement par défaut */
          }
        }
      }

      if (!anyLangInstalled && !initialCheckDone.current) {
        // Aucune installation nulle part → bienvenue.
        setStatus("ready");
        setShowInitialChoice(true);
        initialCheckDone.current = true;
        void probeEnglishTrack();
        return;
      }

      processInstallStatus(m, info, installed);
      // Réévalue la piste EN quand le manifeste courant passe (réseau OK) — évite « English » grisé après un 1er échec au boot.
      void probeEnglishTrack();
    } catch (e: any) {
      setStatus("error");
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
    }
  }

  function processInstallStatus(m: Manifest | null, info: any, isInstalled: boolean) {
    const remoteV = m?.version ?? null;
    const localV = info.version;

    if (!isInstalled) {
      setStatus("ready");
      autoUpdateStarted.current = false;
      return;
    }

    const needUpdate = !!remoteV && (localV ? cmpSemver(localV, remoteV) < 0 : true);
    const localNewer = !!(localV && remoteV && cmpSemver(localV, remoteV) > 0);
    setStatus("ready");

    if (needUpdate && m) {
      setLog((l) =>
        prependUnique(l, ui.log.updateAvailable(localV ?? "?", remoteV ?? "?"))
      );
      const st = statusRef.current;
      if (!autoUpdateStarted.current && !langSwitchInProgress.current && st !== "downloading" && st !== "extracting") {
        autoUpdateStarted.current = true;
        setShowUpdateNotice(true);
        setLog((l) => prependUnique(l, ui.log.autoUpdateStarted(m.version)));
        startInstallOrUpdate(m);
      }
    } else if (localNewer) {
      autoUpdateStarted.current = false;
      setLog((l) =>
        prependUnique(l, ui.log.localNewerThanSite(localV ?? "?", remoteV ?? "?")),
      );
    } else {
      autoUpdateStarted.current = false;
      setLog((l) => prependUnique(l, ui.log.gameUpToDate(localV ?? "?")));
    }
  }

  /** Relit la config disque + manifeste pour aligner chemin, détection exe et badges (ex. après changement de langue ou annulation). */
  async function resyncInstallUi() {
    try {
      const info = await readInstallInfo();
      const L = effectiveLangForInfo(info);
      try {
        const m = await fetchManifest({ lang: L });
        processInstallStatus(m, info, info.hasExe === true);
      } catch (fe) {
        if (L === "en" && hasLocalEnInstallRef.current) {
          setStatus("ready");
          autoUpdateStarted.current = false;
        } else {
          throw fe;
        }
      }
      void probeEnglishTrack();
    } catch (e: any) {
      const errStr = String(e ?? "");
      const networkError =
        !navigator.onLine || /connection|fetch|network|refused|timed out|timeout/i.test(errStr);
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(errStr, uiLang)}`));
      if (networkError) setIsOffline(true);
    }
  }

  /* ====== Actions suite au choix initial ====== */
  /** Langue du build à télécharger — manifest d’abord, puis enregistrement (évite game_lang=en si le serveur renvoie 400). */
  async function handleWelcomePickLang(lang: "fr" | "en") {
    if (lang === "en" && !canUseEnglishTrack) return;
    try {
      if (lang === "en" && enTrack !== "ok" && hasLocalEnInstallRef.current) {
        await invoke("cmd_set_game_lang", { lang: "en" });
        setGameLang("en");
        setLog((l) => prependUnique(l, ui.log.enLocalSwitch));
        await readInstallInfo();
        await resyncInstallUi();
        await loadProfile(0);
        return;
      }
      const m = await fetchManifest({ lang });
      await invoke("cmd_set_game_lang", { lang });
      setGameLang(lang);
      if (m?.version) {
        setLog((l) =>
          prependUnique(
            l,
            ui.log.downloadPlanned(lang === "fr" ? ui.log.buildLangFr : ui.log.buildLangEn, m.version),
          ),
        );
      }
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
    }
  }

  async function handleFirstTimeUser() {
    try {
      setShowInitialChoice(false);
      setLog((l) => prependUnique(l, ui.log.newInstall));
      await invoke("cmd_set_default_install_dir");
      const info = await readInstallInfo();
      setInstallDir(info.installDir);
      const L: "fr" | "en" = info.gameLang === "fr" || info.gameLang === "en" ? info.gameLang : "fr";
      const m = await fetchManifest({ lang: L });
      if (m) startInstallOrUpdate(m);
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`));
    }
  }

  // ⚠️ Modifié : plus d’auto-scan ici. On ouvre directement l’explorateur pour choisir le DOSSIER du jeu.
  async function handleExistingUser() {
    try {
      setShowInitialChoice(false);
      const dir = await open({
        title: "Sélectionner le dossier de Pokémon New World",
        directory: true,
        multiple: false,
        defaultPath: installDir || "C:\\",
      });
      if (!dir) {
        setLog((l) => prependUnique(l, ui.log.selectionCanceled));
        return;
      }
      /* Dossier choisi = racine du jeu déjà installé (pas de sous-dossier imposé). */
      const pathStr = String(dir);
      await invoke("cmd_set_install_dir", { path: pathStr });
      setInstallDir(pathStr);
      setLog((l) => prependUnique(l, ui.log.gameFolderSet(pathStr)));

      const newInfo = await readInstallInfo();
      const L: "fr" | "en" =
        newInfo.gameLang === "fr" || newInfo.gameLang === "en" ? newInfo.gameLang : "fr";
      const m = await fetchManifest({ lang: L });
      if (m) processInstallStatus(m, newInfo, newInfo.hasExe === true);
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.selectionError(String(e))}`));
    }
  }

  /* ====== Actions utilisateur ====== */
  async function handleInstallConfirm() {
    setShowInstallPrompt(false);
    const info = await readInstallInfo();
    const L: "fr" | "en" = effectiveLangForInfo(info);
    const m = await fetchManifest({ lang: L });
    if (m) startInstallOrUpdate(m);
  }
  
  async function chooseFolder() {
    try {
      const dir = await open({
        title: "Choisir le dossier du jeu",
        directory: true,
        multiple: false,
        defaultPath: installDir || "C:\\",
      });
      if (!dir) {
        setLog((l) => prependUnique(l, ui.log.selectionCanceled));
        return;
      }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      setLog((l) => prependUnique(l, ui.log.folderSet(String(dir))));
      await check();
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.selectionError(String(e))}`));
    }
  }
  
  async function manualDetect() {
    try {
      setOpenFolderMenu(false);
      setScanText(ui.scan.manual);
      setScanning(true);
      const detected: string | null = await detectExistingGamePath();
      setScanning(false);
      if (!detected) {
        setLog((l) => prependUnique(l, ui.log.noGameFound));
        return;
      }
      await invoke("cmd_set_install_dir", { path: detected });
      setInstallDir(detected);
      setLog((l) => prependUnique(l, ui.log.gameDetected(detected)));
      await check();
      await loadProfile();
    } catch (e: any) {
      setScanning(false);
      setLog((l) => prependUnique(l, `❌ ${ui.log.detectFailed(String(e))}`));
    }
  }
  
  async function insertSave() {
    try {
      setOpenFolderMenu(false);
      const file = await open({
        title: "Sélectionner un fichier de sauvegarde",
        multiple: false,
        filters: [{ name: "Tous les fichiers", extensions: ["*"] }],
      });
      if (!file) return;
      const dest = await invoke<string>("cmd_insert_save", { sourcePath: String(file) });
      setLog((l) => prependUnique(l, ui.log.saveImported(dest)));
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.saveImportFailed(String(e))}`));
    }
  }

  async function launchGame() {
    try {
      await invoke("cmd_launch_game", {
        exeName: "Pokémon New World.exe",
      });
      setLog((l) => prependUnique(l, ui.log.launchGame));
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ ${ui.log.launchFailed(String(e))}`));
    }
  }

  const pause = () => {
    void invoke("cmd_pause_download");
    void logToFile("INFO", "Game update paused by user");
  };
  const resume = () => {
    void invoke("cmd_resume_download");
    void logToFile("INFO", "Game update resumed by user");
  };
  const cancel = () => {
    void invoke("cmd_cancel_download");
    setShowUpdateNotice(false);
    setShowGameUpdateDialog(false);
  };

  /* ====== Détection connexion (online/offline) ====== */
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  /* Version du launcher (alignée sur Cargo / tauri.conf). */
  useEffect(() => {
    void (async () => {
      try {
        const v = await getVersion();
        setLauncherVersion(v);
      } catch {
        /* navigateur / dev sans shell Tauri */
      }
    })();
  }, []);

  /* ====== Initialisation ====== */
  useEffect(() => {
    void checkRef.current();
    void loadProfileRef.current();

    pollingRef.current = window.setInterval(() => {
      const s = statusRef.current;
      if (s !== "downloading" && s !== "extracting") {
        void probeEnglishTrackRef.current();
        void checkRef.current();
        void loadProfileRef.current();
      }
    }, 5 * 60 * 1000);

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const s = statusRef.current;
      if (s !== "downloading" && s !== "extracting") {
        void probeEnglishTrackRef.current();
        void checkRef.current();
        void loadProfileRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* ── Vérification de mise à jour du launcher via tauri-plugin-updater ── */
  useEffect(() => {
    if (status !== "ready") return;
    if (showInitialChoice) return;
    if (autoUpdateStarted.current) return;
    if (launcherSelfUpdateCheckedRef.current) return;
    if (!navigator.onLine) return;
    void (async () => {
      if (launcherSelfUpdateCheckedRef.current) return;
      launcherSelfUpdateCheckedRef.current = true;
      try {
        const cv = await getVersion();
        const update = await checkUpdater();
        console.debug("[LauncherSelfUpdate] plugin check:", update);
        if (!update?.available) {
          console.debug("[LauncherSelfUpdate] no update available");
          return;
        }
        const rv = update.version ?? "";
        launcherUpdateRef.current = update;
        setLauncherSelfUpdatePayload({
          currentVersion: cv.trim(),
          remoteVersion: rv,
        });
        setShowLauncherSelfUpdate(true);
        const uiSnap = getLauncherUi(uiLangFromGameLang(gameLang));
        setLog((l) => prependUnique(l, uiSnap.log.launcherUpdateAvailable(cv, rv)));
      } catch (err) {
        console.error("[LauncherSelfUpdate] check failed:", err);
      }
    })();
  }, [status, gameLang, showInitialChoice]);

  /* ── Récupère les patch notes quand la fenêtre de mise à jour du jeu s'ouvre ── */
  useEffect(() => {
    if (!showGameUpdateDialog) return;
    const ac = new AbortController();
    setGameUpdatePatchNotesLoading(true);
    setGameUpdatePatchNotesError(null);
    setGameUpdatePatchNotes(null);
    void (async () => {
      try {
        const lang: "fr" | "en" = gameLang === "en" ? "en" : "fr";
        const data = await fetchPatchNotes(PNW_SITE_URL, lang, ac.signal);
        const target = manifest?.version ? String(manifest.version).trim() : "";
        const found = findVersionNotes(data, target);
        if (!ac.signal.aborted) setGameUpdatePatchNotes(found);
      } catch (e: any) {
        if (ac.signal.aborted) return;
        const msg = formatErrorForUser(String(e), uiLang);
        setGameUpdatePatchNotesError(msg);
        void logToFile("WARN", `Patch notes fetch failed: ${String(e)}`);
      } finally {
        if (!ac.signal.aborted) setGameUpdatePatchNotesLoading(false);
      }
    })();
    return () => ac.abort();
  }, [showGameUpdateDialog, manifest?.version, gameLang, uiLang]);

  statusRef.current = status;
  checkRef.current = check;
  loadProfileRef.current = loadProfile;
  selectedSaveIdxRef.current = selectedSaveIdx;
  probeEnglishTrackRef.current = probeEnglishTrack;

  const isInstalled = hasExe;
  const remoteSemver = manifest?.version ? String(manifest.version).trim() : "";
  const cmpInstalledVsRemote =
    isInstalled && installedVersion && remoteSemver
      ? cmpSemver(installedVersion, remoteSemver)
      : null;

  const needUpdate =
    isInstalled && !!manifest
      ? installedVersion
        ? remoteSemver
          ? cmpInstalledVsRemote !== null && cmpInstalledVsRemote < 0
          : true
        : true
      : false;

  /** Installation locale plus récente que la version du manifest (ex. admin a rétrogradé gameVersion). */
  const localNewerThanRemote =
    isInstalled &&
    !!manifest &&
    !!installedVersion &&
    !!remoteSemver &&
    cmpInstalledVsRemote !== null &&
    cmpInstalledVsRemote > 0;

  /**
   * Télécharge et installe le ZIP du manifeste courant (même piste langue que la config).
   * @param forceReinstall Si true, efface l’ETag disque pour éviter le court-circuit « déjà téléchargé »
   *   (cas version locale > version site : on veut bien retélécharger le .zip publié).
   */
  const runInstallFromManifest = async (opts?: { forceReinstall?: boolean }) => {
    setShowUpdateNotice(true);
    if (opts?.forceReinstall) {
      await invoke("cmd_clear_install_etag");
    }
    const info = await readInstallInfo();
    const m = await fetchManifest({ lang: effectiveLangForInfo(info) });
    if (m) startInstallOrUpdate(m);
  };

  // Bouton principal
  const getMainButton = () => {
    if (langSwitching) return null;
    if (status === "downloading" || status === "extracting" || status === "reconnecting") {
      return null;
    }
    if (!isInstalled) {
      return (
        <IconButton
          icon={<FaDownload />}
          label={ui.installGame}
          tone="primary"
          onClick={handleInstallConfirm}
        />
      );
    }
    if (needUpdate) {
      return (
        <IconButton
          icon={<FaDownload />}
          label={ui.updateGame}
          tone="primary"
          onClick={() => void runInstallFromManifest()}
        />
      );
    }
    if (localNewerThanRemote) {
      return (
        <>
          <IconButton tone="success" icon={<FaPlay />} label={ui.play} onClick={launchGame} />
          <IconButton
            icon={<FaDownload />}
            label={ui.installPublishedVersion}
            tone="primary"
            onClick={() => void runInstallFromManifest({ forceReinstall: true })}
          />
        </>
      );
    }
    return <IconButton tone="success" icon={<FaPlay />} label={ui.play} onClick={launchGame} />;
  };

  const siteUrl = PNW_SITE_URL;

  function renderView() {
    switch (activeView) {
      case "lore": return <LoreView siteUrl={siteUrl} />;
      case "guide": return <GuideView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} onNavigateBoss={() => setActiveView("boss")} />;
      case "boss": return <BossView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "patchnotes": return <PatchNotesView siteUrl={siteUrl} />;
      case "pokedex": return <PokedexView siteUrl={siteUrl} profile={profile} />;
      case "items": return <ItemLocationView siteUrl={siteUrl} />;
      case "evs": return <EVsLocationView siteUrl={siteUrl} />;
      case "bst": return <BSTView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "nerfs": return <NerfsAndBuffsView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "team": return <TeamView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "contact": return <ContactView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "gts": return <GTSView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} profile={profile} savePath={lastSavePath} onProfileReload={() => loadProfile(selectedSaveIdx)} onShareToChat={(data) => { setGtsSharePending(data); setChatOpen(true); }} pendingOnlineId={gtsPendingOnlineId} onPendingOnlineIdConsumed={() => setGtsPendingOnlineId(null)} chatProfile={chatProfile} onWishlistMatchCount={setGtsWishlistMatches} />;
      default: return null;
    }
  }

  return (
    <div className="h-screen relative flex flex-col overflow-hidden">
      {/* Custom Titlebar */}
      <Titlebar version={launcherVersion} />

      <div className="flex-1 relative flex overflow-hidden">
      {/* Fond dynamique */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          zIndex: -1,
          filter: "saturate(1.05) brightness(0.9)",
        }}
      />

      {/* Sidebar */}
      <Sidebar
        siteUrl={siteUrl}
        activeView={activeView}
        onNavigate={(v) => setActiveView(v as ViewName)}
        sidebarImageUrl={manifest?.launcherSidebarImageUrl}
        homeNavLabel={ui.sidebar.navHome}
        openMenuAria={ui.sidebar.openMenu}
        closeMenuAria={ui.sidebar.closeMenu}
        contactLabel={ui.sidebar.contact}
      />

      {/* Overlay de scan */}
      {scanning && (
        <div 
          className="boot-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]" 
          aria-hidden="true"
          style={{ pointerEvents: "all" }}
        >
          <div className="boot-chip absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" role="status" aria-live="polite">
            <div className="boot-runway">
              <img
                src="https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUycGRoMXlpZDBycDlmZXVpYjhsZDQyOXh0OXM5a2UyN2o5NDVtNDc5NiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/kuWN0iF9BLQKk/giphy.gif"
                alt=""
              />
            </div>
            <div className="boot-label">
              <span>{scanText || ui.scan.default}</span>
              <span className="boot-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Contenu principal */}
      <main className="flex-1 overflow-y-auto h-screen">
        {activeView !== "launcher" ? (
          <div
            className={
              activeView === "lore" || activeView === "guide" || activeView === "nerfs" || activeView === "bst" || activeView === "team" || activeView === "contact" || activeView === "gts"
                ? "w-full max-w-none min-w-0 mx-0 p-0"
                : "max-w-[1050px] mx-auto p-6"
            }
          >
            {renderView()}
          </div>
        ) : (
      <div className="launcher-home space-y-6 animate-in">
        {/* Bannière mode hors-ligne */}
        {isOffline && (
          <div className="mx-4 mt-2 rounded-xl bg-amber-500/15 border border-amber-400/30 px-4 py-2.5 flex items-center gap-2 text-amber-200 text-sm">
            <span className="font-semibold">📴 {ui.offline.title}</span>
            <span>{ui.offline.hint}</span>
          </div>
        )}
        <header className="launcher-home-header">
          <div className="launcher-home-brand">
            <img
              src="/logo.png"
              alt="Pokémon New World Launcher"
              className="launcher-home-logo w-[72px] h-[72px] object-contain rounded-2xl ring-1 ring-white/15 bg-white/5 shadow-lg"
            />
          </div>
          <div className="launcher-home-actions">
            <LauncherMenu onOpenGts={() => setActiveView("gts")} onOpenBattle={() => setActiveView("battle")} uiLang={uiLang} gtsWishlistMatches={gtsWishlistMatches} />
            <ThemeMenu defaultBgUrl={manifest?.launcherBackgroundUrl} uiLang={uiLang} />
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaRotateRight />}
              label={ui.refresh}
              onClick={() => {
                autoUpdateStarted.current = false;
                void probeEnglishTrack();
                check();
                loadProfile();
              }}
            />
          </div>
        </header>

        <section className="hero p-6">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="relative flex-shrink-0 accent-glow-inner rounded-2xl p-0.5 bg-white/5">
              <img
                src="/logo.png"
                alt=""
                className="w-[72px] h-[72px] object-contain rounded-2xl"
              />
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="text-xs text-white/50 font-medium tracking-wider uppercase">{ui.installDir}</div>
              <div className="accent-glow-inner text-sm text-white/85 font-mono bg-white/5 rounded-lg px-3 py-1.5 truncate">
                {installDir || ui.notDefined}
              </div>

              <div className="flex items-center flex-wrap gap-2 pt-1" style={langSwitching ? { opacity: 0, pointerEvents: "none", transition: "none" } : undefined}>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 ${
                    !hasExe
                      ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/30"
                      : localNewerThanRemote
                        ? "bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/35"
                        : "accent-glow-badge"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      !hasExe ? "bg-red-400" : localNewerThanRemote ? "bg-amber-400" : "accent-glow-badge-dot"
                    }`}
                  />
                  {!hasExe
                    ? ui.statusNotInstalled
                    : needUpdate
                      ? ui.statusUpdateAvailable
                      : localNewerThanRemote
                        ? ui.statusLocalNewer
                        : ui.statusUpToDate}
                </span>

                {installedVersion && (
                  <span className="accent-glow-badge text-xs text-white/80 rounded-full px-2.5 py-1">
                    v{installedVersion}
                  </span>
                )}
                {remoteSemver && (needUpdate || localNewerThanRemote) && (
                  <span
                    className={`text-xs rounded-full px-2.5 py-1 ring-1 ${
                      localNewerThanRemote
                        ? "bg-amber-500/10 text-amber-200/95 ring-amber-400/25"
                        : "accent-glow-badge text-white/90"
                    }`}
                  >
                    {localNewerThanRemote ? "↘ " : "→ "}v{remoteSemver}
                  </span>
                )}

                <div className="inline-flex flex-wrap items-center gap-1.5 text-xs text-white/55">
                  <span className="whitespace-nowrap">{ui.gameLanguage}</span>
                  <div className="relative shrink-0" ref={langMenuAnchorRef}>
                    <button
                      type="button"
                      className="lang-menu-trigger"
                      disabled={showLangSwitchConfirm}
                      aria-expanded={openLangMenu}
                      aria-haspopup="listbox"
                      aria-label={ui.gameLanguage}
                      onClick={() => {
                        setOpenFolderMenu(false);
                        setOpenLangMenu((o) => !o);
                      }}
                    >
                      <FaLanguage className="text-[12px] text-sky-300/90 shrink-0" aria-hidden />
                      <span className="min-w-0 max-w-[7rem] truncate font-semibold text-white/92">
                        {gameLang === "en"
                          ? enTrack === "loading" && !hasLocalEnInstall
                            ? ui.enChecking
                            : "English"
                          : "Français"}
                      </span>
                      <FaChevronDown
                        className={`text-[9px] text-white/55 shrink-0 transition-transform duration-200 ${
                          openLangMenu ? "rotate-180" : ""
                        }`}
                        aria-hidden
                      />
                    </button>
                    {openLangMenu && (
                      <GameLanguageMenu
                        anchorRef={langMenuAnchorRef}
                        onClose={() => setOpenLangMenu(false)}
                        gameLang={gameLang}
                        canUseEnglishTrack={canUseEnglishTrack}
                        enTrack={enTrack}
                        hasLocalEnInstall={hasLocalEnInstall}
                        ui={ui}
                        disabled={showLangSwitchConfirm}
                        onPick={(lang) => requestGameLangChange(lang)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0">
              <div ref={folderBtnRef} className="relative">
                <IconButton
                  icon={<FaFolderOpen />}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {ui.folderMenu} <span className="text-white/60 text-[10px]">▾</span>
                    </span>
                  }
                  tone="ghost"
                  className="accent-glow-inner"
                  onClick={() => {
                    setOpenLangMenu(false);
                    setOpenFolderMenu((o) => !o);
                  }}
                />
                {openFolderMenu && createPortal(
                  <FolderDropdown
                    anchorRef={folderBtnRef}
                    onClose={() => setOpenFolderMenu(false)}
                    onChooseFolder={() => { setOpenFolderMenu(false); chooseFolder(); }}
                    onInsertSave={() => { setOpenFolderMenu(false); insertSave(); }}
                    chooseLabel={ui.folderChoose}
                    insertLabel={ui.folderInsertSave}
                  />,
                  document.body,
                )}
              </div>
              {getMainButton()}
            </div>
          </div>

          {(status === "downloading" ||
            status === "paused" ||
            status === "extracting" ||
            status === "reconnecting") && (
            <div className="mt-5 space-y-2.5 pt-4 border-t border-white/8">
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium text-white/90">
                  {status === "downloading" && ui.progress.downloading}
                  {status === "paused" && ui.progress.paused}
                  {status === "extracting" && `${ui.progress.extracting} ${Math.round(progress)}%`}
                  {status === "reconnecting" && ui.progress.reconnecting}
                </div>
                <div className="text-white/50 text-xs tabular-nums">
                  {status !== "extracting" && (
                    <>{eta} {ui.progress.remaining} • {speed}</>
                  )}
                </div>
              </div>
              <Progress value={progress} />
              <div className="flex gap-2 pt-1">
                {status !== "paused" && status !== "extracting" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPause />} label={ui.pause} onClick={pause} />
                )}
                {status === "paused" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPlay />} label={ui.resume} onClick={resume} />
                )}
                {(status === "downloading" || status === "paused" || status === "reconnecting") && (
                  <IconButton tone="ghost" size="sm" icon={<FaStop />} label={ui.cancel} onClick={cancel} />
                )}
              </div>
            </div>
          )}
        </section>

        <Card title={
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <FaUser className="section-header-icon text-[14px]" />
              {ui.profile.title}
            </span>
            {saveList.length > 1 && (
              <div ref={saveMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenSaveMenu((o) => !o)}
                  className="save-selector-trigger"
                  aria-expanded={openSaveMenu}
                  aria-haspopup="listbox"
                >
                  <FaFloppyDisk className="text-[11px] text-white/60 flex-shrink-0" />
                  <span className="min-w-0 truncate text-white/95">{saveList[selectedSaveIdx]?.name ?? "Save 1"}</span>
                  <FaChevronDown className={`text-[9px] text-white/55 flex-shrink-0 transition-transform duration-200 ${openSaveMenu ? "rotate-180" : ""}`} />
                </button>
                {openSaveMenu && (
                  <div className="save-selector-dropdown" role="listbox">
                    {saveList.map((s, i) => (
                      <button
                        key={s.path}
                        type="button"
                        role="option"
                        aria-selected={i === selectedSaveIdx}
                        onClick={() => switchSave(i)}
                        className={`save-selector-option ${i === selectedSaveIdx ? "save-selector-option--active" : ""}`}
                      >
                        <span className="save-selector-option-dot" />
                        <span>{s.name}</span>
                        {i === selectedSaveIdx && <FaCircleCheck className="save-selector-option-check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        }>
          {profileState === "loading" && (
            <div className="text-white/80 text-sm">{ui.profile.reading}</div>
          )}
          {profileState === "none" && (
            <div className="text-white/80 text-sm">
              {ui.profile.noSave}
            </div>
          )}
          {profileState === "error" && (
            <div className="text-white/80 text-sm">{ui.profile.readError}</div>
          )}
          {profileState === "ready" && profile && (
            <div className="flex flex-col gap-5">
              {/* En-tête joueur */}
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0 profile-avatar-wrap">
                  <div className="profile-avatar-inner">
                    <img
                      src={pfpUrl ?? playerSpriteUrl(profile)}
                      className="profile-avatar-img"
                      alt=""
                    />
                  </div>
                  <div className="absolute -inset-3 -z-10 rounded-3xl opacity-0 pointer-events-none" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-bold leading-tight truncate tracking-tight">
                    {profile.name ?? "—"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-white/8 px-2.5 py-1 ring-1 ring-white/10 text-white/75">
                      <FaIdCard className="section-header-icon text-[10px]" />
                      <span className="font-semibold text-white/90">
                        {profile.id != null ? profile.id.toString().padStart(5, "0") : "—"}
                      </span>
                    </span>
                  </div>
                  {(profile.pokedex?.seenIds?.length || profile.pokedex?.capturedIds?.length) ? (
                    <div className="profile-dex-progress">
                      <div className="profile-dex-bar">
                        <div className="profile-dex-stat profile-dex-stat--seen">
                          <FaEye size={12} />
                          <span className="profile-dex-stat-num">{profile.pokedex.seenIds?.length ?? 0}</span>
                          <span className="profile-dex-stat-label">{ui.profile.seen}</span>
                        </div>
                        <div className="profile-dex-divider" />
                        <div className="profile-dex-stat profile-dex-stat--caught">
                          <FaCircleCheck size={12} />
                          <span className="profile-dex-stat-num">{profile.pokedex.capturedIds?.length ?? 0}</span>
                          <span className="profile-dex-stat-label">{ui.profile.caught}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Grille de stats */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaCoins className="stat-tile-icon" /> {ui.profile.money}</div>
                  <div className="stat-tile-value">{profile.money != null ? `${profile.money.toLocaleString()}₽` : "—"}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaClock className="stat-tile-icon" /> {ui.profile.time}</div>
                  <div className="stat-tile-value stat-tile-value--time">
                    {profile.playTimeSec != null
                      ? formatPlayTime(profile.playTimeSec, uiLang)
                      : "—"}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaCalendarDays className="stat-tile-icon" /> {ui.profile.start}</div>
                  <div className="stat-tile-value">
                    {profile.startTime
                      ? new Date(
                          (profile.startTime > 1e11
                            ? profile.startTime
                            : (profile.startTime as number) * 1000) as number
                        ).toLocaleDateString(uiLang === "en" ? "en-US" : "fr-FR")
                      : "—"}
                  </div>
                </div>
              </div>

              {/* Équipe */}
              {profile.team?.length ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2.5 flex items-center gap-1.5">
                    <FaGamepad className="section-header-icon text-[11px]" /> {ui.profile.team}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 overflow-visible">
                    {profile.team.map((m, i) => {
                      const root =
                        lastSavePath ? rootFromSavePath(lastSavePath, installDir) : installDir;
                      const { list } = monIconCandidates(root, m);
                      /* Sprite shiny : si dispo dans le cache, on l'utilise à la place */
                      const speciesId = typeof m.code === "string" ? parseInt(String(m.code), 10) : (m.code ?? 0);
                      const formN = typeof m.form === "string" ? parseInt(String(m.form), 10) : (m.form ?? 0);
                      const shinyKey = `${speciesId}_${formN}`;
                      const altShinyUrl = m.isAltShiny ? teamAltShinySpriteCache[shinyKey] : null;
                      const shinyUrl = m.isShiny ? teamShinySpriteCache[shinyKey] : null;
                      const normalUrl = teamNormalSpriteCache[shinyKey] ?? null;
                      const spriteUrl = altShinyUrl || shinyUrl || normalUrl;
                      const hasIvs = m.ivHp != null;
                      const ivRows = hasIvs ? [
                        { Icon: FaHeart, label: "PS", v: m.ivHp!, fill: "team-iv-fill--hp" },
                        { Icon: FaHandFist, label: "Atk", v: m.ivAtk!, fill: "team-iv-fill--atk" },
                        { Icon: FaShield, label: "Déf", v: m.ivDfe!, fill: "team-iv-fill--def" },
                        { Icon: FaBolt, label: "Vit", v: m.ivSpd!, fill: "team-iv-fill--spe" },
                        { Icon: FaWandMagicSparkles, label: "Sp.A", v: m.ivAts!, fill: "team-iv-fill--spa" },
                        { Icon: FaShieldHalved, label: "Sp.D", v: m.ivDfs!, fill: "team-iv-fill--spd" },
                      ] : null;
                      const ivTotal = ivRows ? ivRows.reduce((s, r) => s + r.v, 0) : 0;
                      return (
                        <div
                          key={i}
                          className="team-mon-card group"
                        >
                          {m.isAltShiny && (
                            <FaStar className="team-mon-alt-shiny-star" title="Shiny Alt" />
                          )}
                          {m.isShiny && !m.isAltShiny && (
                            <FaStar className="team-mon-shiny-star" title="Shiny" />
                          )}
                          <div className="team-mon-sprite-wrap">
                            {spriteUrl ? (
                              <img src={spriteUrl} className="team-mon-sprite" alt="" />
                            ) : (
                              <img
                                src={list[0]}
                                data-srcs={list.slice(1).join("|")}
                                data-idx="0"
                                onError={(e) => {
                                  const im = e.currentTarget as HTMLImageElement;
                                  const rest = (im.getAttribute("data-srcs") || "")
                                    .split("|")
                                    .filter(Boolean);
                                  let idx = parseInt(im.getAttribute("data-idx") || "0", 10);
                                  if (idx < rest.length) {
                                    im.src = rest[idx];
                                    im.setAttribute("data-idx", String(idx + 1));
                                  }
                                }}
                                className="team-mon-sprite"
                                alt=""
                              />
                            )}
                          </div>
                          {(() => {
                            const species = speciesNames && speciesId > 0 ? speciesNames[speciesId] ?? null : null;
                            const displayName = m.nickname || species;
                            return displayName ? (
                              <div className="team-mon-name" title={displayName}>{displayName}</div>
                            ) : null;
                          })()}
                          <div className="team-mon-level">
                            {ui.profile.levelShort} {m.level ?? "—"}
                          </div>
                          {/* Overlay détails au hover */}
                          <div className="team-mon-iv-overlay">
                            {/* Sprite en grand */}
                            <div className="team-iv-sprite-wrap">
                              <img
                                src={spriteUrl || list[0]}
                                className="team-iv-sprite"
                                alt=""
                              />
                              {m.isAltShiny && <FaStar className="team-iv-alt-shiny-star" />}
                              {m.isShiny && !m.isAltShiny && <FaStar className="team-iv-shiny-star" />}
                            </div>
                            {(() => {
                              const species = speciesNames && speciesId > 0 ? speciesNames[speciesId] ?? null : null;
                              const label = m.nickname
                                ? (species ? `${m.nickname} (${species})` : m.nickname)
                                : species;
                              return label ? <div className="team-iv-nickname">{label}</div> : null;
                            })()}

                            {/* Chips : niveau, genre, nature */}
                            <div className="team-ov-chips">
                              <div className="team-ov-chip team-ov-chip--level">
                                <FaChartLine className="team-ov-chip-ico team-ov-chip-ico--level" aria-hidden />
                                <span className="team-ov-chip-val">{m.level ?? "—"}</span>
                              </div>
                              {m.gender != null && (
                                <div className={`team-ov-chip team-ov-chip--gender${m.gender}`}>
                                  {m.gender === 0 ? <FaMars className="team-ov-chip-ico team-ov-chip-ico--male" /> :
                                   m.gender === 1 ? <FaVenus className="team-ov-chip-ico team-ov-chip-ico--female" /> :
                                   <FaVenusMars className="team-ov-chip-ico team-ov-chip-ico--neutral" />}
                                  <span className="team-ov-chip-val">
                                    {m.gender === 0 ? "♂" : m.gender === 1 ? "♀" : "—"}
                                  </span>
                                </div>
                              )}
                              {m.nature != null && (
                                <div className="team-ov-chip team-ov-chip--nature">
                                  <FaLeaf className="team-ov-chip-ico team-ov-chip-ico--nature" aria-hidden />
                                  <span className="team-ov-chip-val">{NATURE_FR[m.nature] ?? `#${m.nature}`}</span>
                                </div>
                              )}
                            </div>

                            {/* Détails : ability, objet, EXP */}
                            <div className="team-ov-details">
                              <div className="team-ov-detail">
                                <FaWandMagicSparkles className="team-ov-detail-ico team-ov-detail-ico--ability" aria-hidden />
                                <span className="team-ov-detail-label">Talent</span>
                                <span className="team-ov-detail-val">
                                  {(() => {
                                    const speciesId = typeof m.code === "string" ? parseInt(String(m.code), 10) : (m.code ?? 0);
                                    const formN = typeof m.form === "string" ? parseInt(String(m.form), 10) : (m.form ?? 0);
                                    return liveAbilityNames[`${speciesId}_${formN}`] || "—";
                                  })()}
                                </span>
                              </div>
                              <div className="team-ov-detail">
                                <FaBagShopping className="team-ov-detail-ico team-ov-detail-ico--item" aria-hidden />
                                <span className="team-ov-detail-label">Objet</span>
                                <span className="team-ov-detail-val">
                                  {m.itemHolding != null && m.itemHolding > 0
                                    ? (itemNames && itemNames[m.itemHolding] ? itemNames[m.itemHolding] : `#${m.itemHolding}`)
                                    : "Aucun"}
                                </span>
                              </div>
                              {m.exp != null && m.exp > 0 && (
                                <div className="team-ov-detail">
                                  <FaChartLine className="team-ov-detail-ico team-ov-detail-ico--exp" aria-hidden />
                                  <span className="team-ov-detail-label">EXP</span>
                                  <span className="team-ov-detail-val">{m.exp.toLocaleString("fr-FR")}</span>
                                </div>
                              )}
                            </div>

                            {/* Attaques */}
                            {m.moves && m.moves.length > 0 && (
                              <div className="team-ov-moves">
                                <div className="team-ov-moves-head">
                                  <FaLayerGroup className="team-ov-moves-ico" aria-hidden />
                                  <span>Attaques</span>
                                </div>
                                <div className="team-ov-moves-list">
                                  {m.moves.map((id, mi) => {
                                    const name = skillNames && skillNames[id] ? skillNames[id] : `#${id}`;
                                    return (
                                      <span key={`${id}-${mi}`} className="team-ov-move-chip">{name}</span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Barres IV */}
                            {ivRows && (
                              <>
                                <div className="team-iv-head">
                                  <FaChartPie className="team-iv-head-ico" aria-hidden />
                                  <span className="team-iv-head-title">IV</span>
                                  <span className="team-iv-total">
                                    <FaDna className="team-iv-total-ico" aria-hidden />
                                    Σ {ivTotal}<span className="team-iv-total-max">/186</span>
                                  </span>
                                </div>
                                <div className="team-iv-rows">
                                  {ivRows.map(({ Icon, label, v, fill }) => (
                                    <div key={label} className="team-iv-row">
                                      <div className="team-iv-meta">
                                        <Icon className="team-iv-stat-ico" aria-hidden />
                                        <span className="team-iv-lab">{label}</span>
                                      </div>
                                      <div className="team-iv-bar-track" aria-hidden>
                                        <div
                                          className={`team-iv-bar-fill ${fill}`}
                                          style={{ width: `${Math.min(100, (v / 31) * 100)}%` }}
                                        />
                                      </div>
                                      <span className="team-iv-val">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Boss (badges) — juste en-dessous de l'équipe */}
              <div className="boss-section mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3 flex items-center gap-2">
                  <FaCrown className="section-header-icon text-[12px]" />
                  {ui.profile.boss}
                </div>
                <div className="boss-badges-row">
                  {[1, 2, 3, 4, 5].map((n) => {
                    // badgesList[n-1] = true si boss n vaincu (tableau 0-indexed)
                    const obtained = profile.badgesList
                      ? profile.badgesList[n - 1] === true
                      : (profile.badges ?? 0) >= n;
                    const root = lastSavePath ? rootFromSavePath(lastSavePath, installDir) : installDir;
                    const bossIconPath = obtained
                      ? toFileUrl(join(root, "graphics", "interface", `boss_icon_${n}.png`))
                      : toFileUrl(join(root, "graphics", "interface", "boss_unknown.png"));
                    return (
                      <div
                        key={n}
                        className={`boss-badge ${obtained ? "boss-badge--obtained" : ""}`}
                        title={obtained ? ui.profile.bossBeat(n) : ui.profile.bossUnknown(n)}
                      >
                        <BossBadgeIcon src={bossIconPath} alt={`Boss ${n}`} />
                        <span className="boss-badge-label">{ui.profile.boss} {n}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>

        <div className="journal-layer">
          <Card title={ui.journal.title}>
            <div className="text-sm space-y-0.5 max-h-52 overflow-auto pnw-scrollbar pr-1">
              {log.length === 0 ? (
                <div className="text-white/40 text-xs italic py-2">{ui.journal.empty}</div>
              ) : (
                log.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1.5 text-white/75 text-[13px] leading-snug border-b border-white/[0.04] last:border-0"
                  >
                    <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full accent-glow-badge-dot opacity-80" />
                    <span>{l}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {launcherVersion && (
          <div className="text-center text-white/25 text-[11px] py-3 select-none">
            PNW Launcher v{launcherVersion}
          </div>
        )}
      </div>
        )}

        {/* Migration : installation existante sans game_lang en config */}
        <Modal
          open={showMigrationLangDialog}
          title={ui.migration.title}
          hideActions
          onCancel={undefined}
        >
          <div className="text-white/85 text-sm space-y-4">
            <p>
              {ui.migration.body}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                type="button"
                onClick={() => void confirmMigrationLang("fr")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 ring-1 ring-white/20 transition-all"
              >
                <span className="font-semibold">Français</span>
              </button>
              <button
                type="button"
                disabled={!canUseEnglishTrack}
                title={!canUseEnglishTrack ? ui.migration.enUnavailable : undefined}
                onClick={() => void confirmMigrationLang("en")}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl ring-1 ring-white/20 transition-all ${
                  !canUseEnglishTrack
                    ? "opacity-40 cursor-not-allowed grayscale bg-white/5"
                    : "bg-gradient-to-br from-cyan-500/20 to-teal-500/20 hover:from-cyan-500/30 hover:to-teal-500/30"
                }`}
              >
                <span className="font-semibold">English</span>
                {!canUseEnglishTrack && (
                  <span className="text-[10px] opacity-80">{ui.migration.enUnavailableBadge}</span>
                )}
              </button>
            </div>
          </div>
        </Modal>

        {/* Confirmation changement de langue (jeu déjà installé) */}
        <Modal
          open={showLangSwitchConfirm}
          title={
            <span className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                aria-hidden
              >
                <FaLanguage className="text-xl text-sky-300" />
              </span>
              <span className="leading-tight">{ui.langSwitch.title}</span>
            </span>
          }
          hideActions
          onCancel={() => {
            setShowLangSwitchConfirm(false);
            setPendingLang(null);
            void resyncInstallUi();
          }}
        >
          <div className="text-white/85 text-sm space-y-4">
            <div className="rounded-xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] px-4 py-3.5 ring-1 ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[13px] leading-relaxed">
                {ui.langSwitch.nextArchiveBefore}{" "}
                <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200/95 ring-1 ring-amber-400/25">
                  {pendingLang === "en"
                    ? ui.langSwitch.archiveEn
                    : pendingLang === "fr"
                      ? ui.langSwitch.archiveFr
                      : ui.langSwitch.archiveUnknown}
                </span>
                {ui.langSwitch.nextArchiveAfter}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex gap-3">
                <FaArrowsRotate className="mt-0.5 h-4 w-4 shrink-0 text-blue-400/85" aria-hidden />
                <div className="min-w-0 space-y-2">
                  <p className="text-white/78 leading-relaxed">
                    {ui.langSwitch.replaceLead}
                  </p>
                  <div className="rounded-lg bg-black/35 px-3 py-2.5 font-mono text-[11px] leading-snug text-white/82 ring-1 ring-white/12 break-all">
                    {installDir || "—"}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 border-t border-white/10 pt-3">
                <FaFolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80" aria-hidden />
                <p className="text-white/75 leading-relaxed">
                  {ui.langSwitch.otherFolderLead}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                className="group w-full rounded-xl px-4 py-3.5 text-left ring-1 ring-white/15 bg-gradient-to-br from-blue-500/25 to-indigo-600/20 hover:from-blue-500/35 hover:to-indigo-600/30 hover:ring-amber-400/30 hover:shadow-[0_0_24px_-8px_rgba(59,130,246,0.45)] transition-all duration-200 text-white font-medium flex items-center gap-3 active:scale-[0.99]"
                onClick={() => {
                  if (pendingLang) void applyGameLangChange(pendingLang);
                }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 group-hover:bg-white/15">
                  <FaArrowsRotate className="text-lg text-sky-200/95" aria-hidden />
                </span>
                <span className="text-[15px]">{ui.langSwitch.replaceBtn}</span>
              </button>
              <button
                type="button"
                className="group w-full rounded-xl px-4 py-3.5 text-left ring-1 ring-white/15 bg-gradient-to-br from-emerald-500/18 to-teal-600/15 hover:from-emerald-500/28 hover:to-teal-600/22 hover:ring-emerald-400/25 hover:shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)] transition-all duration-200 text-white font-medium flex items-center gap-3 active:scale-[0.99]"
                onClick={() => {
                  if (pendingLang) void applyLangSwitchPickNewFolder(pendingLang);
                }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 group-hover:bg-white/15">
                  <FaFolderOpen className="text-lg text-emerald-200/80" aria-hidden />
                </span>
                <span className="text-[15px]">{ui.langSwitch.pickFolderBtn}</span>
              </button>
              <button
                type="button"
                className="w-full pt-2 text-sm text-white/50 hover:text-white/88 transition-colors"
                onClick={() => {
                  setShowLangSwitchConfirm(false);
                  setPendingLang(null);
                  void resyncInstallUi();
                }}
              >
                {ui.cancel}
              </button>
            </div>
          </div>
        </Modal>

        {/* Modal de choix initial */}
        <Modal
          open={showInitialChoice}
          title={ui.welcome.title}
          hideActions
          onCancel={() => setShowInitialChoice(false)}
        >
          <div className="text-white/85 text-sm space-y-4">
            <p className="text-base font-medium text-white/90">{ui.welcome.pickLang}</p>
            <p className="text-xs text-white/55 leading-relaxed">
              {ui.welcome.hint}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleWelcomePickLang("fr")}
                className={[
                  "flex flex-col items-center gap-2 p-4 rounded-xl transition-all ring-2",
                  gameLang === "fr"
                    ? "bg-gradient-to-br from-blue-500/35 to-indigo-500/30 ring-amber-400/80"
                    : "bg-gradient-to-br from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 ring-white/15",
                ].join(" ")}
              >
                <span className="font-semibold">Français</span>
                <span className="text-xs opacity-75">{ui.welcome.buildFr}</span>
              </button>
              <button
                type="button"
                disabled={!canUseEnglishTrack}
                onClick={() => void handleWelcomePickLang("en")}
                title={
                  !canUseEnglishTrack
                    ? enTrack === "unavailable"
                      ? ui.welcome.enTitleUnavailable
                      : enTrack === "loading"
                        ? ui.welcome.enTitleLoading
                        : ui.welcome.enTrackWarn
                    : undefined
                }
                className={[
                  "flex flex-col items-center gap-2 p-4 rounded-xl transition-all ring-2",
                  !canUseEnglishTrack && "opacity-45 cursor-not-allowed grayscale",
                  gameLang === "en"
                    ? "bg-gradient-to-br from-cyan-500/35 to-teal-500/30 ring-amber-400/80"
                    : "bg-gradient-to-br from-cyan-500/20 to-teal-500/20 hover:from-cyan-500/30 hover:to-teal-500/30 ring-white/15",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="font-semibold">English</span>
                <span className="text-xs opacity-75">
                  {enTrack === "loading" && !hasLocalEnInstall
                    ? ui.welcome.enChecking
                    : !canUseEnglishTrack
                      ? ui.welcome.enUnavailable
                      : ui.welcome.buildEn}
                </span>
              </button>
            </div>
            {enTrack === "unavailable" && !hasLocalEnInstall && (
              <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2">
                {ui.welcome.enTrackWarn}
              </p>
            )}

            <div className="border-t border-white/10 pt-4 mt-2">
              <p className="text-base mb-3">{ui.welcome.firstTimeQ}</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={gameLang !== "fr" && gameLang !== "en"}
                  onClick={handleFirstTimeUser}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 ring-1 ring-white/20 transition-all disabled:opacity-40 disabled:pointer-events-none disabled:grayscale"
                >
                  <FaPlus className="text-3xl text-blue-400" />
                  <div>
                    <div className="font-semibold">{ui.welcome.firstTime}</div>
                    <div className="text-xs opacity-75 mt-1">{ui.welcome.firstTimeSub}</div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={gameLang !== "fr" && gameLang !== "en"}
                  onClick={handleExistingUser}
                  className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 ring-1 ring-white/20 transition-all disabled:opacity-40 disabled:pointer-events-none disabled:grayscale"
                >
                  <FaGamepad className="text-3xl text-green-400" />
                  <div>
                    <div className="font-semibold">{ui.welcome.alreadyInstalled}</div>
                    <div className="text-xs opacity-75 mt-1">{ui.welcome.alreadyInstalledSub}</div>
                  </div>
                </button>
              </div>
              <p className="col-span-2 text-xs text-amber-200/80 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2 leading-relaxed">
                {ui.welcome.firstTimeNote}
              </p>
            </div>

            <p className="text-xs opacity-60 text-center">
              {ui.welcome.footerHint}
            </p>
          </div>
        </Modal>

        {/* Modal d'installation après échec de détection */}
        <Modal
          open={showInstallPrompt}
          title={ui.installPrompt.title}
          onCancel={() => setShowInstallPrompt(false)}
          onConfirm={handleInstallConfirm}
          confirmLabel={ui.installPrompt.confirm}
          cancelLabel={ui.installPrompt.later}
        >
          <div className="text-white/85 text-sm space-y-2">
            <p>{ui.installPrompt.body1}</p>
            <p>{ui.installPrompt.body2}</p>
          </div>
        </Modal>

        <LauncherSelfUpdateDialog
          open={showLauncherSelfUpdate}
          currentVersion={launcherSelfUpdatePayload?.currentVersion ?? ""}
          remoteVersion={launcherSelfUpdatePayload?.remoteVersion ?? ""}
          notes={launcherUpdateRef.current?.body ?? ""}
          labels={ui.launcherSelfUpdate}
          downloadProgress={launcherInstallerDl}
          fmtBytes={fmtBytes}
          onClose={() => {
            setShowLauncherSelfUpdate(false);
          }}
          onDownload={async () => {
            const update = launcherUpdateRef.current;
            if (!update) return;
            setLauncherInstallerDl({ downloaded: 0, total: 0 });
            try {
              await update.downloadAndInstall((ev) => {
                if (ev.event === "Started") {
                  setLauncherInstallerDl({ downloaded: 0, total: ev.data.contentLength ?? 0 });
                } else if (ev.event === "Progress") {
                  setLauncherInstallerDl((prev) => ({
                    downloaded: (prev?.downloaded ?? 0) + (ev.data.chunkLength ?? 0),
                    total: prev?.total ?? 0,
                  }));
                } else if (ev.event === "Finished") {
                  setLauncherInstallerDl(null);
                  setLauncherSelfUpdatePayload(null);
                  setShowLauncherSelfUpdate(false);
                  const uiSnap = getLauncherUi(uiLangFromGameLang(gameLangRef.current));
                  setLog((l) => prependUnique(l, uiSnap.log.launcherInstallerDone));
                }
              });
              // Le plugin relance l'app automatiquement après installation
            } catch (e: unknown) {
              setLauncherInstallerDl(null);
              setLog((l) =>
                prependUnique(l, `❌ ${formatErrorForUser(String(e), uiLang)}`),
              );
            }
          }}
        />

        <GameUpdateDialog
          open={showGameUpdateDialog}
          currentVersion={installedVersion ?? ""}
          remoteVersion={manifest?.version ? String(manifest.version) : ""}
          status={status}
          progress={progress}
          eta={eta}
          speed={speed}
          downloadedBytes={downloadedBytes}
          totalBytes={totalBytes}
          patchNotes={gameUpdatePatchNotes}
          patchNotesLoading={gameUpdatePatchNotesLoading}
          patchNotesError={gameUpdatePatchNotesError}
          patchNotesBaseUrl={PNW_SITE_URL.replace(/\/$/, "")}
          siteUrl={PNW_SITE_URL}
          labels={ui.gameUpdate}
          onPause={pause}
          onResume={resume}
          onCancel={cancel}
          fmtBytes={fmtBytes}
        />
      </main>

      {/* Chat toggle button */}
      {!chatOpen && (
        <button
          className={`pnw-chat-toggle-btn ${chatUnread > 0 ? "pnw-chat-toggle-btn--unread" : ""}`}
          onClick={() => { setChatOpen(true); setChatUnread(0); }}
          title="Chat PNW"
        >
          <FaCommentDots className="pnw-chat-toggle-icon" />
          <span className="pnw-chat-toggle-label">Chat</span>
          {chatUnread > 0 && (
            <span className="pnw-chat-toggle-badge">{chatUnread > 99 ? "99+" : chatUnread}</span>
          )}
          <span className="pnw-chat-toggle-pulse" />
        </button>
      )}

      {/* Chat fullscreen page — toujours monté pour garder les subscriptions Supabase actives */}
      <div className="pnw-chat-fullscreen" style={(chatOpen || activeView === "battle") ? undefined : { display: "none" }}>
        <ChatView siteUrl={siteUrl} onBack={() => { if (activeView === "battle") setActiveView("launcher"); else setChatOpen(false); }} onUnreadChange={setChatUnread} visible={chatOpen || activeView === "battle"} battleMode={activeView === "battle"} gtsSharePending={gtsSharePending} onGtsShareDone={() => setGtsSharePending(null)} onOpenGts={(onlineId) => { setChatOpen(false); setGtsPendingOnlineId(onlineId ?? null); setActiveView("gts"); }} onOpenBattle={() => { setChatOpen(false); setActiveView("battle"); }} gameProfile={profile} installDir={installDir} lastSavePath={lastSavePath} onProfileReload={() => loadProfile(selectedSaveIdx)} />
      </div>
      </div>
    </div>
  );
}
