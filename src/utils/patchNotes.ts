// src/utils/patchNotes.ts
// Helper for fetching and selecting patch notes from the PNW site API.
// Used by GameUpdateDialog to display the notes for the version being installed.

export interface PatchItem {
  text?: string;
  kind?: string;
}

export interface PatchSection {
  title: string;
  icon?: string;
  items: (string | PatchItem)[];
  image?: string;
}

export interface PatchVersion {
  version: string;
  date?: string;
  image?: string;
  sections: PatchSection[];
}

export interface PatchnotesData {
  versions: PatchVersion[];
  background?: string;
}

/** Returns the text content of a patch item, whether it's a string or a { text, kind } object. */
export function getItemText(item: string | PatchItem): string {
  if (typeof item === "string") return item;
  return item?.text ?? "";
}

/** Returns the kind marker ("nerf" | "buff" | "ajustement" | ...) of a patch item, or undefined. */
export function getItemKind(item: string | PatchItem): string | undefined {
  if (typeof item === "string") return undefined;
  return item?.kind;
}

/** Resolves a (possibly relative) asset URL against the PNW site base. */
export function resolveAssetUrl(base: string, value?: string): string {
  if (!value) return "";
  try {
    return new URL(value, `${base}/`).toString();
  } catch {
    return value;
  }
}

/**
 * Fetch patchnotes JSON from the PNW site.
 * Returns null on success-but-empty. Throws on network/HTTP/parse errors.
 */
export async function fetchPatchNotes(
  siteUrl: string,
  lang: "fr" | "en" = "fr",
  signal?: AbortSignal,
): Promise<PatchnotesData | null> {
  const base = siteUrl.replace(/\/$/, "");
  const r = await fetch(`${base}/api/patchnotes/${lang}?t=${Date.now()}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const res = await r.json();
  if (res?.success && res?.patchnotes) return res.patchnotes as PatchnotesData;
  return null;
}

/**
 * Find the patch notes for a specific version. Falls back to the first version
 * in the list if no exact match is found (assumes the API returns most-recent first).
 */
export function findVersionNotes(
  data: PatchnotesData | null,
  version: string,
): PatchVersion | null {
  if (!data?.versions?.length) return null;
  const v = version.trim();
  return data.versions.find((x) => x.version.trim() === v) ?? data.versions[0] ?? null;
}
