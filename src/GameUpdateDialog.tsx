// src/GameUpdateDialog.tsx
import React, { useState } from "react";
import { Button } from "./ui";
import {
  FaArrowDown,
  FaArrowUpRightFromSquare,
  FaCircleCheck,
  FaDownload,
  FaFileLines,
  FaHardDrive,
  FaPause,
  FaPlay,
  FaSpinner,
  FaStop,
} from "react-icons/fa6";
import type { PatchVersion } from "./utils/patchNotes";
import { resolveAssetUrl } from "./utils/patchNotes";
import { PatchNotesModal } from "./PatchNotesModal";

export type GameUpdateDialogLabels = {
  title: string;
  subtitle: string;
  current: string;
  newer: string;
  status: {
    downloading: string;
    paused: string;
    extracting: string;
    reconnecting: string;
  };
  remaining: string;
  pause: string;
  resume: string;
  cancel: string;
  notesTitle: (version: string) => string;
  notesLoading: string;
  notesError: string;
  notesEmpty: string;
  openNotesLink: string;
  hint: string;
};

type Props = {
  open: boolean;
  currentVersion: string;
  remoteVersion: string;
  status:
    | "idle"
    | "checking"
    | "ready"
    | "downloading"
    | "paused"
    | "extracting"
    | "done"
    | "reconnecting"
    | "error";
  progress: number;
  eta: string;
  speed: string;
  downloadedBytes?: number;
  totalBytes?: number;
  patchNotes: PatchVersion | null;
  patchNotesLoading: boolean;
  patchNotesError: string | null;
  patchNotesBaseUrl: string;
  siteUrl: string;
  labels: GameUpdateDialogLabels;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  fmtBytes: (n: number) => string;
};

