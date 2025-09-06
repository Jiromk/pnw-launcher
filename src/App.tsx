import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress } from "./ui";
import type { Manifest } from "./types";

import {
  FaFolderOpen,
  FaRotateRight,
  FaGithub,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaCircleInfo,
  FaTriangleExclamation,
  FaCircleCheck,
  FaCircleXmark,
  FaTrash,
} from "react-icons/fa6";

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

type LogLevel = "info" | "ok" | "warn" | "error";
type LogEntry = { id: number; t: number; level: LogLevel; text: string };

/* -------------------- Utils -------------------- */

function getZipUrl(m: Manifest): string {
  return (m as any).downloadUrl || (m as any).zip_url || "";
}
function cmpSemver(a: string, b: string) {
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
function fmtTimeHMS(ts: number) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
function fmtEta(s?: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60),
    r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/* -------------------- Bouton icône+label -------------------- */

type IconButtonProps = React.ComponentProps<typeof Button> & {
  icon: React.ReactNode;
  label: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
};

function IconButton({
  icon,
  label,
  tone = "primary",
  size = "md",
  className = "",
  ...props
}: IconButtonProps) {
  const sizeCls =
    size === "sm"
      ? "px-3 py-2 text-sm"
      : size === "lg"
      ? "px-5 py-3 text-base"
      : "px-4 py-2.5 text-sm";
  const toneCls =
    tone === "secondary"
      ? "bg-white/10 hover:bg-white/15 ring-1 ring-white/15 text-white/90"
      : tone === "ghost"
      ? "bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white/90"
      : "bg-gradient-to-br from-blue-500/90 to-indigo-500/90 hover:from-blue-500 hover:to-indigo-500 ring-1 ring-white/10 text-white";

  return (
    <Button className={[sizeCls, toneCls, className].join(" ")} {...props}>
      <span className="text-[1.05rem]">{icon}</span>
      <span className="font-medium tracking-wide">{label}</span>
    </Button>
  );
}

/* -------------------- App -------------------- */

export default function App() {
  const [status, setStatus] = useState<UiState>("idle");
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string>("—");
  const [speed, setSpeed] = useState<string>("—/s");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [installDir, setInstallDir] = useState<string>("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [hasGame, setHasGame] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const idRef = useRef(1);

  /* ---- gestion log : horodaté + anti-doublon ---- */
  function addLog(text: string, level: LogLevel = "info") {
    setLogs((prev) => {
      if (prev[0]?.text === text) return prev; // éviter doublon consécutif
      const entry: LogEntry = {
        id: idRef.current++,
        t: Date.now(),
        level,
        text,
      };
      return [entry, ...prev].slice(0, 50);
    });
  }

  /* ---- events DL ---- */
  useEffect(() => {
    const un1 = listen<DlEvent>("pnw://progress", (e) => {
      const p = e.payload;
      if (p.stage === "paused") return setStatus("paused");
      if (p.stage === "canceled") {
        setStatus("ready");
        setProgress(0);
        setEta("—");
        setSpeed("—/s");
        addLog("Téléchargement annulé", "warn");
        return;
      }
      if (p.stage === "done") {
        setStatus("done");
        setProgress(100);
        setEta("0:00");
        addLog("Installation terminée", "ok");
        check();
        return;
      }
      if (p.stage === "download") {
        setStatus("downloading");
        const tot = p.total || 0;
        const dl = p.downloaded || 0;
        setProgress(tot ? (dl / tot) * 100 : 0);
        setEta(fmtEta(p.eta_secs ?? null));
        setSpeed(p.speed_bps ? `${fmtBytes(p.speed_bps)}/s` : "—/s");
        return;
      }
      if (p.stage === "extract") {
        setStatus("extracting");
        addLog("Extraction…", "info");
      }
    });
    const un2 = listen<any>("pnw://error", (e) =>
      addLog(`Erreur: ${e.payload?.error}`, "error")
    );
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  /* ---- API ---- */
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
      const need =
        m?.version
          ? info.version
            ? cmpSemver(info.version, m.version) < 0
            : !!info.hasGame
          : false;
      setStatus("ready");

      if (!info.hasGame) addLog("Jeu non installé", "warn");
      else if (need) addLog(`MAJ disponible → v${m.version}`, "warn");
      else addLog(`À jour (v${info.version ?? "—"})`, "ok");
    } catch (e: any) {
      setStatus("error");
      addLog(`Erreur check: ${String(e)}`, "error");
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
        addLog("Sélection de dossier annulée.", "info");
        return;
      }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      addLog(`Dossier d'installation: ${dir}`, "ok");
      await check();
    } catch (e: any) {
      addLog(`Erreur d’ouverture: ${String(e)}`, "error");
    }
  }

  function installOrUpdate() {
    if (!manifest) return addLog("Manifest indisponible", "error");
    if (!getZipUrl(manifest)) return addLog("Manifest sans URL valide", "error");

    setStatus("downloading");
    setProgress(0);
    setEta("—");
    setSpeed("—/s");
    addLog("Téléchargement…", "info");
    invoke("cmd_download_and_install", { manifest }); // fire-and-forget
  }
  const pause = () => invoke("cmd_pause_download").then(() => addLog("Pause", "info"));
  const resume = () => invoke("cmd_resume_download").then(() => addLog("Reprise", "info"));
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

  const needInstall = !hasGame;
  const needUpdate =
    hasGame && manifest && installedVersion
      ? cmpSemver(installedVersion, manifest.version) < 0
      : false;

  /* ---- helpers UI ---- */
  const iconFor = (lvl: LogLevel) =>
    lvl === "ok" ? (
      <FaCircleCheck />
    ) : lvl === "warn" ? (
      <FaTriangleExclamation />
    ) : lvl === "error" ? (
      <FaCircleXmark />
    ) : (
      <FaCircleInfo />
    );

  const colorFor = (lvl: LogLevel) =>
    lvl === "ok"
      ? "bg-emerald-500/20 text-emerald-300"
      : lvl === "warn"
      ? "bg-amber-500/20 text-amber-300"
      : lvl === "error"
      ? "bg-rose-500/20 text-rose-300"
      : "bg-sky-500/20 text-sky-300";

  /* ---- UI ---- */
  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
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
              icon={<FaRotateRight />}
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
                Installé : <b>{hasGame ? "Oui" : "Non"}</b>
              </div>
              <div>
                Version locale : <b>{installedVersion ?? "—"}</b>
              </div>
              <div>
                Version distante : <b>{manifest?.version ?? "…"}</b>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <IconButton
                icon={<FaFolderOpen />}
                label="Choisir un dossier"
                onClick={chooseFolder}
              />

              {needInstall ? (
                <IconButton
                  icon={<FaDownload />}
                  label="Installer"
                  onClick={installOrUpdate}
                />
              ) : needUpdate ? (
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
                      exeName: (manifest as any)?.game_exe || "Game.exe",
                    })
                  }
                  disabled={!hasGame}
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

        <Card title="Journal">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm opacity-80">
              Historique des actions récentes
            </span>
            <IconButton
              tone="ghost"
              size="sm"
              icon={<FaTrash />}
              label="Vider"
              onClick={() => setLogs([])}
            />
          </div>

          <div className="loglist">
            {logs.map((e) => (
              <div key={e.id} className="logrow">
                <span className={`logicon ${colorFor(e.level)}`}>
                  {iconFor(e.level)}
                </span>
                <span className="logtime">{fmtTimeHMS(e.t)}</span>
                <span className="logtext">{e.text}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-sm opacity-70">Aucun événement pour l’instant.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
