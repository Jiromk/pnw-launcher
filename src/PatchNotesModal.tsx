// src/PatchNotesModal.tsx
// Modal that embeds the existing PatchNotesView component so the user can read
// the full patch notes without leaving the launcher. Triggered from GameUpdateDialog.
import React, { useEffect } from "react";
import { FaXmark } from "react-icons/fa6";
import PatchNotesView from "./views/PatchNotesView";

type Props = {
  open: boolean;
  siteUrl: string;
  onClose: () => void;
};

export function PatchNotesModal({ open, siteUrl, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop (click to close) */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-md"
        style={{ animation: "update-page-in 0.25s ease-out both" }}
      />

      {/* Modal container */}
      <div
        className="relative z-10 flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0a1020] via-[#0d1224] to-[#080c18] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ animation: "update-page-in 0.35s ease-out both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (floating top-right) */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white/70 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/60 hover:text-white"
          aria-label="Fermer les notes de patch"
        >
          <FaXmark className="text-lg" />
        </button>

        {/* Scrollable content: reuse the existing PatchNotesView */}
        <div className="flex-1 overflow-y-auto">
          <PatchNotesView siteUrl={siteUrl} />
        </div>
      </div>
    </div>
  );
}
