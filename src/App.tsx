// src/App.tsx
import React from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress, Modal } from "./ui";
import type { Manifest, PlayerProfile } from "./types";
import { parseSave } from "./profile";
import {
  FaFolderOpen,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaRotateRight,
  FaIdCard,
  FaUser,
  FaCoins,
  FaCalendarDays,
  FaClock,
  FaBookOpen,
  FaEye,
  FaCircleCheck,
  FaGamepad,
  FaCrown,
  FaPlus,
  FaFileImport,
  FaChevronDown,
  FaFloppyDisk,
} from "react-icons/fa6";
import { ThemeMenu, useTheme, PfpMenu, usePfp } from "./themes";
import Sidebar from "./Sidebar";
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

/* ==================== Constantes ==================== */
const PNW_SITE_BASE = import.meta.env.VITE_PNW_SITE_URL?.replace(/\/$/, "") || "https://www.pokemonnewworld.fr";
const MANIFEST_BASE = `${PNW_SITE_BASE}/api/downloads/manifest`;

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

/** Transforme un message d'erreur backend en message clair pour l'utilisateur. */
function formatErrorForUser(err: string | undefined): string {
  if (!err) return "Une erreur est survenue.";
  const e = err.toLowerCase();
  if (e.includes("404") || e.includes("not found")) return "Fichier ou page introuvable (404). Réessayez plus tard.";
  if (e.includes("échec réseau") || e.includes("connection") || e.includes("failed to fetch") || e.includes("network") || e.includes("refused") || e.includes("timed out") || e.includes("timeout")) return "Connexion impossible (réseau ou serveur injoignable).";
  if (e.includes("extraction") || e.includes("archive") || e.includes("zip") || e.includes("corromp")) return "Erreur d'extraction ou archive corrompue. Relancez la mise à jour.";
  if (e.includes("annulé") || e.includes("cancel")) return "Téléchargement annulé.";
  if (e.includes("espace") || e.includes("disk") || e.includes("space")) return "Espace disque insuffisant.";
  return err;
}

/* ===== Helpers chemins + sprites/ico ===== */
const norm = (p: string) => p.replaceAll("\\", "/");
const join = (...parts: string[]) =>
  parts.map((p) => norm(p).replace(/^\/+|\/+$/g, "")).join("/");
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

/** URL asset:// pour un chemin absolu */
const toFileUrl = (p: string) => convertFileSrc(p.replaceAll("\\", "/"));

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
function formatPlayTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hStr = h.toLocaleString("fr-FR");
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
function rootFromSavePath(savePath: string, fallback: string) {
  const s = norm(savePath).toLowerCase();
  const idx = s.lastIndexOf("/saves/");
  return idx >= 0 ? savePath.slice(0, idx) : fallback;
}

