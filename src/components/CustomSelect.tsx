import { useState, useRef, useEffect, useCallback } from "react";

type Option = {
  value: string;
  label: string;
  icon?: React.ReactNode;
};

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Sélectionner…",
  className = "",
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Scroll selected into view when opening
  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector(".csel-option--active");
      if (active) active.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  return (
    <div className={`csel ${open ? "csel--open" : ""} ${className}`} ref={ref}>
      <button
        type="button"
        className="csel-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="csel-trigger-text">
          {selected?.icon && <span className="csel-trigger-icon">{selected.icon}</span>}
          {selected?.label ?? placeholder}
        </span>
        <svg className="csel-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="csel-dropdown" ref={listRef}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`csel-option${opt.value === value ? " csel-option--active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                close();
              }}
            >
              {opt.icon && <span className="csel-option-icon">{opt.icon}</span>}
              <span className="csel-option-label">{opt.label}</span>
              {opt.value === value && (
                <svg className="csel-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
