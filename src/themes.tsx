import React, { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FaPalette, FaFolderOpen, FaRotateLeft, FaUser } from "react-icons/fa6";

/* ───────────────────────── PERSISTENCE ───────────────────────── */
type BgPref =
  | { kind: "public"; path: string }
  | { kind: "file"; path: string };

type ThemePref = { accent: string; bg: BgPref };

const THEME_KEY = "pnw.theme";
const DEFAULT_THEME: ThemePref = {
  accent: "#5865F2",
  bg: { kind: "public", path: "/background.gif" },
};

function readTheme(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULT_THEME;
    const t = JSON.parse(raw) as ThemePref;
    return {
      accent: t?.accent || DEFAULT_THEME.accent,
      bg: t?.bg || DEFAULT_THEME.bg,
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
  }, [theme.accent]);

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

  return { theme, bgUrl, setAccent, setBgPublic, setBgFile };
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

export function ThemeMenu() {
  const { theme, setAccent, setBgPublic, setBgFile } = useTheme();
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

  const pickFile = async () => {
    const file = await open({
      title: "Choisir une image de fond",
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!file) return;
    setBgFile(String(file));
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
        Thème <span className="text-white/70">▾</span>
      </button>

      {openMenu && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur shadow-xl z-[1000] p-2"
        >
          {/* Accent */}
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs opacity-80 mb-1">Couleur d’accent</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccent(c)}
                  className="w-7 h-7 rounded-full ring-2 ring-white/20"
                  style={{ background: c }}
                  title={c}
                />
              ))}
              <button
                onClick={() => colorRef.current?.click()}
                className="px-2 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs ring-1 ring-white/8 transition-colors duration-200"
              >
                Personnalisée…
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
            <div className="text-xs opacity-80 mb-1">Fond d’écran</div>
            <div className="flex flex-col">
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-white/8 rounded-lg flex items-center gap-2 transition-colors duration-200"
                onClick={() => {
                  setBgPublic("/background.gif");
                  setOpenMenu(false);
                }}
              >
                <FaRotateLeft /> Par défaut (background.gif)
              </button>
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-white/8 rounded-lg flex items-center gap-2 transition-colors duration-200"
                onClick={pickFile}
              >
                <FaFolderOpen /> Choisir un fichier…
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── MENU AVATAR ─────────────────────────── */
export function PfpMenu() {
  const { pfpUrl, setBundledPfp, setFilePfp, clearPfp } = usePfp();
  const options = useBundledPfpOptions(64); // scanne icone1..64.(png|webp|jpg|jpeg|gif)

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

  const pickFile = async () => {
    const file = await open({
      title: "Choisir une image d’avatar",
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
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
            <FaUser />
          </span>
        </span>
        Avatar <span className="text-white/70">▾</span>
      </button>

      {openMenu && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[22rem] rounded-xl bg-black/80 text-white/90 ring-1 ring-white/15 backdrop-blur shadow-xl z-[1000] p-3"
        >
          <div className="text-xs opacity-80 mb-2">Icônes incluses</div>
          {/* Grille d’aperçus */}
          <div className="grid grid-cols-6 gap-2 max-h-60 overflow-auto">
            {options.map((url) => {
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
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              );
            })}
            {!options.length && (
              <div className="col-span-6 text-center text-xs opacity-70 py-3">
                Aucune icône trouvée dans <code>/public/pfp</code>
              </div>
            )}
          </div>

          <div className="h-px bg-white/10 my-3" />

          <div className="flex items-center gap-2">
            <button
              className="flex-1 px-3 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-sm ring-1 ring-white/8 inline-flex items-center gap-2 justify-center transition-colors duration-200"
              onClick={pickFile}
            >
              <FaFolderOpen /> Image locale…
            </button>
            <button
              className="flex-1 px-3 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-sm ring-1 ring-white/8 inline-flex items-center gap-2 justify-center transition-colors duration-200"
              onClick={() => {
                clearPfp(); // retour au sprite par défaut (male/female)
                setOpenMenu(false);
              }}
            >
              <FaRotateLeft /> Par défaut
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
