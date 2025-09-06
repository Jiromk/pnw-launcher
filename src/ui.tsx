import React from "react";

/* Bouton générique — icônes bien alignés grâce à inline-flex */
export function Button({
  className = "",
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2", // 👈 alignement horizontal garanti
        "rounded-xl px-4 py-2.5 select-none",
        "bg-gradient-to-br from-blue-500/90 to-indigo-500/90",
        "hover:from-blue-500 hover:to-indigo-500",
        "active:scale-[0.99] transition-all",
        "ring-1 ring-white/10 text-white shadow-[0_8px_25px_-10px_rgba(0,0,0,0.6)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
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
        "glass p-5 rounded-2xl",
        "border border-white/10 bg-white/5 backdrop-blur",
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
        className="h-full bg-gradient-to-r from-sky-400 to-indigo-500"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