export function GameUpdateDialog({
  open,
  currentVersion,
  remoteVersion,
  status,
  progress,
  eta,
  speed,
  downloadedBytes,
  totalBytes,
  patchNotes,
  patchNotesLoading,
  patchNotesError,
  patchNotesBaseUrl,
  siteUrl,
  labels,
  onPause,
  onResume,
  onCancel,
  fmtBytes,
}: Props) {
  const [patchNotesModalOpen, setPatchNotesModalOpen] = useState(false);

  if (!open) return null;

  const openPatchNotesModal = () => setPatchNotesModalOpen(true);
  const closePatchNotesModal = () => setPatchNotesModalOpen(false);

  const showPause = status === "downloading";
  const showResume = status === "paused";
  const showCancel =
    status === "downloading" || status === "paused" || status === "reconnecting";
  const isExtracting = status === "extracting";
  const pct = Math.min(100, Math.max(0, Math.round(progress)));

  const statusLabel =
    status === "downloading"
      ? labels.status.downloading
      : status === "paused"
        ? labels.status.paused
        : status === "extracting"
          ? labels.status.extracting
          : status === "reconnecting"
            ? labels.status.reconnecting
            : labels.status.downloading;

  const versionImage = patchNotes
    ? resolveAssetUrl(patchNotesBaseUrl, patchNotes.image)
    : "";

  return (
    <div className="fixed inset-0 z-[10000] overflow-y-auto bg-gradient-to-b from-[#0a1020] via-[#0d1224] to-[#080c18]">
      {/* ── Animated background orbs ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-emerald-500/[0.07] blur-[100px]"
          style={{ animation: "update-orb-1 14s ease-in-out infinite" }}
        />
        <div
          className="absolute -bottom-40 -right-40 h-[450px] w-[450px] rounded-full bg-violet-500/[0.08] blur-[100px]"
          style={{ animation: "update-orb-2 16s ease-in-out infinite" }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-[350px] w-[350px] -translate-x-1/2 rounded-full bg-sky-500/[0.05] blur-[100px]"
          style={{ animation: "update-orb-1 18s ease-in-out infinite reverse" }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* ── Main content ── */}
      <div
        className="relative z-10 mx-auto flex min-h-screen max-w-[640px] flex-col items-center justify-start px-6 py-10"
        style={{ animation: "update-page-in 0.5s ease-out both" }}
      >
        {/* Logo */}
        <img
          src="/logo.png"
          alt="PNW Launcher"
          className="mb-6 h-20 w-20 shrink-0 rounded-2xl object-contain shadow-[0_8px_40px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
          draggable={false}
        />

        {/* Animated icon */}
        <div
          className="relative mb-6 flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/[0.08] to-white/[0.02] ring-1 ring-white/15"
          style={{ animation: "update-glow-pulse 4s ease-in-out infinite" }}
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400/20 to-transparent" />
          <FaDownload
            className="relative text-3xl text-emerald-300 drop-shadow-[0_0_16px_rgba(52,211,153,0.45)]"
            style={{ animation: "update-icon-float 3s ease-in-out infinite" }}
          />
        </div>

        {/* Title */}
        <h1 className="mb-3 text-center text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {labels.title}
        </h1>
        <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-white/55 sm:text-base">
          {labels.subtitle}
        </p>

        {/* Version comparison card */}
        <div className="mb-8 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm ring-1 ring-inset ring-white/[0.04]">
          <div className="flex items-center gap-3">
            <FaHardDrive className="shrink-0 text-sm text-white/40" aria-hidden />
            <span className="flex-1 text-sm font-medium text-white/50">{labels.current}</span>
            <span className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-semibold tabular-nums text-white/85 ring-1 ring-white/10">
              v{currentVersion || "?"}
            </span>
          </div>

          <div className="my-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <FaArrowDown className="text-xs text-white/20" />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>

          <div className="flex items-center gap-3">
            <FaCircleCheck className="shrink-0 text-sm text-amber-400/90" aria-hidden />
            <span className="flex-1 text-sm font-medium text-white/50">{labels.newer}</span>
            <span className="rounded-lg bg-gradient-to-br from-amber-500/25 to-amber-600/10 px-3 py-1.5 text-xs font-bold tabular-nums text-amber-100 ring-1 ring-amber-400/35 shadow-[0_0_24px_-8px_rgba(245,158,11,0.5)]">
              v{remoteVersion || "?"}
            </span>
          </div>
        </div>

        {/* Patch notes card — clickable banner that opens the in-app modal */}
        <button
          type="button"
          onClick={openPatchNotesModal}
          className="group mb-8 w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm transition hover:bg-white/[0.06] hover:ring-emerald-400/25"
        >
          {patchNotesLoading ? (
            <div className="flex items-center justify-center gap-3 px-5 py-10 text-sm text-white/55">
              <FaSpinner className="animate-spin text-base text-emerald-300/80" />
              <span>{labels.notesLoading}</span>
            </div>
          ) : versionImage ? (
            <>
              <div className="relative h-36 w-full overflow-hidden">
                <img
                  src={versionImage}
                  alt={`Patch v${remoteVersion}`}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  draggable={false}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
                    <FaFileLines className="text-xs text-emerald-300/90" />
                    {labels.notesTitle(remoteVersion || "?")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 ring-1 ring-emerald-400/30 transition group-hover:bg-emerald-500/30">
                    {labels.openNotesLink}
                    <FaArrowUpRightFromSquare className="text-[9px]" />
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 px-5 py-4 text-sm">
              <div className="flex items-center gap-2.5 text-white/85">
                <FaFileLines className="text-base text-emerald-400/80" />
                <span className="font-semibold">{labels.notesTitle(remoteVersion || "?")}</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/25 transition group-hover:bg-emerald-500/25">
                {labels.openNotesLink}
                <FaArrowUpRightFromSquare className="text-[9px]" />
              </span>
            </div>
          )}
        </button>

        {/* Progress card (always visible while open) */}
        <div className="mb-8 w-full max-w-md space-y-3 rounded-2xl border border-sky-500/15 bg-sky-500/[0.05] p-5 ring-1 ring-inset ring-sky-400/10">
          <div className="flex items-center justify-between gap-2 text-sm text-sky-100/85">
            <span className="inline-flex items-center gap-2 font-medium">
              {status === "paused" ? (
                <FaPause className="text-xs opacity-80" />
              ) : status === "extracting" ? (
                <FaSpinner className="animate-spin text-xs opacity-80" />
              ) : (
                <FaArrowDown className="text-xs opacity-80" />
              )}
              {statusLabel}
            </span>
            <span className="tabular-nums text-white/70">
              {!isExtracting && eta ? `${eta} ${labels.remaining} · ${speed}` : `${pct}%`}
            </span>
          </div>

          <div className="relative h-3 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-emerald-500/90 shadow-[0_0_14px_rgba(52,211,153,0.4)] transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute inset-0 h-full w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              style={{ animation: "update-progress-shine 2s linear infinite" }}
            />
          </div>

          <div className="flex items-center justify-between text-xs tabular-nums text-white/55">
            <span>
              {totalBytes && totalBytes > 0
                ? `${fmtBytes(downloadedBytes ?? 0)} / ${fmtBytes(totalBytes)}`
                : downloadedBytes
                  ? fmtBytes(downloadedBytes)
                  : ""}
            </span>
            <span className="text-emerald-300/85 font-bold text-sm">{pct}%</span>
          </div>
        </div>

        {/* Hint */}
        <p className="mb-6 max-w-sm text-center text-xs leading-relaxed text-white/35 sm:text-sm">
          {labels.hint}
        </p>

        {/* Action buttons */}
        <div className="flex w-full max-w-md flex-col-reverse gap-3 sm:flex-row sm:justify-center">
          {showCancel && (
            <Button
              type="button"
              onClick={onCancel}
              className="!bg-rose-500/[0.08] !ring-rose-400/25 hover:!bg-rose-500/15 sm:min-w-[10rem]"
            >
              <FaStop className="mr-2 text-sm" />
              {labels.cancel}
            </Button>
          )}
          {showPause && (
            <Button
              type="button"
              onClick={onPause}
              className="!bg-white/[0.05] !ring-white/15 hover:!bg-white/10 sm:min-w-[10rem]"
            >
              <FaPause className="mr-2 text-sm" />
              {labels.pause}
            </Button>
          )}
          {showResume && (
            <Button
              type="button"
              onClick={onResume}
              className="inline-flex items-center justify-center gap-2.5 !shadow-[0_0_28px_-8px_rgba(52,211,153,0.5)] sm:min-w-[10rem]"
            >
              <FaPlay className="text-sm" />
              {labels.resume}
            </Button>
          )}
        </div>
      </div>

      {/* Patch notes in-app modal (embeds the existing PatchNotesView) */}
      <PatchNotesModal
        open={patchNotesModalOpen}
        siteUrl={siteUrl}
        onClose={closePatchNotesModal}
      />
    </div>
  );
}
