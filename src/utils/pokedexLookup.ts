/** Normalise un nom pour la recherche (minuscules, sans accents) */
export function normalizeName(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PokedexEntry { name?: string; imageUrl?: string; }

/** Construit une map nom normalisé -> { name, imageUrl } depuis les entries du pokedex */
export function buildPokedexLookup(entries: PokedexEntry[]): Map<string, { name: string; imageUrl: string | null }> {
  const map = new Map<string, { name: string; imageUrl: string | null }>();
  if (!Array.isArray(entries)) return map;
  for (const e of entries) {
    const name = (e.name || "").trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!map.has(key)) {
      map.set(key, { name, imageUrl: (e.imageUrl || "").trim() || null });
    }
  }
  return map;
}

/** Variantes de noms (EVs vs Pokédex : "Staross Bélamie" vs "Staross de Bélamie") */
function nameVariants(normalized: string): string[] {
  const out = [normalized];
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s); };
  add(normalized.replace(/\s+belamie\s*$/, " de belamie"));
  add(normalized.replace(/\s+de belamie\s*$/, " belamie"));
  add(normalized.replace(/\s+galar\s*$/, " de galar"));
  add(normalized.replace(/\s+de galar\s*$/, " galar"));
  add(normalized.replace(/\s+hisui\s*$/, " de hisui"));
  add(normalized.replace(/\s+de hisui\s*$/, " hisui"));
  return out;
}

/** Trouve le sprite pour un nom affiché via la lookup pokedex */
export function findSprite(
  lookup: Map<string, { name: string; imageUrl: string | null }>,
  displayName: string
): string | null {
  if (!displayName) return null;
  const normalized = normalizeName(displayName);
  const withoutSuffix = normalized.replace(/\s*\(\d+pts?\)\s*$/, "").trim();
  const toTry = nameVariants(withoutSuffix);
  for (const key of toTry) {
    const entry = lookup.get(key);
    if (entry?.imageUrl) return entry.imageUrl;
  }
  const firstWord = withoutSuffix.split(/\s+/)[0] || "";
  if (firstWord) {
    const entry = lookup.get(firstWord);
    if (entry?.imageUrl) return entry.imageUrl;
  }
  for (const [key, value] of lookup) {
    if (!value?.imageUrl) continue;
    if (withoutSuffix.startsWith(key) || key.startsWith(withoutSuffix)) return value.imageUrl;
  }
  return null;
}
