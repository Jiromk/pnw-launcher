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
  isAltShiny?: boolean | null;
  gender?: 0 | 1 | 2 | undefined; // 0=♂, 1=♀, 2=sans genre
  iconPath?: string | null;
  ivHp?: number;
  ivAtk?: number;
  ivDfe?: number;
  ivSpd?: number;
  ivAts?: number;
  ivDfs?: number;
  evHp?: number;
  evAtk?: number;
  evDfe?: number;
  evSpd?: number;
  evAts?: number;
  evDfs?: number;
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
  deposited: { name: string; sprite: string; level: number; shiny: boolean; altShiny: boolean; nature: string; gender: number };
  wanted: { name: string; sprite: string; levelMin: number; levelMax: number; gender: number } | null;
  trainer: string;
};

export type GameActivitySharePartyMember = {
  species: string; speciesId: number; level: number; form: number; shiny: boolean; altShiny: boolean;
  nickname?: string | null;
  gender?: number | null;
  nature?: number | null;
  ability?: number | null;
  itemHolding?: number | null;
  exp?: number | null;
  moves?: number[];
  ivHp?: number | null; ivAtk?: number | null; ivDfe?: number | null;
  ivSpd?: number | null; ivAts?: number | null; ivDfs?: number | null;
};

export type GameActivityShareData = {
  targetUserId: string;
  targetName: string;
  targetAvatar: string | null;
  mapName: string;
  inBattle: boolean;
  party: GameActivitySharePartyMember[];
  battleAlly?: { species: string; speciesId: number; level: number; shiny?: boolean; altShiny?: boolean; hp?: number; max_hp?: number } | null;
  battleFoes?: { species: string; speciesId: number; level: number; shiny?: boolean; altShiny?: boolean; hp: number; max_hp: number }[];
  timestamp: number;
};

/* ==================== Game Live Dashboard types ==================== */

export type GameLivePartyMember = {
  name: string;
  species: string;
  species_id?: number;
  form?: number;
  level: number;
  hp: number;
  max_hp: number;
  shiny: boolean;
  alt_shiny?: boolean;
  gender?: number;
  nature?: number | null;
  ability?: number | null;
  ability_name?: string | null;
  item?: number;
  exp?: number;
  atk?: number;
  dfe?: number;
  spd?: number;
  ats?: number;
  dfs?: number;
  iv_hp?: number | null;
  iv_atk?: number | null;
  iv_dfe?: number | null;
  iv_spd?: number | null;
  iv_ats?: number | null;
  iv_dfs?: number | null;
  moves?: number[];
};

export type GameLiveState = {
  active: boolean;
  timestamp: number;
  trainer_name?: string;
  play_time?: number;
  money?: number;
  badge_count?: number;
  party_size?: number;
  party?: GameLivePartyMember[];
  map_name?: string;
  in_battle?: boolean;
  is_trainer_battle?: boolean;
  trainer_battle_names?: string[];
  trainer_battle_classes?: string[];
  battle_ally?: { name: string; species: string; species_id?: number; form?: number; level: number; hp?: number; max_hp?: number; shiny?: boolean; alt_shiny?: boolean };
  battle_foes?: GameLivePartyMember[];
  battle_turn?: number;
  vms_connected?: boolean;
  vms_cluster?: number;
  vms_player_count?: number;
};

export type GameLivePlayer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  /** Full game state — only available for our own user (local polling). Null for other players (lightweight Presence). */
  gameState?: GameLiveState | null;
  /** Lightweight status from Presence (available for all players). */
  liveStatus?: {
    gameActive: boolean;
    mapName: string;
    inBattle: boolean;
    partySize: number;
    timestamp: number;
  } | null;
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

/* ==================== P2P Trade types ==================== */

export type TradePhase = "idle" | "pending" | "selecting" | "confirming" | "executing" | "complete" | "error";

export type TradeSelectionPreview = {
  speciesId: number;
  name: string;
  nickname?: string | null;
  level: number;
  shiny: boolean;
  altShiny: boolean;
  gender?: number;
  nature?: number | null;
  form: number;
  ability?: number | null;
  abilityName?: string | null;
  itemHolding?: number | null;
  itemName?: string | null;
  moves?: number[];
  moveNames?: string[];
  ivHp?: number | null;
  ivAtk?: number | null;
  ivDfe?: number | null;
  ivSpd?: number | null;
  ivAts?: number | null;
  ivDfs?: number | null;
};

export type TradeSelection = TradeSelectionPreview & {
  boxIdx: number;
  slotIdx: number;
  pokemonB64: string;
};

export type TradeState =
  | { phase: "idle" }
  | { phase: "pending"; role: "initiator" | "responder"; tradeId: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number; startedAt: number }
  | { phase: "selecting"; role: "initiator" | "responder"; tradeId: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number; mySelection: TradeSelection | null; theirPreview: TradeSelectionPreview | null }
  | { phase: "confirming"; role: "initiator" | "responder"; tradeId: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number; mySelection: TradeSelection; theirPreview: TradeSelectionPreview; myConfirmed: boolean; theirConfirmed: boolean }
  | { phase: "executing"; role: "initiator" | "responder"; tradeId: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number; mySelection: TradeSelection; theirPreview: TradeSelectionPreview }
  | { phase: "complete"; tradeId: string; partnerId: string; partnerName: string }
  | { phase: "error"; tradeId: string; partnerId: string; partnerName: string; message: string };

export type TradeMessageData = {
  tradeId: string;
  playerA: { userId: string; name: string; pokemon: TradeSelectionPreview };
  playerB: { userId: string; name: string; pokemon: TradeSelectionPreview };
  timestamp: number;
};

/* ==================== PvP Battle types ==================== */

export type BattlePhase = "idle" | "inviting" | "waiting_game" | "relaying" | "complete" | "error";

export type BattleRoomState =
  | { phase: "idle" }
  | { phase: "inviting"; roomCode: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number; startedAt?: number }
  | { phase: "waiting_game"; roomCode: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number }
  | { phase: "relaying"; roomCode: string; partnerId: string; partnerName: string; partnerAvatar: string | null; dmChannelId: number }
  | { phase: "complete"; roomCode: string; partnerId: string; partnerName: string; endReason?: string; battleResult?: string }
  | { phase: "error"; roomCode: string; partnerId: string; partnerName: string; message: string };
