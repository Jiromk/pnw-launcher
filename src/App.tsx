import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Card, Button, Progress } from "./ui";
import type { Manifest } from "./types";
import {
  FaFolderOpen,
  FaGithub,
  FaPlay,
  FaDownload,
  FaPause,
  FaStop,
  FaRotateRight,
  FaWandMagicSparkles,
} from "react-icons/fa6";

/* -------------------- Constantes -------------------- */
const MANIFEST_URL =
  "https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/latest.json";
const LOGO =
  "https://images-ext-1.discordapp.net/external/8aBjWgdfMWrEKmwjq_N3mavMjtYTAXRSk9ApxLbvMTA/%3Fcb%3D20231013130752%26path-prefix%3Dfr/https/static.wikia.nocookie.net/pokemon-new-world-fr/images/e/e7/Ygdgydgzydz.png/revision/latest?format=webp&width=1522&height=856";

/* -------------------- Types & utils -------------------- */
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

function getZipUrl(m: Manifest): string {
  return (m as any).downloadUrl || (m as any).zip_url || "";
}
function cmpSemver(a: string, b: string) {
  const A = a.split(".").map((n) => +n);
  const B = b.split(".").map((n) => +n);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(1)} ${u[i]}`;
}
function fmtTime(s?: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
function prependUnique(list: string[], line: string) {
  return list[0] === line ? list : [line, ...list];
}

/* -------------------- Bouton avec icône -------------------- */
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
    sm: { pad: "px-3 py-2", iconBox: "w-6 h-6", icon: "text-[12px]", gap: "gap-2", text: "text-sm" },
    md: { pad: "px-4 py-2.5", iconBox: "w-7 h-7", icon: "text-[14px]", gap: "gap-2.5", text: "text-sm" },
    lg: { pad: "px-5 py-3", iconBox: "w-9 h-9", icon: "text-[16px]", gap: "gap-3", text: "text-base" },
  }[size];

  const tones: Record<NonNullable<IconButtonProps["tone"]>, string> = {
    primary:
      "bg-gradient-to-br from-blue-500/90 to-indigo-500/90 hover:from-blue-500 hover:to-indigo-500 ring-1 ring-white/10",
    secondary:
      "bg-white/10 hover:bg-white/15 ring-1 ring-white/15",
    ghost:
      "bg-white/6 hover:bg-white/10 ring-1 ring-white/10",
  };

  return (
    <Button
      className={[
        "btn-ink group relative rounded-xl shadow-[0_8px_25px_-10px_rgba(0,0,0,0.6)]",
        "backdrop-blur transition-all active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50",
        sizes.pad, sizes.gap, sizes.text, tones[tone], className,
      ].join(" ")}
      {...props}
    >
      <span
        className={[
          "grid place-items-center rounded-lg bg-white/12 ring-1 ring-white/15 shadow-inner shadow-black/20",
          sizes.iconBox, "transition-transform duration-200 group-active:scale-95",
        ].join(" ")}
      >
        <span className={sizes.icon}>{icon}</span>
      </span>
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
  const [log, setLog] = useState<string[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [installDir, setInstallDir] = useState<string>("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [hasGame, setHasGame] = useState(false);
  const [openFolderMenu, setOpenFolderMenu] = useState(false);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    const un1 = listen<DlEvent>("pnw://progress", (e) => {
      const p = e.payload;
      if (p.stage === "paused") { setStatus("paused"); return; }
      if (p.stage === "canceled") { setStatus("ready"); setProgress(0); setEta("—"); setSpeed("—/s"); return; }
      if (p.stage === "done") { setStatus("done"); setProgress(100); setEta("0:00"); check(); return; }
      if (p.stage === "download") {
        setStatus("downloading");
        const tot = p.total || 0, dl = p.downloaded || 0;
        setProgress(tot ? (dl / tot) * 100 : 0);
        setEta(fmtTime(p.eta_secs ?? null));
        setSpeed(p.speed_bps ? `${fmtBytes(p.speed_bps)}/s` : "—/s");
        return;
      }
      if (p.stage === "extract") setStatus("extracting");
    });
    const un2 = listen<any>("pnw://error", (e) =>
      setLog((l) => prependUnique(l, `Erreur: ${e.payload?.error}`))
    );
    return () => { un1.then((f) => f()); un2.then((f) => f()); };
  }, []);

  async function fetchManifest() {
    const m = await invoke<Manifest>("cmd_fetch_manifest", { manifestUrl: MANIFEST_URL });
    setManifest(m); return m;
  }

  async function readInstallInfo() {
    const info = await invoke<{ installDir: string; hasGame: boolean; version: string | null; }>(
      "cmd_get_install_info", {}
    );
    setInstallDir(info.installDir);
    setHasGame(info.hasGame);
    setInstalledVersion(info.version);
    return info;
  }

  async function check() {
    try {
      setStatus("checking");
      const [m, info] = await Promise.all([fetchManifest(), readInstallInfo()]);

      // Robustesse : on considère installé si on a un .version OU un exe
      const installed = info.hasGame || !!info.version;
      const remoteV = m?.version ?? null;
      const localV = info.version;

      let needUpdate = false;
      if (installed && remoteV) {
        needUpdate = localV ? cmpSemver(localV, remoteV) < 0 : true; // si pas de version locale connue ⇒ on suppose MAJ
      }

      setStatus("ready");

      const line = installed
        ? (needUpdate
            ? `Jeu pas à jour (local v${localV ?? "?"} → distante v${remoteV ?? "?"})`
            : `À jour (v${localV ?? "?"})`)
        : "Jeu non installé";

      setLog((l) => prependUnique(l, line));

      // Réinjecter ce qu’on a calculé côté UI
      setHasGame(installed);
      setInstalledVersion(localV ?? null);
      setManifest(m);
    } catch (e: any) {
      setStatus("error");
      setLog((l) => prependUnique(l, `Erreur check: ${String(e)}`));
    }
  }

  async function chooseFolder() {
    try {
      const dir = await open({
        title: "Choisir un dossier d’installation",
        directory: true, multiple: false, defaultPath: installDir || "C:\\",
      });
      if (!dir) { setLog((l) => prependUnique(l, "Sélection de dossier annulée.")); return; }
      await invoke("cmd_set_install_dir", { path: String(dir) });
      setInstallDir(String(dir));
      setLog((l) => prependUnique(l, `Dossier d'installation: ${dir}`));
      await check();
    } catch (e: any) {
      setLog((l) => prependUnique(l, `Erreur d’ouverture du sélecteur: ${String(e)}`));
    }
  }

  async function autoDetect() {
    try {
      // Si tu as un command Rust dédié, remplace par: invoke("cmd_detect_install_dir")
      // Sinon on force juste un check() qui va tenter de (re)déduire les infos depuis le dossier courant.
      await invoke("cmd_get_install_info", {});
      await check();
      setLog((l) => prependUnique(l, "Détection automatique effectuée."));
    } catch (e: any) {
      setLog((l) => prependUnique(l, `Détection impossible: ${String(e)}`));
    }
  }

  function installOrUpdate() {
    if (!manifest) { setLog((l) => prependUnique(l, "Manifest indisponible")); return; }
    if (!getZipUrl(manifest)) { setLog((l) => prependUnique(l, "Manifest sans URL (downloadUrl/zip_url).")); return; }
    setStatus("downloading"); setProgress(0); setEta("—"); setSpeed("—/s");
    invoke("cmd_download_and_install", { manifest });
  }
  const pause = () => invoke("cmd_pause_download");
  const resume = () => invoke("cmd_resume_download");
  const cancel = () => invoke("cmd_cancel_download");

  useEffect(() => {
    check();
    pollingRef.current = window.setInterval(check, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // État d’action principal
  const installed = hasGame || !!installedVersion;
  const needUpdate =
    installed && manifest
      ? (installedVersion ? cmpSemver(installedVersion, manifest.version) < 0 : true)
      : false;

  return (
    <div className="min-h-screen">
      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO} alt="logo"
              className="w-10 h-10 object-contain rounded-md ring-1 ring-white/20 bg-white/5" />
            <h1 className="text-2xl font-bold">PNW — Launcher</h1>
          </div>
          <div className="flex gap-3">
            <IconButton tone="ghost" size="sm" icon={<FaRotateRight />} label="Rafraîchir" onClick={check} />
            <IconButton tone="ghost" size="sm" icon={<FaGithub />} label="GitHub"
              onClick={() => window.open("https://github.com/Jiromk/pnw-launcher", "_blank")} />
          </div>
        </header>

        {/* HERO */}
        <section className="hero p-6">
          <div className="flex items-center gap-6">
            <img src={LOGO} alt="logo"
              className="w-20 h-20 object-contain rounded-xl ring-1 ring-white/10 bg-white/5" />

            <div className="flex-1">
              <div>Chemin d’installation : <b className="text-white/95">{installDir || "—"}</b></div>
              <div>Installé : <b>{installed ? "Oui" : "Non"}</b></div>
              <div>Version locale : <b>{installedVersion ?? "—"}</b></div>
              <div>Version distante : <b>{manifest?.version ?? "…"}</b></div>
            </div>

            {/* Actions droite */}
            <div className="relative z-40 flex flex-col gap-2">
              {/* Dossier + menu */}
              <div className="relative">
                <IconButton
                  icon={<FaFolderOpen />}
                  label={<span className="inline-flex items-center gap-2">Dossier <span className="text-white/80">▾</span></span>}
                  onClick={() => setOpenFolderMenu((o) => !o)}
                />
                {openFolderMenu && (
                  <div
                    className="absolute right-0 mt-2 w-64 rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur
                               shadow-xl z-[999]"
                    onMouseLeave={() => setOpenFolderMenu(false)}
                  >
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-t-xl flex items-center gap-2"
                      onClick={() => { setOpenFolderMenu(false); chooseFolder(); }}
                    >
                      <FaFolderOpen /> Choisir un dossier…
                    </button>
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 rounded-b-xl flex items-center gap-2"
                      onClick={() => { setOpenFolderMenu(false); autoDetect(); }}
                    >
                      <FaWandMagicSparkles /> Détecter automatiquement
                    </button>
                  </div>
                )}
              </div>

              {/* Action principale selon l’état */}
              {!installed ? (
                <IconButton icon={<FaDownload />} label="Télécharger le jeu" onClick={installOrUpdate} />
              ) : needUpdate ? (
                <IconButton icon={<FaDownload />} label="Mettre à jour" onClick={installOrUpdate} />
              ) : (
                <IconButton
                  tone="secondary" icon={<FaPlay />} label="Lancer"
                  onClick={() =>
                    invoke("cmd_launch_game", { exeName: (manifest as any)?.game_exe || "Pokemon New World.exe" })
                  }
                  disabled={!installed}
                />
              )}
            </div>
          </div>

          {(status === "downloading" || status === "paused" || status === "extracting") && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm opacity-80">
                <div>{status === "downloading" && "Téléchargement…"}
                     {status === "paused" && "En pause"}
                     {status === "extracting" && "Extraction…"}</div>
                <div>Temps: <b>{eta}</b> • Débit: <b>{speed}</b></div>
              </div>
              <Progress value={progress} />
              <div className="flex gap-2">
                {status !== "paused" && status !== "extracting" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPause />} label="Pause" onClick={pause} />
                )}
                {status === "paused" && (
                  <IconButton tone="ghost" size="sm" icon={<FaPlay />} label="Reprendre" onClick={resume} />
                )}
                {(status === "downloading" || status === "paused") && (
                  <IconButton tone="ghost" size="sm" icon={<FaStop />} label="Annuler" onClick={cancel} />
                )}
              </div>
            </div>
          )}
        </section>

        {/* JOURNAL */}
        <div className="journal-layer">
          <Card title="Journal">
            <div className="text-sm space-y-1 max-h-64 overflow-auto">
              {log.map((l, i) => (
                <div key={i} className="text-white/80">{l}</div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
