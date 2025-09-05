import React from "react";

export function Card(props: React.PropsWithChildren<{title?:string, className?:string}>){
  return (
    <div className={`rounded-2xl border border-white/10 bg-[var(--glass)] backdrop-blur-md shadow-glass p-6 ${props.className||""}`}>
      {props.title && <h2 className="text-xl font-semibold mb-2">{props.title}</h2>}
      {props.children}
    </div>
  );
}

export function Button({children, onClick, disabled}: {children:React.ReactNode,onClick?:()=>void,disabled?:boolean}){
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 transition
                  disabled:opacity-50 disabled:cursor-not-allowed ring-1 ring-[var(--ring)]`}>
      {children}
    </button>
  );
}

export function Progress({value}:{value:number}){
  return (
    <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full bg-primary2" style={{width:`${Math.min(100, Math.max(0, value))}%`}} />
    </div>
  );
}
