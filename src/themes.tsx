import React, { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  FaPalette,
  FaFolderOpen,
  FaRotateLeft,
  FaUser,
  FaMoon,
  FaSun,
  FaBars,
  FaArrowRightArrowLeft,
} from "react-icons/fa6";
import { getLauncherUi, type UiLang } from "./launcherUiLocale";

/** Menu principal du launcher (accès GTS, etc.). */
export function LauncherMenu({
  onOpenGts,
  uiLang,
}: {
  onOpenGts: () => void;
  uiLang: UiLang;
}) {
  const t = getLauncherUi(uiLang).launcherMenu;
  const [openMenu, setOpenMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className="group rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/8 hover:ring-white/12 px-4 py-2.5 text-sm font-medium inline-flex items-center gap-2 backdrop-blur transition-all duration-200"
      >
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-white/10 ring-1 ring-white/8">
          <span className="text-[14px]">
            <FaBars />
          </span>
        </span>
        {t.button} <span className="text-white/70">▾</span>
      </button>

      {openMenu && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[min(100vw-2rem,16rem)] rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur shadow-xl z-[1000] p-2 theme-menu-dropdown"
        >
          <button
            type="button"
            role="menuitem"
            className="w-full text-left px-3 py-2.5 hover:bg-white/8 rounded-lg flex items-center gap-2.5 transition-colors duration-200"
            onClick={() => {
              onOpenGts();
              setOpenMenu(false);
            }}
            aria-label={t.gtsAria}
          >
            <FaArrowRightArrowLeft className="text-[14px] opacity-90 shrink-0" aria-hidden />
            <span>{t.gts}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── PERSISTENCE ───────────────────────── */
type BgPref =
  | { kind: "public"; path: string }
  | { kind: "file"; path: string };

export type ThemeMode = "dark" | "light";

type ThemePref = { accent: string; bg: BgPref; mode: ThemeMode };

const THEME_KEY = "pnw.theme";
const DEFAULT_THEME: ThemePref = {
  accent: "#5865F2",
  bg: { kind: "public", path: "/background.gif" },
  mode: "dark",
};

function readTheme(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULT_THEME;
    const t = JSON.parse(raw) as ThemePref;
    const mode = t?.mode === "light" ? "light" : "dark";
    return {
      accent: t?.accent || DEFAULT_THEME.accent,
      bg: t?.bg || DEFAULT_THEME.bg,
      mode,
    };
  } catch {
    return DEFAULT_THEME;
  }
}
function writeTheme(t: ThemePref) {
  localStorage.setItem(THEME_KEY, JSON.stringify(t));
  window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
}

/* ─────────────────────────── HOOK (THÈME) ─────────────────────────── */
export function useTheme() {
  const [theme, setTheme] = useState<ThemePref>(() => readTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", theme.accent);
    root.setAttribute("data-theme", theme.mode);
  }, [theme.accent, theme.mode]);

  const bgUrl = useMemo(() => {
    return theme.bg.kind === "public"
      ? theme.bg.path
      : convertFileSrc(theme.bg.path.replace(/\\/g, "/"));
  }, [theme.bg]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setTheme(readTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAccent = (hex: string) => {
    const next = { ...theme, accent: hex };
    setTheme(next);
    writeTheme(next);
  };
  const setBgPublic = (path = "/background.gif") => {
    const next = { ...theme, bg: { kind: "public", path } as BgPref };
    setTheme(next);
    writeTheme(next);
  };
  const setBgFile = (path: string) => {
    const next = { ...theme, bg: { kind: "file", path } as BgPref };
    setTheme(next);
    writeTheme(next);
  };
  const setMode = (mode: ThemeMode) => {
    const next = { ...theme, mode };
    setTheme(next);
    writeTheme(next);
  };

  return { theme, bgUrl, setAccent, setBgPublic, setBgFile, setMode };
}

/* ─────────────────────────── HOOK (AVATAR) ─────────────────────────── */
type PfpPref =
  | { kind: "bundled"; path: string } // /pfp/iconeX.png …
  | { kind: "file"; path: string };   // image locale via dialogue

const PFP_KEY = "pnw.pfp";

function readPfp(): PfpPref | null {
  try {
    const raw = localStorage.getItem(PFP_KEY);
    return raw ? (JSON.parse(raw) as PfpPref) : null;
  } catch {
    return null;
  }
}
function writePfp(p: PfpPref | null) {
  if (p) localStorage.setItem(PFP_KEY, JSON.stringify(p));
  else localStorage.removeItem(PFP_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: PFP_KEY }));
}

/** Retourne l’URL utilisable dans <img /> (ou null si rien choisi) */
export function usePfp() {
  const [pfp, setPfp] = useState<PfpPref | null>(() => readPfp());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PFP_KEY) setPfp(readPfp());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pfpUrl = useMemo(() => {
    if (!pfp) return null;
    return pfp.kind === "bundled"
      ? pfp.path
      : convertFileSrc(pfp.path.replace(/\\/g, "/"));
  }, [pfp]);

  const setBundledPfp = (path: string) => {
    const next: PfpPref = { kind: "bundled", path };
    setPfp(next);
    writePfp(next);
  };
  const setFilePfp = (path: string) => {
    const next: PfpPref = { kind: "file", path };
    setPfp(next);
    writePfp(next);
  };
  const clearPfp = () => {
    setPfp(null);
    writePfp(null);
  };

  return { pfpUrl, setBundledPfp, setFilePfp, clearPfp };
}

