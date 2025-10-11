import React from "react";

/* Bouton générique piloté par la couleur d'accent via CSS var --accent.
   -> Pas de dégradé "hardcodé" : les parents (ex: IconButton dans App.tsx)
      peuvent appliquer leur style, et les boutons simples héritent de --accent. */
export function Button(
  { className = "", children, disabled, style, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  // si l'appelant n'a PAS déjà donné un background, on applique le gradient accent
  const finalStyle = {
    backgroundImage:
      style && ("background" in style || "backgroundImage" in style)
        ? (style as any).backgroundImage
        : "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent), white 15%) 100%)",
    ...style,
  } as React.CSSProperties;

  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 select-none",
        "text-white ring-1 ring-white/10 shadow-[0_8px_25px_-10px_rgba(0,0,0,0.6)]",
        "active:scale-[0.99] transition-all",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
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
    <div className="w-full h-3 rounded-full bg-white/10 overflow-hidden ring-1 ring-white/10">
      <div
        className="h-full"
        style={{
          width: `${v}%`,
          backgroundImage:
            "linear-gradient(90deg, color-mix(in srgb, var(--accent), white 10%), var(--accent))",
        }}
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
}: {
  open: boolean;
  title?: React.ReactNode;
  children?: React.ReactNode;
  onCancel?: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[min(520px,92vw)] rounded-2xl border border-white/12 bg-gradient-to-b from-[#0f1629] to-[#0c1222] shadow-2xl p-5">
        {title ? <div className="text-lg font-semibold mb-3">{title}</div> : null}
        <div className="text-sm">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="px-4 py-2 rounded-xl text-white ring-1 ring-white/10"
            style={{
              backgroundImage:
                "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent), white 15%) 100%)",
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
