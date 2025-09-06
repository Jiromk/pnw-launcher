import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress } from "./ui";
import type { Manifest } from "./types";

// Font Awesome v5
import {
  FaFolderOpen,
  FaSyncAlt,
  FaGithub,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaTrashAlt,
  FaClock,
  FaSearch,
  FaCaretDown,
} from "react-icons/fa";

/* -------------------- Constantes -------------------- */

const MANIFEST_URL =
  "https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/latest.json";
const LOGO =
  "https://images-ext-1.discordapp.net/external/8aBjWgdfMWrEKmwjq_N3mavMjtYTAXRSk9ApxLbvMTA/%3Fcb%3D20231013130752%26path-prefix%3Dfr/https/static.wikia.nocookie.net/pokemon-new-world-fr/images/e/e7/Ygdgydgzydz.png/revision/latest?format=webp&width=1522&height=856";

/* -------------------- Types -------------------- */

type DlEvent = {
  stage: "download" | "extract" | "paused" | "canceled" | "done";
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
  | "error";

/* -------------------- Utils -------------------- */

function getZipUrl(m: Manifest): string {
  return (m as any).downloadUrl || (m as any).zip_url || "";
}
function cmpSemver(a?: string | null, b?: string | null) {
  if (!a || !b) return 0;
  const A = a.split(".").map((n) => +n);
  const B = b.split(".").map((n) => +n);
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
function dedup(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/* -------------------- Bouton stylé -------------------- */

type IconButtonProps = React.ComponentProps<typeof Button> & {
  icon: React.ReactNode;
  label: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "primary" | "secondary" | "ghost";
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

  const tones: Record<typeof tone, string> = {
    primary:
      "bg-gradient-to-br from-blue-500/90 to-indigo-500/90 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] ring-1 ring-white/10 text-white",
    secondary:
      "bg-white/10 hover:bg-white/15 active:scale-[0.99] ring-1 ring-white/15 text-white/90",
    ghost:
      "bg-white/6 hover:bg-white/10 active:scale-[0.99] ring-1 ring-white/10 text-white/90",
  };

  return (
    <Button
      className={[
        "group relative rounded-xl shadow-[0_8px_25px_-10px_rgba(0,0,0,0.6)]",
        "backdrop-blur supports-[backdrop-filter]:bg-opacity-80 transition-all",
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
          "grid place-items-center rounded-lg",
          "bg-white/12 ring-1 ring-white/15",
          "shadow-inner shadow-black/20",
          sizes.iconBox,
          "transition-transform duration-200 group-active:scale-95",
        ].join(" ")}
      >
        <span className={sizes.icon}>{icon}</span>
      </span>
      <span className="font-medium tracking-wide">{label}</span>
      <span className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/6 to-white/0" />
      </span>
    </Button>
  );
}

/* Un bouton “Dossier ▾” avec menu */
function FolderDropdown({
  onChoose,
  onAuto,
}: {
  onChoose: () => void;
  onAuto: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <IconButton
        icon={<FaFolderOpen />}
        label={
          <span className="flex items-center gap-2">
            Dossier <FaCaretDown className="opacity-80" />
          </span>
        }
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-zinc-900/90 ring-1 ring-white/10 shadow-2xl backdrop-blur p-1 z-50">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-left"
            onClick={() => {
              setOpen(false);
              onChoose();
            }}
          >
            <FaFolderOpen className="opacity-80" />
            <span>Choisir un dossier…</span>
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 text-left"
            onClick={() => {
              setOpen(false);
              onAuto();
            }}
          >
            <FaSearch className="opacity-80" />
            <span>Détecter automatiquement</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------- App -------------------- */

export default function App() {
  const [status, setStatus] = useState<UiState>("idle");
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string>("—");
  const [speed, setSpeed] = useState<string>("—/s");
  const [log, setLog] = useState<string[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [installDir, setInstallDir] = useState<string>("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [hasGame, setHasGame] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const isInstalled = !!installedVersion || hasGame;
  const remoteVersion = manifest?.version ?? null;
  const needsUpdate =
    isInstalled && !!remoteVersion && !!installedVersion
      ? cmpSemver(installedVersion, remoteVersion) < 0
      : false;

  useEffect(() => {
    const un1 = listen<DlEvent>("pnw://progress", (e) => {
      const p = e.payload;
      if (p.stage === "paused") {
        setStatus("paused");
        return;
      }
      if (p.stage === "canceled") {
        setStatus("ready");
        setProgress(0);
        setEta("—");
        setSpeed("—/s");
        return;
      }
      if (p.stage === "done") {
        setStatus("done");
        setProgress(100);
        setEta("0:00");
        check();
        return;
      }
      if (p.stage === "download") {
        setStatus("downloading");
        const tot = p.total || 0;
        const dl = p.downloaded || 0;
        setProgress(tot ? (dl / tot) * 100 : 0);
        setEta(fmtTime(p.eta_secs ?? null));
        setSpeed(p.speed_bps ? `${fmtBytes(p.speed_bps)}/s` : "—/s");
        return;
      }
      if (p.stage === "extract") {
        setStatus("extracting");
      }
    });
    const un2 = listen<any>("pnw://error", (e) =>
      setLog((l) => dedup([`Erreur: ${e.payload?.error}`, ...l]))
    );
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  async function fetchManifest() {
    const m = await invoke<Manifest>("cmd_fetch_manifest", {
      manifestUrl: MANIFEST_URL,
    });
    setManifest(m);
    return m;
  }
  async function readInstallInfo() {
    const info = await invoke<{
      installDir: string;
      hasGame: boolean;
      version: string | null;
    }>("cmd_get_install_info", {});
    setInstallDir(info.installDir);
    setHasGame(info.hasGame);
    setInstalledVersion(info.version);
    return info;
  }

  async function check() {
    try {
      setStatus("checking");
      const [m, info] = await Promise.all([fetchManifest(), readInstallInfo()]);
      const installed = !!info.version || info.hasGame;
      const update =
        installed && m?.version && info.version
          ? cmpSemver(info.version, m.version) < 0
          : false;

      setStatus("ready");
      setLog((l) =>
        dedup([
          installed
            ? update
              ? `Jeu pas à jour (local v${info.version} → distante v${m.version})`
              : `À jour (v${info.version ?? "—"})`
            : "Jeu non installé",
          ...l,
        ])
      );
    } catch (e: any) {
      setStatus("error");
      setLog((l) => dedup([`Erreur check: ${String(e)}`, ...l]));
    }
  }

  async function chooseFolder() {
    try {
      const dir = await open({
        title: "Choisir un dossier d’installation",
        directory: true,
        multiple: false,
        defaultPath: installDir || "C:\\",
      });
      if (!dir) {
        setLog((l) => dedup(["Sélection de dossier annulée.", ...l]));
        return;
      }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      setLog((l) => dedup([`Dossier d'installation: ${dir}`, ...l]));
      await check();
    } catch (e: any) {
      setLog((l) => dedup([`Erreur d’ouverture du sélecteur: ${String(e)}`, ...l]));
    }
  }

  async function autoDetectFolder() {
    try {
      const res = await invoke<{
        found: boolean;
        installDir?: string;
        reason?: string;
      }>("cmd_autodetect_install", { manifest }); // Rust va scanner
      if (res.found && res.installDir) {
        setInstallDir(res.installDir);
        setLog((l) =>
          dedup([`Chemin détecté automatiquement: ${res.installDir}`, ...l])
        );
        await check();
      } else {
        setLog((l) =>
          dedup([
            `Aucun dossier détecté automatiquement${
              res.reason ? ` (${res.reason})` : ""
            }.`,
            ...l,
          ])
        );
      }
    } catch (e: any) {
      setLog((l) => dedup([`Erreur détection auto: ${String(e)}`, ...l]));
    }
  }

  function installOrUpdate() {
    if (!manifest) {
      setLog((l) => dedup(["Manifest indisponible", ...l]));
      return;
    }
    if (!getZipUrl(manifest)) {
      setLog((l) => dedup(["Manifest sans URL (downloadUrl/zip_url).", ...l]));
      return;
    }
    setStatus("downloading");
    setProgress(0);
    setEta("—");
    setSpeed("—/s");
    invoke("cmd_download_and_install", { manifest });
  }
  const pause = () => invoke("cmd_pause_download");
  const resume = () => invoke("cmd_resume_download");
  const cancel = () => invoke("cmd_cancel_download");

  useEffect(() => {
    check();
    pollingRef.current = window.setInterval(check, 5 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={LOGO}
              alt="logo"
              className="w-10 h-10 object-contain rounded-md ring-1 ring-white/20 bg-white/5"
            />
            <h1 className="text-2xl font-bold">PNW — Launcher</h1>
          </div>

          <div className="flex gap-3">
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaSyncAlt />}
              label="Rafraîchir"
              onClick={check}
            />
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaGithub />}
              label="GitHub"
              onClick={() =>
                window.open("https://github.com/Jiromk/pnw-launcher", "_blank")
              }
            />
          </div>
        </header>

        {/* Statut */}
        <section className="hero p-6">
          <div className="flex items-center gap-6">
            <img
              src={LOGO}
              alt="logo"
              className="w-20 h-20 object-contain rounded-xl ring-1 ring-white/10 bg-white/5"
            />

            <div className="flex-1">
              <div>
                Chemin d’installation :{" "}
                <b className="text-white/95">{installDir || "—"}</b>
              </div>
              <div>
                Installé : <b>{(!!installedVersion || hasGame) ? "Oui" : "Non"}</b>
              </div>
              <div>
                Version locale : <b>{installedVersion ?? "—"}</b>
              </div>
              <div>
                Version distante : <b>{manifest?.version ?? "…"}</b>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <FolderDropdown
                onChoose={chooseFolder}
                onAuto={autoDetectFolder}
              />

              {!((!!installedVersion) || hasGame) ? (
                <IconButton
                  icon={<FaDownload />}
                  label="Télécharger le jeu"
                  onClick={installOrUpdate}
                />
              ) : (installedVersion && manifest?.version && cmpSemver(installedVersion, manifest.version) < 0) ? (
                <IconButton
                  icon={<FaDownload />}
                  label="Mettre à jour"
                  onClick={installOrUpdate}
                />
              ) : (
                <IconButton
                  tone="secondary"
                  icon={<FaPlay />}
                  label="Lancer"
                  onClick={() =>
                    invoke("cmd_launch_game", {
                      exeName: (manifest as any)?.game_exe || "Pokemon New World.exe",
                    })
                  }
                />
              )}
            </div>
          </div>

          {(status === "downloading" ||
            status === "paused" ||
            status === "extracting") && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="opacity-80">
                  {status === "downloading" && "Téléchargement…"}
                  {status === "paused" && "En pause"}
                  {status === "extracting" && "Extraction…"}
                </div>
                <div className="opacity-80">
                  Temps: <b>{eta}</b> • Débit: <b>{speed}</b>
                </div>
              </div>

              <Progress value={progress} />

              <div className="flex gap-2">
                {status !== "paused" && status !== "extracting" && (
                  <IconButton
                    tone="ghost"
                    size="sm"
                    icon={<FaPause />}
                    label="Pause"
                    onClick={pause}
                  />
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
                {(status === "downloading" || status === "paused") && (
                  <IconButton
                    tone="ghost"
                    size="sm"
                    icon={<FaStop />}
                    label="Annuler"
                    onClick={cancel}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* Journal */}
        <Card
          title={
            <div className="flex items-center justify-between w-full">
              <span>Journal</span>
              <IconButton
                tone="ghost"
                size="sm"
                icon={<FaTrashAlt />}
                label="Vider"
                onClick={() => setLog([])}
              />
            </div>
          }
        >
          <div className="text-sm space-y-2 max-h-64 overflow-auto">
            {log.length === 0 ? (
              <div className="opacity-70">—</div>
            ) : (
              log.map((l, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 ring-1 ring-white/10"
                >
                  <FaClock className="opacity-70" />
                  <span className="opacity-70 w-14">
                    {new Date().toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-white/90">{l}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
