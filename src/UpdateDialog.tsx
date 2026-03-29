// src/UpdateDialog.tsx
import React from "react";
import { Button } from "./ui";
import { FaDownload, FaX, FaSpinner } from "react-icons/fa6";
import type { Manifest as RemoteManifest } from "./types";

type UpdateDialogProps = {
  open: boolean;
  currentVersion: string;
  remoteManifest: RemoteManifest;
  onUpdate: () => void;
  onCancel: () => void;
  isUpdating?: boolean;
  patchnotes?: string | null;
  patchnotesLoading?: boolean;
  patchnotesError?: string | null;
  patchnotesUrl?: string | null;
};

export function UpdateDialog({
  open,
  currentVersion,
  remoteManifest,
  onUpdate,
  onCancel,
  isUpdating = false,
  patchnotes,
  patchnotesLoading = false,
  patchnotesError = null,
  patchnotesUrl = null,
}: UpdateDialogProps) {
  if (!open) return null;

  const hasPatchnotes = !!(patchnotes && patchnotes.trim().length > 0);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="pnw-update-overlay absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={!isUpdating ? onCancel : undefined} />
      <div className="pnw-update-content relative w-[min(600px,92vw)] rounded-2xl border border-white/20 bg-gradient-to-b from-[#1a1f3a] via-[#0f1629] to-[#0c1222] shadow-2xl p-6">
        {/* Header avec icône */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-xl accent-glow-inner flex items-center justify-center ring-1 ring-white/10 bg-white/5">
            <FaDownload className="text-3xl text-[var(--accent)]" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-1">Mise à jour disponible</h2>
            <p className="text-sm text-white/70">Une nouvelle version du jeu est prête</p>
          </div>
          {!isUpdating && (
            <button
              onClick={onCancel}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <FaX className="text-white/70" />
            </button>
          )}
        </div>

        {/* Version info avec badge */}
        <div className="mb-6 p-4 rounded-xl accent-glow-inner bg-white/5 ring-1 ring-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/70">Version actuelle</span>
            <span className="px-3 py-1 rounded-lg bg-white/10 text-sm font-semibold text-white/90">
              v{currentVersion}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/70">Nouvelle version</span>
            <span className="px-3 py-1 rounded-lg accent-glow-badge text-sm font-bold text-white/95">
              v{remoteManifest.version}
            </span>
          </div>
        </div>

        {/* Patchnotes */}
        <div className="mb-6 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide opacity-75 font-semibold text-white/90">
              📄 Patchnotes
            </div>
            {patchnotesUrl && (
              <a
                href={patchnotesUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-amber-200 hover:text-amber-100 underline offset-2"
              >
                Ouvrir sur GitHub
              </a>
            )}
          </div>

          {patchnotesLoading ? (
            <div className="flex items-center gap-2 text-sm text-white/80">
              <FaSpinner className="animate-spin" /> Chargement des patchnotes…
            </div>
          ) : patchnotesError ? (
            <div className="text-sm text-amber-200 leading-relaxed">
              {patchnotesError}
            </div>
          ) : hasPatchnotes ? (
            <div className="max-h-72 overflow-y-auto text-sm text-white/85 leading-relaxed whitespace-pre-wrap">
              {patchnotes}
            </div>
          ) : (
            <div className="text-sm text-white/60">Patchnotes indisponibles pour cette mise à jour.</div>
          )}
        </div>

        {/* Antivirus warning */}
        <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100 shadow-inner">
          <div className="font-semibold text-amber-200 mb-2">⚠️ Note sur les antivirus</div>
          <p className="leading-relaxed">
            Si votre antivirus est actif, il peut bloquer la mise à jour lorsque le jeu est installé dans des emplacements
            protégés (Bureau, Documents, OneDrive, etc.). Pour garantir le bon déroulement :
          </p>
          <ul className="mt-3 space-y-1 list-disc list-inside">
            <li>Suspendre la protection le temps de la mise à jour&nbsp;;</li>
            <li>ou déplacer le dossier du jeu vers un emplacement moins restreint (ex. <code>C:\Jeux\PNW</code>).</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            Pensez à réactiver votre protection ensuite ou à ajouter le launcher et le dossier du jeu aux exclusions.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {!isUpdating ? (
            <>
              <Button
                onClick={onCancel}
                className="flex-1 bg-white/10 hover:bg-white/15 text-white/90 ring-1 ring-white/20"
              >
                Plus tard
              </Button>
              <Button
                onClick={onUpdate}
                className="flex-1 accent-glow-btn hover:brightness-110 text-white font-semibold shadow-lg"
              >
                <FaDownload className="mr-2" />
                Mettre à jour
              </Button>
            </>
          ) : (
            <Button
              disabled
              className="flex-1 accent-glow-btn text-white font-semibold shadow-lg cursor-not-allowed opacity-70"
            >
              <FaSpinner className="mr-2 animate-spin" />
              Mise à jour en cours...
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

