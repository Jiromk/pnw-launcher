// src/App.tsx
import React from "react";
import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress, Modal } from "./ui";
import type { Manifest, PlayerProfile } from "./types";
import { parseSave } from "./profile";
import {
  FaFolderOpen,
  FaGithub,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaRotateRight,
  FaWandMagicSparkles,
  FaIdCard,
  FaCoins,
  FaCalendarDays,
  FaClock,
  FaBookOpen,
  FaEye,
  FaCircleCheck,
  FaGamepad,
  FaPlus,
} from "react-icons/fa6";
import { ThemeMenu, useTheme, PfpMenu, usePfp } from "./themes";

/* ==================== Constantes ==================== */
const MANIFEST_URL =
  "https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/latest.json";

type DlEvent = {
  stage: "download" | "extract" | "paused" | "canceled" | "done" | "reconnect";
  downloaded?: number;
  total?: number;
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
function cmpSemver(a: string, b: string) {
  const A = a.split(".").map(Number),
    B = b.split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0,
      y = B[i] || 0;
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
    primary:
      "bg-gradient-to-br from-blue-500/90 to-indigo-500/90 hover:from-blue-500 hover:to-indigo-500 ring-1 ring-white/10",
    secondary: "bg-white/10 hover:bg-white/15 ring-1 ring-white/15",
    ghost: "bg-white/6 hover:bg-white/10 ring-1 ring-white/10",
    success:
      "bg-gradient-to-br from-green-500/90 to-emerald-500/90 hover:from-green-500 hover:to-emerald-500 ring-1 ring-white/10",
  };
  return (
    <Button
      className={[
        "group rounded-xl shadow-[0_8px_25px_-10px_rgba(0,0,0,0.6)] backdrop-blur transition-all active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50",
        sizes.pad,
        sizes.gap,
        sizes.text,
        tones[tone],
        className,
      ].join(" ")}
      {...props}
    >
      <span
        className={[
          "grid place-items-center rounded-lg bg-white/12 ring-1 ring-white/15 shadow-inner shadow-black/20",
          sizes.iconBox,
          "transition-transform duration-200 group-active:scale-95",
        ].join(" ")}
      >
        <span className={sizes.icon}>{icon}</span>
      </span>
      <span className="font-medium tracking-wide">{label}</span>
    </Button>
  );
}

