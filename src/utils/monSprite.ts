import { convertFileSrc } from "@tauri-apps/api/core";

export const normPath = (p: string) => p.replaceAll("\\", "/");

export const joinPath = (...parts: string[]) =>
  parts.map((p) => normPath(p).replace(/^\/+|\/+$/g, "")).join("/");

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const pad3 = (n: number) => String(n).padStart(3, "0");

export const toFileUrl = (p: string) => convertFileSrc(p.replaceAll("\\", "/"));

export function rootFromSavePath(savePath: string, fallback: string) {
  const s = normPath(savePath).toLowerCase();
  const idx = s.lastIndexOf("/saves/");
  return idx >= 0 ? savePath.slice(0, idx) : fallback;
}

export function monIconCandidates(root: string, m: any): { list: string[] } {
  const dirN = joinPath(root, "graphics", "pokedex", "pokefront");

  const names: string[] = [];
  if (m.code != null) {
    const raw = String(m.code);
    const base = /^\d+$/.test(raw) ? pad3(parseInt(raw, 10)) : raw;
    if (m.form != null && m.form !== "" && !Number.isNaN(Number(m.form))) {
      names.push(`${base}_${pad2(parseInt(String(m.form), 10))}`);
    }
    names.push(`${base}_00`, base);
  }
  if (m.speciesName) {
    const s = String(m.speciesName).trim();
    names.push(s, s.toLowerCase(), s.replace(/\s+/g, "_"));
  }
  const uniqNames = Array.from(new Set(names));
  const exts = [".png", ".gif", ".webp"];

  const list: string[] = [];
  for (const nm of uniqNames) for (const ext of exts) list.push(toFileUrl(joinPath(dirN, `${nm}${ext}`)));
  for (const ext of exts) list.push(toFileUrl(joinPath(dirN, `000${ext}`)));
  return { list };
}
