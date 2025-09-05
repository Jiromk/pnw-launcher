import React from "react";

export function Card(
  props: React.PropsWithChildren<{title?:string, subtitle?:string, className?:string}>
){
  return (
    <div className={`glass p-6 ${props.className||""}`}>
      {(props.title || props.subtitle) && (
        <div className="mb-3">
          {props.title && <h2 className="text-xl font-semibold">{props.title}</h2>}
          {props.subtitle && <p className="text-sm text-white/60">{props.subtitle}</p>}
        </div>
      )}
      {props.children}
    </div>
  );
}

type BtnProps = {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
};
export function Button({children, onClick, disabled, variant="primary", className}: BtnProps){
  const base = "px-5 py-2 rounded-xl transition ring-1";
  const styles =
    variant === "primary"
      ? "bg-[#2e59c6] hover:bg-[#2e59c6]/90 ring-[var(--ring)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
      : variant === "secondary"
      ? "bg-white/10 hover:bg-white/15 text-white ring-white/15"
      : "bg-white/5 hover:bg-white/10 text-white/80 ring-white/10";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className||""}`}>
      {children}
    </button>
  );
}

export function Progress({value}:{value:number}){
  return (
    <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full bg-[#7ecdf2]" style={{width:`${Math.min(100, Math.max(0, value))}%`}} />
    </div>
  );
}