/* ==================== App ==================== */
export default function App() {
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
  const [scanning, setScanning] = useState(false);
  const [scanText, setScanText] = useState("Recherche du jeu…");

  // Modals
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showUpdateNotice, setShowUpdateNotice] = useState(false);

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileState, setProfileState] =
    useState<"idle" | "loading" | "ready" | "none" | "error">("idle"); // FIX: generic sur la même ligne
  const [lastSavePath, setLastSavePath] = useState<string | null>(null);

  const pollingRef = useRef<number | null>(null);
  const initialCheckDone = useRef(false);
  const autoUpdateStarted = useRef(false);

  const { bgUrl } = useTheme();
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
      if (p.stage === "extract") setStatus("extracting");
    });
    const un2 = listen<any>("pnw://error", (e) => {
      setStatus("error");
      setLog((l) => prependUnique(l, `❌ Erreur: ${e.payload?.error}`));
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [manifest]);

  /* ====== Backend helpers ====== */
  async function fetchManifest() {
    const m = await invoke<Manifest>("cmd_fetch_manifest", { manifestUrl: MANIFEST_URL });
    setManifest(m);
    return m;
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
    }>("cmd_get_install_info", {});
    setInstallDir(info.installDir);
    setHasExe(info.hasExe);
    setHasVersion(info.hasVersion);
    setInstalledVersion(info.version);
    return info;
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
  
  function startInstallOrUpdate(m: Manifest) {
    if (!getZipUrl(m)) {
      setLog((l) => prependUnique(l, "❌ Manifest sans URL"));
      return;
    }
    setStatus("downloading");
    setProgress(0);
    setEta("—");
    setSpeed("—/s");
    invoke("cmd_download_and_install", { manifest: m });
  }

  /* ====== Profil ====== */
  async function loadProfile() {
    try {
      setProfileState("loading");
      const blob = await invoke<{ path: string; modified: number; bytes_b64: string } | null>(
        "cmd_latest_save_blob",
        {}
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

  /* ====== Check principal amélioré avec choix initial ====== */
  async function check() {
    try {
      setStatus("checking");
      const [m, info] = await Promise.all([fetchManifest(), readInstallInfo()]);

      const isInstalled = info.hasExe === true;

      if (!isInstalled && !initialCheckDone.current) {
        setStatus("ready");
        setShowInitialChoice(true);
        initialCheckDone.current = true;
        return;
      }

      processInstallStatus(m, info, isInstalled);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => prependUnique(l, `❌ Erreur check: ${String(e)}`));
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
  async function handleFirstTimeUser() {
    setShowInitialChoice(false);
    setLog((l) => prependUnique(l, "🆕 Nouvelle installation"));
    await invoke("cmd_set_default_install_dir");
    const info = await readInstallInfo();
    setInstallDir(info.installDir);
    const m = manifest ?? (await fetchManifest());
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
      const m = manifest ?? (await fetchManifest());
      processInstallStatus(m, newInfo, newInfo.hasExe === true);
      await loadProfile();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `❌ Erreur sélection : ${String(e)}`));
    }
  }

  /* ====== Actions utilisateur ====== */
  async function handleInstallConfirm() {
    setShowInstallPrompt(false);
    const m = manifest ?? (await fetchManifest());
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
            startInstallOrUpdate(manifest ?? (await fetchManifest()));
          }}
        />
      );
    }
    return <IconButton tone="success" icon={<FaPlay />} label="Jouer" onClick={launchGame} />;
  };

  return (
    <div className="min-h-screen relative">
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

      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="logo"
              className="w-10 h-10 object-contain rounded-md ring-1 ring-white/20 bg-white/5"
            />
            <h1 className="text-2xl font-bold">PNW — Launcher</h1>
          </div>
          <div className="flex gap-3">
            <ThemeMenu />
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
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaGithub />}
              label="GitHub"
              onClick={() => window.open("https://github.com/Jiromk/pnw-launcher", "_blank")}
            />
          </div>
        </header>

        <section className="hero p-6">
          <div className="flex items-center gap-6">
            <img
              src="/logo.png"
              alt="logo"
              className="w-20 h-20 object-contain rounded-xl ring-1 ring-white/10 bg-white/5"
            />
            <div className="flex-1">
              <div>
                Chemin : <b className="text-white/95">{installDir || "Non défini"}</b>
              </div>
              <div>
                État :{" "}
                <b>
                  {!hasExe
                    ? "❌ Non installé"
                    : !hasVersion
                    ? "⚠️ Fichier .version manquant"
                    : needUpdate
                    ? "⚠️ Mise à jour disponible"
                    : "✅ À jour"}
                </b>
              </div>
              <div>Version locale : <b>{installedVersion ?? "—"}</b></div>
              <div>Version distante : <b>{manifest?.version ?? "…"}</b></div>
            </div>

            <div className="relative z-40 flex flex-col gap-2">
              <div className="relative">
                <IconButton
                  icon={<FaFolderOpen />}
                  label={
                    <span className="inline-flex items-center gap-2">
                      Dossier <span className="text-white/80">▾</span>
                    </span>
                  }
                  tone="ghost"
                  onClick={() => setOpenFolderMenu((o) => !o)}
                />
                {openFolderMenu && (
                  <div
                    className="absolute right-0 mt-2 w-64 rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur shadow-xl z-[999]"
                    onMouseLeave={() => setOpenFolderMenu(false)}
                  >
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-t-xl flex items-center gap-2"
                      onClick={() => {
                        setOpenFolderMenu(false);
                        chooseFolder();
                      }}
                    >
                      <FaFolderOpen /> Choisir un dossier…
                    </button>
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-b-xl flex items-center gap-2"
                      onClick={() => {
                        setOpenFolderMenu(false);
                        manualDetect();
                      }}
                    >
                      <FaWandMagicSparkles /> Détecter automatiquement
                    </button>
                  </div>
                )}
              </div>

              {getMainButton()}
            </div>
          </div>

          {(status === "downloading" ||
            status === "paused" ||
            status === "extracting" ||
            status === "reconnecting") && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm opacity-80">
                <div>
                  {status === "downloading" && "Téléchargement en cours..."}
                  {status === "paused" && "En pause"}
                  {status === "extracting" && "Extraction des fichiers..."}
                  {status === "reconnecting" && "Reconnexion au serveur..."}
                </div>
                <div>
                  Temps restant : <b>{eta}</b> • Vitesse : <b>{speed}</b>
                </div>
              </div>
              <Progress value={progress} />
              <div className="flex gap-2">
                {status !== "paused" && status !== "extracting" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPause />} label="Pause" onClick={pause} />
                )}
                {status === "paused" && (
                  <IconButton
                    tone="ghost"
                    size="sm"
                    icon={<FaPlay />}
                    label="Reprendre"
                    onClick={resume}
                  />
                )}
                {(status === "downloading" || status === "paused" || status === "reconnecting") && (
                  <IconButton tone="ghost" size="sm" icon={<FaStop />} label="Annuler" onClick={cancel} />
                )}
              </div>
            </div>
          )}
        </section>

        {showUpdateNotice && status === "downloading" && (
          <div className="bg-orange-500/20 border border-orange-500/40 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <FaDownload className="text-orange-400 text-xl" />
              <div className="flex-1">
                <div className="font-semibold">Mise à jour en cours</div>
                <div className="text-sm opacity-80">Installation de la version {manifest?.version}...</div>
              </div>
            </div>
          </div>
        )}

        <Card title="Profil joueur">
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
            <div className="flex flex-col gap-4">
              <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10 bg-gradient-to-br from-white/5 to-white/2 p-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center overflow-hidden shadow-inner">
                      <img
                        src={pfpUrl ?? playerSpriteUrl(profile)}
                        className="w-full h-full object-cover"
                        alt=""
                      />
                    </div>
                    <div className="absolute -inset-1 -z-10 blur-2xl opacity-20 bg-gradient-to-tr from-blue-500 to-indigo-500" />
                  </div>

                  <div className="min-w-0">
                    <div className="text-lg font-semibold leading-tight truncate">
                      {profile.name ?? "—"}
                    </div>
                    <div className="mt-1 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/8 px-2 py-0.5 ring-1 ring-white/10">
                        <FaIdCard className="opacity-80" />
                        ID{" "}
                        <b>
                          {profile.id != null ? profile.id.toString().padStart(5, "0") : "—"}
                        </b>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4">
                  <div className="rounded-lg bg-white/6 ring-1 ring-white/10 p-3">
                    <div className="text-[11px] uppercase tracking-wide opacity-75 inline-flex items-center gap-1">
                      <FaCoins /> Argent
                    </div>
                    <div className="text-base font-semibold">
                      {profile.money != null ? `${profile.money}₽` : "—"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/6 ring-1 ring-white/10 p-3">
                    <div className="text-[11px] uppercase tracking-wide opacity-75 inline-flex items-center gap-1">
                      <FaClock /> Temps
                    </div>
                    <div className="text-base font-semibold">
                      {profile.playTimeSec != null
                        ? (() => {
                            const s = profile.playTimeSec | 0;
                            const m = Math.floor(s / 60);
                            const r = s % 60;
                            return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
                          })()
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/6 ring-1 ring-white/10 p-3">
                    <div className="text-[11px] uppercase tracking-wide opacity-75 inline-flex items-center gap-1">
                      <FaCalendarDays /> Début
                    </div>
                    <div className="text-base font-semibold">
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

                <div className="mt-3 inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-sm opacity-85">
                    <FaBookOpen className="opacity-80" />
                    Pokédex :
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md bg-white/8 px-2 py-1 ring-1 ring-white/10">
                    <FaEye />
                    <b>{profile.pokedex?.seen ?? "?"}</b>
                    <span className="opacity-80 text-xs">vus</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md bg-white/8 px-2 py-1 ring-1 ring-white/10">
                    <FaCircleCheck />
                    <b>{profile.pokedex?.caught ?? "?"}</b>
                    <span className="opacity-80 text-xs">capturés</span>
                  </span>
                </div>
              </div>

              {profile.team?.length ? (
                <div>
                  <div className="text-white/80 text-sm mb-2">Équipe</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {profile.team.map((m, i) => {
                      const root =
                        lastSavePath ? rootFromSavePath(lastSavePath, installDir) : installDir;
                      const { list } = monIconCandidates(root, m);

                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 p-2"
                        >
                          <div className="w-10 h-10 rounded-md bg-black/20 grid place-items-center overflow-hidden">
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
                              className="max-w-full max-h-full object-contain"
                              alt=""
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">Nv. {m.level ?? "—"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <div className="journal-layer">
          <Card title="Journal">
            <div className="text-sm space-y-1 max-h-64 overflow-auto">
              {log.length === 0 ? (
                <div className="text-white/60">Aucun événement pour le moment.</div>
              ) : (
                log.map((l, i) => (
                  <div key={i} className="text-white/80">
                    {l}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

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
    </div>
  );
}
