// src/types.ts
export type PokedexInfo = {
  seen?: number;
  caught?: number;
  /** IDs des espèces capturées (numéros Pokédex 1-based). Les noms se déduisent via l’API /api/pokedex du site si entrées avec id. */
  capturedIds?: number[];
};

export type TeamMember = {
  code?: number | string;      // 001, "006_31", etc.
  form?: number | string | null;
  level?: number;
  nickname?: string | null;
  speciesName?: string | null;
  isShiny?: boolean | null;
  gender?: 0 | 1 | 2 | undefined; // 0=♂, 1=♀ (si dispo)
  iconPath?: string | null;
};

export type PlayerProfile = {
  name?: string | null;
  id?: number;
  rawTrainerId?: number;
  money?: number;
  startTime?: number;
  playTimeSec?: number;
  gender?: 0 | 1 | 2 | undefined; // 0=♂, 1=♀
  charset?: string | null;
  badges?: number;
  pokedex?: PokedexInfo;
  team?: TeamMember[];
};

export type Manifest = {
  version: string;
  downloadUrl?: string;
  zip_url?: string;
  game_exe?: string;
  folder?: string;
  name?: string;
  releaseDate?: string;
  minimumLauncherVersion?: string;
  changelog?: any;
  downloadSize?: number;
  files?: any[];
  requirements?: any;
  integrity?: any;
};