/* Icônes pokémon */
function monIconCandidates(root: string, m: any): { list: string[] } {
  const dirN = join(root, "graphics", "pokedex", "pokefront");

  const names: string[] = [];
  if (m.code != null) {
    const raw = String(m.code);
    const base = /^\d+$/.test(raw) ? pad3(parseInt(raw, 10)) : raw;
    if (m.form != null && m.form !== "" && !Number.isNaN(Number(m.form))) {
      names.push(`${base}_${pad2(parseInt(String(m.form), 10))}`);
    }
    names.push(`${base}_00`, base);
  }
  if (m.speciesName) {
    const s = String(m.speciesName).trim();
    names.push(s, s.toLowerCase(), s.replace(/\s+/g, "_"));
  }
  const uniqNames = Array.from(new Set(names));
  const exts = [".png", ".gif", ".webp"];

  const list: string[] = [];
  for (const nm of uniqNames) for (const ext of exts) list.push(toFileUrl(join(dirN, `${nm}${ext}`)));
  for (const ext of exts) list.push(toFileUrl(join(dirN, `000${ext}`)));
  return { list };
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
type ViewName = "launcher" | "lore" | "pokedex" | "guide" | "patchnotes" | "items" | "evs" | "bst" | "nerfs" | "team" | "contact";

/* ==================== Dropdown Dossier (portail) ==================== */
function FolderDropdown({
  anchorRef,
  onClose,
  onChooseFolder,
  onInsertSave,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onChooseFolder: () => void;
  onInsertSave: () => void;
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
          <FaFolderOpen /> Choisir un dossier…
        </button>
        <button
          className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-b-xl flex items-center gap-2 transition-colors duration-200"
          onClick={onInsertSave}
        >
          <FaFileImport /> Insérer une save
        </button>
      </div>
    </>
  );
}

/* ==================== App ==================== */
export default function App() {
  const [activeView, setActiveView] = useState<ViewName>("launcher");
  const [status, setStatus] = useState<UiState>("idle");
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState("—");
  const [speed, setSpeed] = useState("—/s");
  const [log, setLog] = useState<string[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  const [installDir, setInstallDir] = useState("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [hasExe, setHasExe] = useState(false);
  const [hasVersion, setHasVersion] = useState(false);

  const [openFolderMenu, setOpenFolderMenu] = useState(false);
  const folderBtnRef = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanText, setScanText] = useState("Recherche du jeu…");
  const [isOffline, setIsOffline] = useState(false);

  // Modals
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);
  /** Langue du jeu (piste manifest). null = pas encore enregistré côté config. */
  const [gameLang, setGameLang] = useState<"fr" | "en" | null>(null);
  const [showPickGameLang, setShowPickGameLang] = useState(false);
  const [showMigrationLangDialog, setShowMigrationLangDialog] = useState(false);
  const [showLangSwitchConfirm, setShowLangSwitchConfirm] = useState(false);
  const [pendingLang, setPendingLang] = useState<"fr" | "en" | null>(null);

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileState, setProfileState] =
    useState<"idle" | "loading" | "ready" | "none" | "error">("idle");
  const [lastSavePath, setLastSavePath] = useState<string | null>(null);
  const [saveList, setSaveList] = useState<{ path: string; name: string; modified: number; size: number }[]>([]);
  const [selectedSaveIdx, setSelectedSaveIdx] = useState(0);
  const [openSaveMenu, setOpenSaveMenu] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  const pollingRef = useRef<number | null>(null);
  const initialCheckDone = useRef(false);
  const autoUpdateStarted = useRef(false);
  /** Évite de re-scanner les version-hints tant que l’utilisateur n’a pas choisi la langue installée. */
  const awaitingMigrationChoiceRef = useRef(false);

  const { theme, bgUrl, setBgPublic } = useTheme();
  const { pfpUrl } = usePfp();

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
        setEta("—");
        setSpeed("—/s");
        autoUpdateStarted.current = false;
        setLog((l) => prependUnique(l, "Téléchargement annulé"));
        return;
      }
      if (p.stage === "done") {
        setStatus("done");
        setProgress(100);
        setEta("0:00");
        setLog((l) => prependUnique(l, "✅ Installation/Mise à jour terminée"));
        setShowUpdateNotice(false);
        autoUpdateStarted.current = false;

        setTimeout(async () => {
          const info = await readInstallInfo();
          setHasExe(info.hasExe);
          setHasVersion(info.hasVersion);
          setInstalledVersion(info.version);
          await loadProfile();
        }, 200);
        return;
      }
      if (p.stage === "download") {
        setStatus("downloading");
        const tot = p.total || 0,
          dl = p.downloaded || 0;
        setProgress(tot ? (dl / tot) * 100 : 0);
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
      const msg = formatErrorForUser(e.payload?.error);
      setLog((l) => prependUnique(l, `❌ ${msg}`));
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [manifest]);

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
    }>("cmd_get_install_info", {});
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
      await invoke("cmd_set_game_lang", { lang });
      setGameLang(lang);
      setShowMigrationLangDialog(false);
      awaitingMigrationChoiceRef.current = false;
      autoUpdateStarted.current = false;
      const info = await readInstallInfo();
      const m = await fetchManifest({ lang: effectiveLangForInfo(info) });
      if (m) processInstallStatus(m, info, info.hasExe === true);
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Langue : ${String(e)}`));
    }
  }

  async function applyGameLangChange(lang: "fr" | "en") {
    try {
      await invoke("cmd_set_game_lang", { lang });
      setGameLang(lang);
      setShowLangSwitchConfirm(false);
      setPendingLang(null);
      autoUpdateStarted.current = false;
      const info = await readInstallInfo();
      const m = await fetchManifest({ lang: effectiveLangForInfo(info) });
      if (m) processInstallStatus(m, info, info.hasExe === true);
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Langue : ${String(e)}`));
    }
  }

  function requestGameLangChange(newLang: "fr" | "en") {
    if (newLang === gameLang) return;
    if (hasExe) {
      setPendingLang(newLang);
      setShowLangSwitchConfirm(true);
    } else {
      applyGameLangChange(newLang).catch((e) =>
        setLog((l) => prependUnique(l, `❌ ${String(e)}`)),
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
      setLog((l) => prependUnique(l, "❌ Manifest sans URL"));
      return;
    }
    try {
      const check = await invoke<{ ok: boolean; message?: string }>("cmd_check_disk_space_for_update", {
        manifest: m,
      });
      if (!check.ok && check.message) {
        setStatus("ready");
        setLog((l) => prependUnique(l, `❌ ${check.message}`));
        autoUpdateStarted.current = false;
        setShowUpdateNotice(true);
        return;
      }
    } catch (e) {
      setStatus("ready");
      setLog((l) => prependUnique(l, `❌ Vérification espace disque : ${String(e)}`));
      autoUpdateStarted.current = false;
      return;
    }
    setStatus("downloading");
    setProgress(0);
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
      const idx = forceIdx ?? 0;
      setSelectedSaveIdx(idx);
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
        setLog((l) => prependUnique(l, "⚠️ Profil: échec de lecture de la sauvegarde"));
        return;
      }
      setProfile(p);
      setProfileState("ready");
    } catch (e: any) {
      setProfile(null);
      setProfileState("error");
      setLog((l) => prependUnique(l, `⚠️ Profil: ${String(e)}`));
    }
  }

  async function switchSave(idx: number) {
    setOpenSaveMenu(false);
    if (idx === selectedSaveIdx && profileState === "ready") return;
    setSelectedSaveIdx(idx);
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

      // 1) Pas d’installation : choisir la langue du jeu avant le reste
      if (!installed && info.gameLang !== "fr" && info.gameLang !== "en") {
        setStatus("ready");
        setShowPickGameLang(true);
        return;
      }

      // 2) Installé sans game_lang : migration ou dialogue
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
        const msg = formatErrorForUser(errStr);
        setLog((l) => prependUnique(l, `❌ ${msg}`));
        if (/400|non configuré|anglais/i.test(errStr) && langFetch === "en") {
          setLog((l) =>
            prependUnique(
              l,
              "ℹ️ Build anglais non publié sur le site : repassez en Français ou configurez windowsEn + gameVersionEn.",
            ),
          );
        }
        if (networkError) {
          setIsOffline(true);
          setStatus("ready");
          if (installed) {
            setLog((l) => prependUnique(l, "📴 Mode hors-ligne : vous pouvez lancer le jeu."));
          }
          return;
        }
        setStatus("error");
        return;
      }

      // 3) Nouvelle installation : bienvenue (première fois / déjà installé) une fois la langue connue
      if (!installed && !initialCheckDone.current) {
        setStatus("ready");
        setShowInitialChoice(true);
        initialCheckDone.current = true;
        return;
      }

      processInstallStatus(m, info, installed);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => prependUnique(l, `❌ ${formatErrorForUser(String(e))}`));
    }
  }

  function processInstallStatus(m: Manifest, info: any, isInstalled: boolean) {
    const remoteV = m?.version ?? null;
    const localV = info.version;

    if (!isInstalled) {
      setStatus("ready");
      autoUpdateStarted.current = false;
      return;
    }

    const needUpdate = !!remoteV && (localV ? cmpSemver(localV, remoteV) < 0 : true);
    setStatus("ready");

    if (needUpdate) {
      setLog((l) =>
        prependUnique(l, `⚠️ Mise à jour disponible : v${localV ?? "?"} → v${remoteV ?? "?"}`)
      );
      if (!autoUpdateStarted.current && status !== "downloading") {
        autoUpdateStarted.current = true;
        setShowUpdateNotice(true);
        setLog((l) => prependUnique(l, `🔄 Mise à jour automatique lancée → v${m.version}`));
        startInstallOrUpdate(m);
      }
    } else {
      autoUpdateStarted.current = false;
      setLog((l) => prependUnique(l, `✅ Jeu à jour (v${localV ?? "?"})`));
    }
  }

  /* ====== Actions suite au choix initial ====== */
  async function handlePickGameLang(lang: "fr" | "en") {
    try {
      await invoke("cmd_set_game_lang", { lang });
      setGameLang(lang);
      setShowPickGameLang(false);
      await fetchManifest({ lang });
      await check();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Langue : ${String(e)}`));
    }
  }

  async function handleFirstTimeUser() {
    setShowInitialChoice(false);
    setLog((l) => prependUnique(l, "🆕 Nouvelle installation"));
    await invoke("cmd_set_default_install_dir");
    const info = await readInstallInfo();
    setInstallDir(info.installDir);
    const L: "fr" | "en" = info.gameLang === "fr" || info.gameLang === "en" ? info.gameLang : "fr";
    const m = manifest ?? (await fetchManifest({ lang: L }));
    startInstallOrUpdate(m);
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
        setLog((l) => prependUnique(l, "ℹ️ Sélection annulée"));
        return;
      }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      setLog((l) => prependUnique(l, `📁 Dossier du jeu défini : ${dir}`));

      const newInfo = await readInstallInfo();
      const L: "fr" | "en" =
        newInfo.gameLang === "fr" || newInfo.gameLang === "en" ? newInfo.gameLang : "fr";
      const m = manifest ?? (await fetchManifest({ lang: L }));
      processInstallStatus(m, newInfo, newInfo.hasExe === true);
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Erreur sélection : ${String(e)}`));
    }
  }

  /* ====== Actions utilisateur ====== */
  async function handleInstallConfirm() {
    setShowInstallPrompt(false);
    const info = await readInstallInfo();
    const L: "fr" | "en" = effectiveLangForInfo(info);
    const m = manifest ?? (await fetchManifest({ lang: L }));
    startInstallOrUpdate(m);
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
        setLog((l) => prependUnique(l, "ℹ️ Sélection annulée"));
        return;
      }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      setLog((l) => prependUnique(l, `📁 Dossier défini : ${dir}`));
      await check();
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Erreur sélection : ${String(e)}`));
    }
  }
  
  async function manualDetect() {
    try {
      setOpenFolderMenu(false);
      setScanText("Recherche manuelle du jeu...");
      setScanning(true);
      const detected: string | null = await detectExistingGamePath();
      setScanning(false);
      if (!detected) {
        setLog((l) => prependUnique(l, "ℹ️ Aucun jeu détecté"));
        return;
      }
      await invoke("cmd_set_install_dir", { path: detected });
      setInstallDir(detected);
      setLog((l) => prependUnique(l, `✅ Jeu trouvé : ${detected}`));
      await check();
      await loadProfile();
    } catch (e: any) {
      setScanning(false);
      setLog((l) => prependUnique(l, `❌ Détection échouée : ${String(e)}`));
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
      setLog((l) => prependUnique(l, `💾 Save importée : ${dest}`));
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Import save échoué : ${String(e)}`));
    }
  }

  async function launchGame() {
    try {
      await invoke("cmd_launch_game", {
        exeName: "Pokémon New World.exe",
      });
      setLog((l) => prependUnique(l, "🎮 Lancement du jeu..."));
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Impossible de lancer : ${String(e)}`));
    }
  }

  const pause = () => invoke("cmd_pause_download");
  const resume = () => invoke("cmd_resume_download");
  const cancel = () => {
    invoke("cmd_cancel_download");
    setShowUpdateNotice(false);
  };

  /* ====== Détection connexion (online/offline) ====== */
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  /* ====== Initialisation ====== */
  useEffect(() => {
    check();
    loadProfile();

    pollingRef.current = window.setInterval(() => {
      if (status !== "downloading" && status !== "extracting") {
        check();
        loadProfile();
      }
    }, 5 * 60 * 1000);

    const onVis = () => {
      if (
        document.visibilityState === "visible" &&
        status !== "downloading" &&
        status !== "extracting"
      ) {
        check();
        loadProfile();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const isInstalled = hasExe;
  const needUpdate =
    isInstalled && !!manifest
      ? installedVersion
        ? cmpSemver(installedVersion, manifest.version) < 0
        : true
      : false;

  // Bouton principal
  const getMainButton = () => {
    if (status === "downloading" || status === "extracting" || status === "reconnecting") {
      return null;
    }
    if (!isInstalled) {
      return (
        <IconButton
          icon={<FaDownload />}
          label="Installer le jeu"
          tone="primary"
          onClick={handleInstallConfirm}
        />
      );
    }
    if (needUpdate) {
      return (
        <IconButton
          icon={<FaDownload />}
          label="Mettre à jour"
          tone="primary"
          onClick={async () => {
            setShowUpdateNotice(true);
            startInstallOrUpdate(
              manifest ??
                (await fetchManifest({
                  lang: effectiveLangForInfo(await readInstallInfo()),
                })),
            );
          }}
        />
      );
    }
    return <IconButton tone="success" icon={<FaPlay />} label="Jouer" onClick={launchGame} />;
  };

  const siteUrl = PNW_SITE_URL;

  function renderView() {
    switch (activeView) {
      case "lore": return <LoreView siteUrl={siteUrl} />;
      case "guide": return <GuideView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "patchnotes": return <PatchNotesView siteUrl={siteUrl} />;
      case "pokedex": return <PokedexView siteUrl={siteUrl} />;
      case "items": return <ItemLocationView siteUrl={siteUrl} />;
      case "evs": return <EVsLocationView siteUrl={siteUrl} />;
      case "bst": return <BSTView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "nerfs": return <NerfsAndBuffsView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "team": return <TeamView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      case "contact": return <ContactView siteUrl={siteUrl} onBack={() => setActiveView("launcher")} />;
      default: return null;
    }
  }

  return (
    <div className="min-h-screen relative flex">
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
      <Sidebar siteUrl={siteUrl} activeView={activeView} onNavigate={(v) => setActiveView(v as ViewName)} sidebarImageUrl={manifest?.launcherSidebarImageUrl} />

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
              <span>{scanText}</span>
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
              activeView === "lore" || activeView === "guide" || activeView === "nerfs" || activeView === "bst" || activeView === "team" || activeView === "contact"
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
            <span className="font-semibold">📴 Pas de connexion</span>
            <span>— Vous pouvez lancer le jeu si déjà installé.</span>
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
            <ThemeMenu defaultBgUrl={manifest?.launcherBackgroundUrl} />
            <PfpMenu />
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaRotateRight />}
              label="Rafraîchir"
              onClick={() => {
                autoUpdateStarted.current = false;
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
              <div className="text-xs text-white/50 font-medium tracking-wider uppercase">Répertoire d'installation</div>
              <div className="accent-glow-inner text-sm text-white/85 font-mono bg-white/5 rounded-lg px-3 py-1.5 truncate">
                {installDir || "Non défini"}
              </div>

              <div className="flex items-center flex-wrap gap-2 pt-1">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 ${
                  !hasExe
                    ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/30"
                    : "accent-glow-badge"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    !hasExe ? "bg-red-400" : "accent-glow-badge-dot"
                  }`} />
                  {!hasExe ? "Non installé" : needUpdate ? "Mise à jour disponible" : "À jour"}
                </span>

                {installedVersion && (
                  <span className="accent-glow-badge text-xs text-white/80 rounded-full px-2.5 py-1">
                    v{installedVersion}
                  </span>
                )}
                {manifest?.version && needUpdate && (
                  <span className="accent-glow-badge text-xs text-white/90 rounded-full px-2.5 py-1">
                    → v{manifest.version}
                  </span>
                )}

                <label className="inline-flex items-center gap-1.5 text-xs text-white/55">
                  <span className="whitespace-nowrap">Langue du jeu</span>
                  <select
                    className="rounded-lg bg-white/10 border border-white/15 px-2 py-1 text-white/90 text-xs font-medium cursor-pointer max-w-[9rem]"
                    value={gameLang === "en" ? "en" : "fr"}
                    onChange={(e) => requestGameLangChange(e.target.value as "fr" | "en")}
                    aria-label="Langue du jeu"
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0">
              <div ref={folderBtnRef} className="relative">
                <IconButton
                  icon={<FaFolderOpen />}
                  label={
                    <span className="inline-flex items-center gap-2">
                      Dossier <span className="text-white/60 text-[10px]">▾</span>
                    </span>
                  }
                  tone="ghost"
                  className="accent-glow-inner"
                  onClick={() => setOpenFolderMenu((o) => !o)}
                />
                {openFolderMenu && createPortal(
                  <FolderDropdown
                    anchorRef={folderBtnRef}
                    onClose={() => setOpenFolderMenu(false)}
                    onChooseFolder={() => { setOpenFolderMenu(false); chooseFolder(); }}
                    onInsertSave={() => { setOpenFolderMenu(false); insertSave(); }}
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
                  {status === "downloading" && "Téléchargement en cours…"}
                  {status === "paused" && "En pause"}
                  {status === "extracting" && `Extraction… ${Math.round(progress)}%`}
                  {status === "reconnecting" && "Reconnexion…"}
                </div>
                <div className="text-white/50 text-xs tabular-nums">
                  {status !== "extracting" && (
                    <>{eta} restant • {speed}</>
                  )}
                </div>
              </div>
              <Progress value={progress} />
              <div className="flex gap-2 pt-1">
                {status !== "paused" && status !== "extracting" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPause />} label="Pause" onClick={pause} />
                )}
                {status === "paused" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPlay />} label="Reprendre" onClick={resume} />
                )}
                {(status === "downloading" || status === "paused" || status === "reconnecting") && (
                  <IconButton tone="ghost" size="sm" icon={<FaStop />} label="Annuler" onClick={cancel} />
                )}
              </div>
            </div>
          )}
        </section>

        <Card title={
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <FaUser className="section-header-icon text-[14px]" />
              Profil joueur
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
            <div className="text-white/80 text-sm">Lecture de la sauvegarde…</div>
          )}
          {profileState === "none" && (
            <div className="text-white/80 text-sm">
              Aucune sauvegarde trouvée. Lance le jeu au moins une fois pour créer un profil.
            </div>
          )}
          {profileState === "error" && (
            <div className="text-white/80 text-sm">Impossible de lire la save (voir Journal).</div>
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
                    <span className="pokedex-badge pokedex-badge--vus inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1 ring-1">
                      <FaEye className="text-[10px]" />
                      <b>{profile.pokedex?.seen ?? "?"}</b> vus
                    </span>
                    <span className="pokedex-badge pokedex-badge--caught inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1 ring-1">
                      <FaCircleCheck className="text-[10px]" />
                      <b>{profile.pokedex?.caught ?? "?"}</b> capturés
                    </span>
                  </div>
                </div>
              </div>

              {/* Grille de stats */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaCoins className="stat-tile-icon" /> Argent</div>
                  <div className="stat-tile-value">{profile.money != null ? `${profile.money.toLocaleString()}₽` : "—"}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaClock className="stat-tile-icon" /> Temps</div>
                  <div className="stat-tile-value stat-tile-value--time">
                    {profile.playTimeSec != null
                      ? formatPlayTime(profile.playTimeSec)
                      : "—"}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label"><FaCalendarDays className="stat-tile-icon" /> Début</div>
                  <div className="stat-tile-value">
                    {profile.startTime
                      ? new Date(
                          (profile.startTime > 1e11
                            ? profile.startTime
                            : (profile.startTime as number) * 1000) as number
                        ).toLocaleDateString()
                      : "—"}
                  </div>
                </div>
              </div>

              {/* Équipe */}
              {profile.team?.length ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2.5 flex items-center gap-1.5">
                    <FaGamepad className="section-header-icon text-[11px]" /> Équipe
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {profile.team.map((m, i) => {
                      const root =
                        lastSavePath ? rootFromSavePath(lastSavePath, installDir) : installDir;
                      const { list } = monIconCandidates(root, m);
                      return (
                        <div
                          key={i}
                          className="team-mon-card group"
                        >
                          <div className="team-mon-sprite-wrap">
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
                          </div>
                          <div className="text-[11px] font-bold text-center mt-1.5 text-white/80">
                            Nv. {m.level ?? "—"}
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
                  Boss
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
                        title={obtained ? `Boss ${n} vaincu` : `Boss ${n}`}
                      >
                        <img
                          src={bossIconPath}
                          alt={`Boss ${n}`}
                          className="boss-badge-icon"
                        />
                        <span className="boss-badge-label">Boss {n}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>

        <div className="journal-layer">
          <Card title="Journal">
            <div className="text-sm space-y-0.5 max-h-52 overflow-auto pnw-scrollbar pr-1">
              {log.length === 0 ? (
                <div className="text-white/40 text-xs italic py-2">Aucun événement pour le moment.</div>
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
      </div>
        )}

        {/* Langue du jeu avant toute installation */}
        <Modal
          open={showPickGameLang}
          title="Langue du jeu"
          hideActions
          onCancel={undefined}
        >
          <div className="text-white/85 text-sm space-y-4">
            <p className="text-base">Quelle version du jeu souhaitez-vous installer ? (FR / AN peuvent avoir des numéros différents.)</p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                type="button"
                onClick={() => handlePickGameLang("fr")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 ring-1 ring-white/20 transition-all"
              >
                <span className="font-semibold">Français</span>
                <span className="text-xs opacity-75">Build FR</span>
              </button>
              <button
                type="button"
                onClick={() => handlePickGameLang("en")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 hover:from-cyan-500/30 hover:to-teal-500/30 ring-1 ring-white/20 transition-all"
              >
                <span className="font-semibold">English</span>
                <span className="text-xs opacity-75">Build EN</span>
              </button>
            </div>
          </div>
        </Modal>

        {/* Migration : installation existante sans game_lang en config */}
        <Modal
          open={showMigrationLangDialog}
          title="Langue de votre installation"
          hideActions
          onCancel={undefined}
        >
          <div className="text-white/85 text-sm space-y-4">
            <p>
              Le launcher ne savait pas quelle langue était installée. Indiquez la langue du build actuellement sur ce PC
              (pour comparer les mises à jour avec la bonne piste).
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
                onClick={() => void confirmMigrationLang("en")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 hover:from-cyan-500/30 hover:to-teal-500/30 ring-1 ring-white/20 transition-all"
              >
                <span className="font-semibold">English</span>
              </button>
            </div>
          </div>
        </Modal>

        {/* Confirmation changement de langue (jeu déjà installé) */}
        <Modal
          open={showLangSwitchConfirm}
          title="Changer la langue du jeu"
          onCancel={() => {
            setShowLangSwitchConfirm(false);
            setPendingLang(null);
          }}
          onConfirm={() => {
            if (pendingLang) void applyGameLangChange(pendingLang);
          }}
          confirmLabel="Confirmer"
          cancelLabel="Annuler"
        >
          <p>
            Le prochain téléchargement utilisera l’archive{" "}
            <strong>{pendingLang === "en" ? "anglaise" : "française"}</strong> et remplacera l’installation actuelle
            (les sauvegardes sont conservées comme d’habitude).
          </p>
        </Modal>

        {/* Modal de choix initial */}
        <Modal
          open={showInitialChoice}
          title="Bienvenue sur PNW Launcher"
          onCancel={() => setShowInitialChoice(false)}
          onConfirm={() => {}}
          confirmLabel=""
          cancelLabel=""
        >
          <div className="text-white/85 text-sm space-y-4">
            <p className="text-base">Est-ce votre première fois sur Pokémon New World ?</p>
            
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                onClick={handleFirstTimeUser}
                className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 ring-1 ring-white/20 transition-all"
              >
                <FaPlus className="text-3xl text-blue-400" />
                <div>
                  <div className="font-semibold">Première fois</div>
                  <div className="text-xs opacity-75 mt-1">Je n'ai jamais joué</div>
                </div>
              </button>

              <button
                onClick={handleExistingUser}
                className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 ring-1 ring-white/20 transition-all"
              >
                <FaGamepad className="text-3xl text-green-400" />
                <div>
                  <div className="font-semibold">Déjà installé</div>
                  <div className="text-xs opacity-75 mt-1">J'ai déjà le jeu</div>
                </div>
              </button>
            </div>

            <p className="text-xs opacity-60 text-center mt-3">
              Vous pourrez changer le dossier d'installation plus tard via le menu Dossier
            </p>
          </div>
        </Modal>

        {/* Modal d'installation après échec de détection */}
        <Modal
          open={showInstallPrompt}
          title="Jeu non trouvé"
          onCancel={() => setShowInstallPrompt(false)}
          onConfirm={handleInstallConfirm}
          confirmLabel="Installer maintenant"
          cancelLabel="Plus tard"
        >
          <div className="text-white/85 text-sm space-y-2">
            <p>Nous n'avons pas trouvé Pokémon New World sur votre ordinateur.</p>
            <p>
              Voulez-vous l'installer maintenant ? Le jeu sera installé dans le dossier par défaut
              (AppData\Local\PNW Launcher).
            </p>
          </div>
        </Modal>
      </main>
    </div>
  );
}
