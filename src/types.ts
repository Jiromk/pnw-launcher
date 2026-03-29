// src/types.ts
export type PokedexInfo = {
  seen?: number;
  caught?: number;
  /** IDs des espèces capturées (numéros Pokédex 1-based). */
  capturedIds?: number[];
  /** IDs des espèces vues (numéros Pokédex 1-based). */
  seenIds?: number[];
  /** Nombre de combats par espèce (index 0 = espèce 1). */
  foughtCounts?: number[];
  /** Nombre de captures par espèce (index 0 = espèce 1). */
  capturedCounts?: number[];
};

export type TeamMember = {
  code?: number | string;      // 001, "006_31", etc.
  form?: number | string | null;
  level?: number;
  nickname?: string | null;
  speciesName?: string | null;
  isShiny?: boolean | null;
  gender?: 0 | 1 | 2 | undefined; // 0=♂, 1=♀, 2=sans genre
  iconPath?: string | null;
  ivHp?: number;
  ivAtk?: number;
  ivDfe?: number;
  ivSpd?: number;
  ivAts?: number;
  ivDfs?: number;
  nature?: number | null;
  ability?: number | null;
  itemHolding?: number | null;
  moves?: number[];
  exp?: number | null;
  trainerName?: string | null;
};

/** Un Pokémon stocké dans une boîte PC. Mêmes champs que TeamMember + slot index. */
export type BoxPokemon = TeamMember & {
  /** Index du slot dans la boîte (0–29). */
  slot: number;
};

/** Une boîte PC (nom + contenu). */
export type PCBox = {
  name: string;
  pokemon: (BoxPokemon | null)[];
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
  /** Détail par boss : badgesList[0] = true si boss 1 vaincu, etc. */
  badgesList?: boolean[];
  pokedex?: PokedexInfo;
  team?: TeamMember[];
  /** Boîtes PC du joueur. */
  boxes?: PCBox[];
};

/** Réponse `GET /api/downloads/launcher-update` (mise à jour du programme launcher). */
export type LauncherUpdateInfo = {
  configured: boolean;
  version?: string | null;
  downloadUrl?: string | null;
};

/* ==================== Chat types ==================== */

export type ChatProfile = {
  id: string;
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string;
  roles: string[];
  created_at: string;
};

export type ChatChannel = {
  id: number;
  name: string | null;
  type: "public" | "moderation" | "dm";
  background_url: string | null;
  slowmode_seconds: number;
  created_at: string;
};

export type ChatMessage = {
  id: number;
  channel_id: number;
  user_id: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
  reply_to?: number | null;
  is_pinned?: boolean;
  pinned_by?: string | null;
  /** Jointure avec profiles — rempli par le select Supabase. */
  profiles?: ChatProfile;
};

export type ChatMute = {
  id: number;
  user_id: string;
  muted_by: string;
  reason: string;
  expires_at: string | null;
  created_at: string;
};

export type ChatBan = {
  id: number;
  user_id: string;
  banned_by: string;
  reason: string;
  expires_at: string | null;
  created_at: string;
};

export type ChatFriend = {
  id: number;
  user_id: string;
  friend_id: string;
  status: "pending" | "accepted";
  created_at: string;
  profiles?: ChatProfile; // The other user's profile
};

export type ChatBlock = {
  id: number;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

export type GtsShareData = {
  onlineId: string | number;
  deposited: { name: string; sprite: string; level: number; shiny: boolean; nature: string; gender: number };
  wanted: { name: string; sprite: string; levelMin: number; levelMax: number; gender: number } | null;
  trainer: string;
};

/* ==================== Launcher types ==================== */

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
  /** URL du background du launcher (définie depuis le site). */
  launcherBackgroundUrl?: string;
  /** URL de l'image de fond de la barre latérale du launcher (définie depuis le site). */
  launcherSidebarImageUrl?: string;
}
