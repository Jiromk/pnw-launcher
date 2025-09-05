import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card, Button, Progress } from "./ui";
import type { Manifest } from "./types";

const APP_NAME = "Pokémon New World";
const MANIFEST_URL = "https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/latest.json";

type DlEvent = { downloaded: number; total: number; stage: "download" | "extract" };

export default function App(){
  const [status, setStatus] = useState<"idle"|"checking"|"ready"|"downloading"|"extracting"|"done"|"error">("idle");
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
    <div className="min-h-screen bg-bg text-text">
      <div className="max-w-[980px] mx-auto p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{APP_NAME} — Launcher</h1>
          <Button onClick={() => window.open("https://github.com/Jiromk/pnw-launcher", "_blank")}>GitHub</Button>
        </header>

        <Card className="mb-6">
          <div className="flex items-center gap-6">
            <img src="https://raw.githubusercontent.com/Jiromk/pnw-launcher/main/icon.png"
                 alt="logo" className="w-16 h-16 rounded-xl ring-1 ring-white/10"/>
            <div className="flex-1">
              <div className="text-lg font-semibold">Version installée : {installedVersion ?? "—"}</div>
              <div className="text-muted">Dernière version : {manifest?.version ?? "…"}</div>
            </div>
            <div className="flex gap-3">
              <Button onClick={check}>Rafraîchir</Button>
              {needsUpdate ? (
                <Button onClick={install}>Mettre à jour</Button>
              ) : (
                <Button onClick={launch} disabled={!installedPath}>Lancer le jeu</Button>
              )}
            </div>
          </div>
          <div className="mt-4">
            {(status === "downloading" || status === "extracting") && (
              <div className="space-y-2">
                <Progress value={progress}/>
                <div className="text-sm text-muted">{status === "downloading" ? "Téléchargement…" : "Extraction…"}</div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Journal">
          <div className="text-sm space-y-1 max-h-64 overflow-auto">
            {log.map((l, i) => <div key={i} className="text-muted">{l}</div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
