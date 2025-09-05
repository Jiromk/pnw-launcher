import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, Button, Progress } from "./ui";
import type { Manifest } from "./types";

const MANIFEST_URL = "https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/latest.json";
const LOGO = "https://images-ext-1.discordapp.net/external/8aBjWgdfMWrEKmwjq_N3mavMjtYTAXRSk9ApxLbvMTA/%3Fcb%3D20231013130752%26path-prefix%3Dfr/https/static.wikia.nocookie.net/pokemon-new-world-fr/images/e/e7/Ygdgydgzydz.png/revision/latest?format=webp&width=1522&height=856";

type DlEvent = { downloaded: number; total: number; stage: "download" | "extract" };
type UiState = "idle"|"checking"|"ready"|"downloading"|"extracting"|"done"|"error";

export default function App(){
  const [status, setStatus] = useState<UiState>("idle");
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [installedPath, setInstalledPath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<DlEvent>("pnw://progress", (e) => {
      const { downloaded, total, stage } = e.payload;
      setStatus(stage === "download" ? "downloading" : "extracting");
      setProgress(total > 0 ? (downloaded / total) * 100 : 0);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  async function check(){
    try{
      setStatus("checking");
      const m = await invoke<Manifest>("cmd_fetch_manifest", { manifestUrl: MANIFEST_URL });
      setManifest(m);
      const info = await invoke<{installDir:string, version:string|null}>("cmd_get_install_info", {});
      setInstalledPath(info.installDir); setInstalledVersion(info.version);
      setStatus("ready");
      setLog(l => [`Manifest v${m.version}`, ...l]);
    }catch(err:any){
      setStatus("error");
      setLog(l => [`Erreur check: ${String(err)}`, ...l]);
    }
  }

  async function install(){
    if (!manifest) return;
    try{
      setLog(l => [`Téléchargement…`, ...l]);
      setStatus("downloading"); setProgress(0);
      const res = await invoke<{installDir:string, exePath:string}>("cmd_download_and_install", { manifest });
      setInstalledPath(res.installDir);
      setStatus("done"); setProgress(100);
      setLog(l => [`Installé dans ${res.installDir}`, ...l]);
    }catch(err:any){
      setStatus("error");
      setLog(l => [`Erreur install: ${String(err)}`, ...l]);
    }
  }

  async function launch(){
    try{
      await invoke("cmd_launch_game", { exeName: manifest?.game_exe || "Game.exe" });
    }catch(err:any){
      setLog(l => [`Erreur lancement: ${String(err)}`, ...l]);
    }
  }

  useEffect(() => { check(); }, []);
  const needsUpdate = manifest && manifest.version !== (installedVersion || "");

  return (
    <div className="min-h-screen">
      <div className="max-w-[1120px] mx-auto p-6 space-y-6">
        {/* Header style site */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO} alt="logo" className="w-10 h-10 object-contain rounded-md ring-1 ring-white/20 bg-white/5" />
            <h1 className="text-2xl font-bold drop-shadow">Pokémon New World — Launcher</h1>
          </div>
          <Button variant="ghost" onClick={() => window.open("https://github.com/Jiromk/pnw-launcher", "_blank")}>
            GitHub
          </Button>
        </header>

        {/* HERO avec ton fond visible */}
        <section className="hero p-6">
          <div className="relative z-10 flex items-center gap-6">
            <img src={LOGO} alt="logo" className="w-24 h-24 object-contain rounded-xl ring-1 ring-white/10 bg-white/5"/>
            <div className="flex-1">
              <div className="text-lg font-semibold">Version installée : {installedVersion ?? "—"}</div>
              <div className="text-white/80">Dernière version : {manifest?.version ?? "…"}</div>
            </div>
            <div className="flex gap-3">
              <Button onClick={check}>Rafraîchir</Button>
              {needsUpdate ? (
                <Button onClick={install}>Mettre à jour</Button>
              ) : (
                <Button variant="secondary" onClick={launch} disabled={!installedPath}>Lancer le jeu</Button>
              )}
            </div>
          </div>

          {(status === "downloading" || status === "extracting") && (
            <div className="relative z-10 mt-4 space-y-2">
              <Progress value={progress}/>
              <div className="text-sm text-white/85">
                {status === "downloading" ? "Téléchargement…" : "Extraction…"}
              </div>
            </div>
          )}
        </section>

        {/* Journal */}
        <Card title="Journal">
          <div className="text-sm space-y-1 max-h-64 overflow-auto">
            {log.map((l, i) => <div key={i} className="text-white/80">{l}</div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
