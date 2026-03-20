import React from "react";

/* Bouton générique : fond sombre + lueur intérieure accent (pas de remplissage coloré). */
export function Button(
  { className = "", children, disabled, style, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  const hasBg = style && ("background" in style || "backgroundImage" in style);
  const finalStyle = hasBg ? (style as React.CSSProperties) : { backgroundImage: "none", ...style };

  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 select-none",
        "text-white/95 ring-1 ring-white/8 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)]",
        "hover:ring-white/12 hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)]",
        "active:scale-[0.99] transition-all duration-200",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        !hasBg ? "accent-glow-btn" : "",
        className,
      ].filter(Boolean).join(" ")}
      style={finalStyle}
      {...props}
    >
      {children}
    </button>
  );
}

/* Carte “glass” */
export function Card({
  title,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "glass p-5 rounded-2xl border border-white/10 bg-white/5 backdrop-blur",
        className,
      ].join(" ")}
    >
      {title ? (
        <div className="mb-3 text-lg font-semibold tracking-wide">{title}</div>
      ) : null}
      {children}
    </section>
  );
}

/* Barre de progression */
export function Progress({ value = 0 }: { value?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-track w-full h-3 rounded-full bg-white/10 overflow-hidden ring-1 ring-white/10">
      <div
        className="h-full progress-fill"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/* Modal stylisé (React, pas le plugin) */
export function Modal({
  open,
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel = "OK",
  cancelLabel = "Annuler",
  hideActions = false,
}: {
  open: boolean;
  title?: React.ReactNode;
  children?: React.ReactNode;
  onCancel?: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Masque les boutons Annuler / Confirmer (contenu entièrement custom dans children). */
  hideActions?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="pnw-modal-overlay absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="pnw-modal-content relative w-[min(520px,92vw)] rounded-2xl border border-white/12 bg-gradient-to-b from-[#0f1629] to-[#0c1222] shadow-2xl p-5">
        {title ? <div className="text-lg font-semibold mb-3">{title}</div> : null}
        <div className="text-sm">{children}</div>
        {!hideActions ? (
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              className="accent-glow-btn px-4 py-2 rounded-xl text-white ring-1 ring-white/10"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