/** Détecte toutes les icônes présentes dans /public/pfp sous le motif icone{N}.{ext} */
function useBundledPfpOptions(max = 64) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    let cancel = false;

    const exts = ["png", "webp", "jpg", "jpeg", "gif"];
    const probes: string[] = [];
    for (let i = 1; i <= max; i++)
      for (const ext of exts) probes.push(`/pfp/icone${i}.${ext}`);

    const probe = (url: string) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });

    (async () => {
      const found: string[] = [];
      for (const url of probes) {
        const ok = await probe(url);
        if (cancel) return;
        if (ok) found.push(url);
      }
      // supprime doublons éventuels
      setList([...new Set(found)]);
    })();

    return () => {
      cancel = true;
    };
  }, [max]);

  return list;
}

/* ────────────────────────── MENUS ────────────────────────── */
const PRESETS = [
  "#5865F2", // indigo (par défaut)
  "#22c55e", // vert
  "#ef4444", // rouge
  "#f59e0b", // orange
  "#06b6d4", // cyan
  "#a855f7", // violet
  "#ec4899", // pink
];

export function ThemeMenu({
  defaultBgUrl,
  uiLang,
}: {
  defaultBgUrl?: string;
  uiLang: UiLang;
}) {
  const t = getLauncherUi(uiLang).themeMenu;
  const tPfp = getLauncherUi(uiLang).pfpMenu;
  const { theme, setAccent, setBgPublic, setBgFile, setMode } = useTheme();
  const { pfpUrl, setBundledPfp, setFilePfp, clearPfp } = usePfp();
  const pfpOptions = useBundledPfpOptions(64);
  const [openMenu, setOpenMenu] = useState(false);
  const colorRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const pickBgFile = async () => {
    const file = await open({
      title: t.dialogPickBg,
      multiple: false,
      filters: [{ name: t.filterImages, extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!file) return;
    setBgFile(String(file));
    setOpenMenu(false);
  };

  const pickPfpFile = async () => {
    const file = await open({
      title: tPfp.dialogPick,
      multiple: false,
      filters: [{ name: tPfp.filterImages, extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!file) return;
    setFilePfp(String(file));
    setOpenMenu(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpenMenu((v) => !v)}
        className="group rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/8 hover:ring-white/12 px-4 py-2.5 text-sm font-medium inline-flex items-center gap-2 backdrop-blur transition-all duration-200"
      >
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-white/10 ring-1 ring-white/8">
          <span className="text-[14px]">
            <FaPalette />
          </span>
        </span>
        {t.button} <span className="text-white/70">▾</span>
      </button>

      {openMenu && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[22rem] rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur shadow-xl z-[1000] p-2 theme-menu-dropdown max-h-[80vh] overflow-y-auto"
        >
          {/* Mode Sombre / Clair */}
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs opacity-80 mb-1">{t.appearance}</div>
            <div className="flex gap-2">
              <button
                onClick={() => { setMode("dark"); setOpenMenu(false); }}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border transition-all duration-200 theme-mode-btn ${theme.mode === "dark" ? "theme-mode-btn--active" : "theme-mode-btn--inactive"}`}
                title={t.titleDark}
              >
                <FaMoon className="text-[14px]" />
                <span>{t.dark}</span>
              </button>
              <button
                onClick={() => { setMode("light"); setOpenMenu(false); }}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border transition-all duration-200 theme-mode-btn ${theme.mode === "light" ? "theme-mode-btn--active" : "theme-mode-btn--inactive"}`}
                title={t.titleLight}
              >
                <FaSun className="text-[14px]" />
                <span>{t.light}</span>
              </button>
            </div>
          </div>

          <div className="h-px bg-white/10 my-1" />

          {/* Accent */}
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs opacity-80 mb-1">{t.accent}</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  className="theme-accent-swatch w-7 h-7 rounded-full flex-shrink-0 relative overflow-hidden p-0"
                  title={c}
                >
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: c }}
                    aria-hidden
                  />
                </button>
              ))}
              <button
                onClick={() => colorRef.current?.click()}
                className="px-2 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs ring-1 ring-white/8 transition-colors duration-200"
              >
                {t.customColor}
              </button>
              <input
                ref={colorRef}
                type="color"
                className="hidden"
                defaultValue={theme.accent}
                onChange={(e) => setAccent(e.target.value)}
              />
            </div>
          </div>

          <div className="h-px bg-white/10 my-1" />

          {/* Fond d’écran */}
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs opacity-80 mb-1">{t.wallpaper}</div>
            <div className="flex flex-col">
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-white/8 rounded-lg flex items-center gap-2 transition-colors duration-200"
                onClick={() => {
                  setBgPublic(defaultBgUrl || "/background.gif");
                  setOpenMenu(false);
                }}
              >
                <FaRotateLeft /> {t.default}
              </button>
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-white/8 rounded-lg flex items-center gap-2 transition-colors duration-200"
                onClick={pickBgFile}
              >
                <FaFolderOpen /> {t.chooseFile}
              </button>
            </div>
          </div>

          <div className="h-px bg-white/10 my-1" />

          {/* Avatar */}
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs opacity-80 mb-2">{tPfp.bundled}</div>
            <div className="grid grid-cols-6 gap-2 max-h-48 overflow-auto">
              {pfpOptions.map((url) => {
                const selected = pfpUrl === url;
                return (
                  <button
                    key={url}
                    title={url.split("/").pop() || "avatar"}
                    onClick={() => {
                      setBundledPfp(url);
                      setOpenMenu(false);
                    }}
                    className={[
                      "aspect-square rounded-lg overflow-hidden ring-2",
                      selected ? "ring-[var(--accent)]" : "ring-white/15 hover:ring-white/30",
                    ].join(" ")}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" style={{ imageRendering: "auto" }} />
                  </button>
                );
              })}
              {!pfpOptions.length && (
                <div className="col-span-6 text-center text-xs opacity-70 py-3">
                  {tPfp.noIconsBefore} <code>/public/pfp</code>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button
                className="flex-1 px-3 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-sm ring-1 ring-white/8 inline-flex items-center gap-2 justify-center transition-colors duration-200"
                onClick={pickPfpFile}
              >
                <FaFolderOpen /> {tPfp.localImage}
              </button>
              <button
                className="flex-1 px-3 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-sm ring-1 ring-white/8 inline-flex items-center gap-2 justify-center transition-colors duration-200"
                onClick={() => {
                  clearPfp();
                  setOpenMenu(false);
                }}
              >
                <FaRotateLeft /> {tPfp.default}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* PfpMenu conservé comme alias pour rétro-compatibilité (non utilisé) */
export function PfpMenu({ uiLang: _uiLang }: { uiLang: UiLang }) {
  return null;
}
