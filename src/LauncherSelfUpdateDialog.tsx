// src/LauncherSelfUpdateDialog.tsx
import React from "react";
import { Button } from "./ui";
import {
  FaArrowDown,
  FaArrowRight,
  FaCircleCheck,
  FaDownload,
  FaHardDrive,
  FaRocket,
  FaSpinner,
  FaXmark,
} from "react-icons/fa6";

export type LauncherSelfUpdateLabels = {
  title: string;
  subtitle: string;
  current: string;
  newer: string;
  download: string;
  downloading: string;
  later: string;
  hint: string;
  notesTitle?: string;
};

type DownloadProgress = { downloaded: number; total: number };

type Props = {
  open: boolean;
  currentVersion: string;
  remoteVersion: string;
  notes: string;
  labels: LauncherSelfUpdateLabels;
  downloadProgress: DownloadProgress | null;
  fmtBytes: (n: number) => string;
  onDownload: () => void;
  onClose: () => void;
};

export function LauncherSelfUpdateDialog({
  open,
  currentVersion,
  remoteVersion,
  notes,
  labels,
  downloadProgress,
  fmtBytes,
  onDownload,
  onClose,
}: Props) {
  if (!open) return null;

  const busy = downloadProgress != null;
  const pct =
    downloadProgress && downloadProgress.total > 0
      ? Math.min(100, Math.round((downloadProgress.downloaded / downloadProgress.total) * 100))
      : null;

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
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* ── Close button (top-right) ── */}
      {!busy && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 z-20 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-white/60 ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-white/10 hover:text-white"
          aria-label={labels.later}
        >
          <FaXmark className="text-lg" />
        </button>
      )}

      {/* ── Main content ── */}
      <div
        className="relative z-10 mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 py-12"
        style={{ animation: "update-page-in 0.5s ease-out both" }}
      >
        {/* Logo */}
        <img
          src="/logo.png"
          alt="PNW Launcher"
          className="mb-8 h-20 w-20 rounded-2xl shadow-[0_8px_40px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
          draggable={false}
        />

        {/* Animated icon */}
        <div
          className="relative mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-white/[0.08] to-white/[0.02] ring-1 ring-white/15"
          style={{ animation: "update-glow-pulse 4s ease-in-out infinite" }}
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400/20 to-transparent" />
          {busy ? (
            <FaSpinner className="relative text-4xl text-emerald-300 animate-spin drop-shadow-[0_0_16px_rgba(52,211,153,0.4)]" />
          ) : (
            <FaRocket
              className="relative text-4xl text-emerald-300 drop-shadow-[0_0_16px_rgba(52,211,153,0.45)]"
              style={{ animation: "update-icon-float 3s ease-in-out infinite" }}
            />
          )}
        </div>

        {/* Title */}
        <h1 className="mb-3 text-center text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {labels.title}
        </h1>
        <p className="mb-10 max-w-md text-center text-sm leading-relaxed text-white/55 sm:text-base">
          {labels.subtitle}
        </p>

        {/* Version comparison card */}
        <div className="mb-8 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm ring-1 ring-inset ring-white/[0.04]">
          {/* Current version */}
          <div className="flex items-center gap-3">
            <FaHardDrive className="shrink-0 text-sm text-white/40" aria-hidden />
            <span className="flex-1 text-sm font-medium text-white/50">{labels.current}</span>
            <span className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-semibold tabular-nums text-white/85 ring-1 ring-white/10">
              v{currentVersion}
            </span>
          </div>

          {/* Arrow separator */}
          <div className="my-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <FaArrowDown className="text-xs text-white/20" />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>

          {/* New version */}
          <div className="flex items-center gap-3">
            <FaCircleCheck className="shrink-0 text-sm text-amber-400/90" aria-hidden />
            <span className="flex-1 text-sm font-medium text-white/50">{labels.newer}</span>
            <span className="rounded-lg bg-gradient-to-br from-amber-500/25 to-amber-600/10 px-3 py-1.5 text-xs font-bold tabular-nums text-amber-100 ring-1 ring-amber-400/35 shadow-[0_0_24px_-8px_rgba(245,158,11,0.5)]">
              v{remoteVersion}
            </span>
          </div>
        </div>

        {/* Release notes */}
        {notes && (
          <div className="mb-8 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm ring-1 ring-inset ring-white/[0.04]">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/70">
              <FaArrowRight className="text-xs text-emerald-400/70" />
              {labels.notesTitle ?? "Nouveautés"}
            </h3>
            <div className="max-h-40 overflow-y-auto pr-1 text-sm leading-relaxed text-white/55 scrollbar-thin">
              {notes.split("\n").map((line, i) => (
                <p key={i} className={line.trim() ? "mb-1" : "mb-2"}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Download progress */}
        {busy && (
          <div className="mb-8 w-full max-w-sm space-y-3 rounded-2xl border border-sky-500/15 bg-sky-500/[0.05] p-5 ring-1 ring-inset ring-sky-400/10">
            <div className="flex items-center justify-between gap-2 text-sm text-sky-100/85">
              <span className="inline-flex items-center gap-2 font-medium">
                <FaArrowDown className="text-xs opacity-80" />
                {labels.downloading}
              </span>
              <span className="tabular-nums text-white/70">
                {downloadProgress.total > 0
                  ? `${fmtBytes(downloadProgress.downloaded)} / ${fmtBytes(downloadProgress.total)}`
                  : fmtBytes(downloadProgress.downloaded)}
                {pct != null ? ` · ${pct}%` : ""}
              </span>
            </div>

            {pct != null ? (
              <div className="relative h-3 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-emerald-500/90 shadow-[0_0_14px_rgba(52,211,153,0.4)] transition-[width] duration-200 ease-out"
                  style={{ width: `${pct}%` }}
                />
                {/* Shine effect */}
                <div
                  className="absolute inset-0 h-full w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  style={{ animation: "update-progress-shine 2s linear infinite" }}
                />
              </div>
            ) : (
              <div className="h-3 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
                <div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-sky-400/70 to-emerald-400/70" />
              </div>
            )}

            {pct != null && (
              <p className="text-center text-2xl font-bold tabular-nums text-emerald-300/90">
                {pct}%
              </p>
            )}
          </div>
        )}

        {/* Hint */}
        <p className="mb-8 max-w-sm text-center text-xs leading-relaxed text-white/35 sm:text-sm">
          {labels.hint}
        </p>

        {/* Action buttons */}
        <div className="flex w-full max-w-sm flex-col-reverse gap-3 sm:flex-row sm:justify-center">
          <Button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="!bg-white/[0.05] !ring-white/15 hover:!bg-white/10 sm:min-w-[8rem] disabled:opacity-40"
          >
            {labels.later}
          </Button>
          <Button
            type="button"
            onClick={onDownload}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2.5 !shadow-[0_0_28px_-8px_rgba(52,211,153,0.5)] sm:min-w-[14rem] disabled:opacity-45"
          >
            {busy ? (
              <FaSpinner className="text-sm animate-spin" />
            ) : (
              <FaDownload className="text-sm opacity-95" />
            )}
            {busy ? labels.downloading : labels.download}
          </Button>
        </div>
      </div>
    </div>
  );
}
