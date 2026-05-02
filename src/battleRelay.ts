/**
 * battleRelay.ts — Relay entre le jeu (VMS file IPC) et le serveur de combat Socket.io.
 *
 * Le serveur collecte les actions des 2 joueurs, genere un RNG partage,
 * et renvoie le tout aux 2 joueurs EN MEME TEMPS.
 * → Les deux jeux executent avec les memes RNG = sync parfaite.
 */
import { invoke } from "@tauri-apps/api/core";
import { io, Socket } from "socket.io-client";
import { supabase } from "./supabaseClient";

/* ==================== Constants ==================== */

const POLL_INTERVAL = 300;
export const BATTLE_INVITE_TIMEOUT = 60_000;

/** URL du serveur de combat — a changer quand deploye sur Railway */
const BATTLE_SERVER_URL = import.meta.env.VITE_BATTLE_SERVER_URL || "http://localhost:3001";

/**
 * Récupère le JWT Supabase pour authentifier le socket auprès du battle-server.
 * Le serveur le valide via `supabase.auth.getUser(token)` côté service-role.
 * Sans token valide, les events sensibles sont rejetés.
 */
async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/* ==================== Game check ==================== */

export async function isGameRunning(): Promise<boolean> {
  try {
    return await invoke<boolean>("cmd_is_game_running");
  } catch {
    return false;
  }
}

/* ==================== Room code ==================== */

export function generateRoomCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

/* ==================== Trigger ==================== */

export async function writeBattleTrigger(clusterId: number, opponentName: string, role: "host" | "client" = "host"): Promise<void> {
  const path = await invoke<string>("cmd_battle_write_trigger", {
    data: JSON.stringify({ action: "start_battle", cluster_id: clusterId, opponent_name: opponentName, role }),
  });
  console.log("[Battle] Trigger written to:", path);
}

export async function writeStopTrigger(): Promise<void> {
  try {
    await invoke("cmd_battle_write_trigger", {
      data: JSON.stringify({ action: "stop" }),
    });
  } catch {}
}

/** Ecrire un signal dans l'inbox pour que le jeu sache que l'adversaire est parti.
 *
 * Flow robuste (évite les races de file IPC sur Windows) :
 *   1. Écrire le signal → le jeu (PSDK) le lit dans `read_inbox` et SUPPRIME le fichier.
 *   2. Poller la disparition du fichier jusqu'à 5s max → confirme la consommation.
 *   3. Si le fichier existe toujours après chaque tranche de 500ms, RÉ-ÉCRIRE (le jeu
 *      peut être bloqué dans une animation longue ou avoir loupé une frame).
 *   4. Si 5s s'écoulent sans lecture, on renvoie quand même — le jeu a peut-être planté.
 *
 * Cette fonction NE SUPPRIME PAS le fichier — c'est au jeu de le faire après lecture.
 * Ne pas appeler cleanupBattleFiles avant que cette fonction ait résolu.
 */
export async function writeOpponentLeft(reason: string): Promise<void> {
  const payload = JSON.stringify([{ id: 0, state: ["opponent_left", reason], party: [] }]);
  const writeOnce = async () => {
    try {
      await invoke("cmd_battle_write_inbox", { data: payload });
      return true;
    } catch (e) {
      console.warn("[Battle] writeOpponentLeft invoke error:", e);
      return false;
    }
  };

  // Écriture initiale
  const initialOk = await writeOnce();
  if (!initialOk) {
    // Retry immédiat une fois en cas d'échec Tauri
    await writeOnce();
  }
  console.log("[Battle] opponent_left written to inbox, reason:", reason);

  // Attendre que le jeu lise (= inbox supprimée) OU 5s max.
  // Ré-écrit toutes les 500ms si toujours présent (robustesse).
  const deadline = Date.now() + 5000;
  let lastRewrite = Date.now();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    let exists = true;
    try {
      exists = await invoke<boolean>("cmd_battle_inbox_exists");
    } catch {
      // Si la commande échoue, on continue à attendre.
    }
    if (!exists) {
      console.log("[Battle] opponent_left consumed by game after", Date.now() - (deadline - 5000), "ms");
      return;
    }
    // Ré-écrire toutes les 500ms tant que le jeu n'a pas lu — couvre les cas où
    // le jeu a loupé la frame exacte de l'écriture (race read-during-write).
    if (Date.now() - lastRewrite >= 500) {
      await writeOnce();
      lastRewrite = Date.now();
    }
  }
  console.warn("[Battle] opponent_left never consumed (5s timeout) — game may be stuck or closed");
}

/* ==================== Cleanup ==================== */

export async function saveBattleLog(log: {
  roomCode: string;
  myUserId: string;
  partnerId: string;
  partnerName: string;
  result: string;
  reason: string;
  turns: number;
  startedAt: string;
  endedAt: string;
  turnLog?: { turn: number; sentAt: string; resolvedAt: string; rngCount: number; myActions: any; opponentActions: any }[];
  eventLog?: { time: string; event: string; data?: any }[];
}): Promise<void> {
  try {
    const path = await invoke<string>("cmd_battle_save_log", { data: JSON.stringify(log, null, 2) });
    console.log("[Battle] Log saved to:", path);
  } catch (e) {
    console.warn("[Battle] Failed to save log:", e);
  }
}

export async function cleanupBattleFiles(): Promise<void> {
  console.trace("[Battle] cleanupBattleFiles called from:");
  try { await invoke("cmd_battle_cleanup"); } catch {}
}

export async function fullCleanup(relayCleanupRef: React.MutableRefObject<(() => void) | null>): Promise<void> {
  if (relayCleanupRef.current) {
    relayCleanupRef.current();
    relayCleanupRef.current = null;
  }
  await writeStopTrigger();
  await cleanupBattleFiles();
}

/* ==================== Lobby (invite system via Socket.io) ==================== */

let lobbySocket: Socket | null = null;
let lobbyUserId: string | null = null;

import type { TradeSelectionPreview } from "./types";

export interface BattleInvitePayload {
  roomCode: string; fromId: string; fromName: string; fromAvatar: string | null;
  toId: string; dmChannelId: number;
  betMode?: boolean;
  betPreview?: TradeSelectionPreview;
  betPokemonB64?: string;
}

export interface BattleAcceptPayload {
  roomCode: string; fromId: string; acceptedBy: string; partnerName: string;
  betPreview?: TradeSelectionPreview;
  betPokemonB64?: string;
}

export interface LobbyCallbacks {
  onInvite: (payload: BattleInvitePayload) => void;
  onAccepted: (payload: BattleAcceptPayload) => void;
  onDeclined: (payload: { roomCode: string; userId: string }) => void;
  onCancelled: (payload: { roomCode: string; userId: string }) => void;
}

/**
 * Connexion persistante au serveur Railway pour le systeme d'invitation.
 * Reutilise le socket existant si deja connecte avec le meme userId.
 * Retourne une cleanup function.
 */
export function connectLobby(userId: string, callbacks: LobbyCallbacks): () => void {
  // Reutiliser le socket existant si deja connecte avec le meme userId
  if (lobbySocket && lobbyUserId === userId && lobbySocket.connected) {
    console.log("[BattleLobby] Reusing existing connection for", userId);
    // Mettre a jour les callbacks (les listeners precedents sont remplaces)
    lobbySocket.removeAllListeners("battle_invite");
    lobbySocket.removeAllListeners("battle_accepted");
    lobbySocket.removeAllListeners("battle_declined");
    lobbySocket.removeAllListeners("battle_cancelled");
    lobbySocket.on("battle_invite", (payload) => { callbacks.onInvite(payload); });
    lobbySocket.on("battle_accepted", (payload) => { callbacks.onAccepted(payload); });
    lobbySocket.on("battle_declined", (payload) => { callbacks.onDeclined(payload); });
    lobbySocket.on("battle_cancelled", (payload) => { callbacks.onCancelled(payload); });
    return () => {
      // Ne PAS deconnecter — le socket est partage et persistant
    };
  }

  if (lobbySocket) { lobbySocket.disconnect(); lobbySocket = null; }
  lobbyUserId = userId;

  // Le socket envoie le JWT au handshake. `auth` est lu à chaque (re)connexion
  // par socket.io-client → on utilise une fonction async pour rafraîchir le
  // token si la session a été refresh entre-temps.
  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    auth: (cb) => {
      getAuthToken().then((token) => cb({ token: token ?? "" }));
    },
  });
  lobbySocket = socket;

  socket.on("connect", () => {
    console.log("[BattleLobby] Connected:", socket.id);
    socket.emit("register_user", {});
  });

  socket.on("connect_error", (err) => {
    if (/auth/i.test(err.message)) {
      console.warn("[BattleLobby] Auth failed:", err.message, "— reconnect after session refresh");
    }
  });

  socket.on("connect_error", (err) => {
    console.warn("[BattleLobby] Connection error:", err.message);
  });

  socket.on("battle_invite", (payload) => {
    console.log("[BattleLobby] Invite received from", payload.fromName, "room", payload.roomCode);
    callbacks.onInvite(payload);
  });

  socket.on("battle_accepted", (payload) => {
    console.log("[BattleLobby] Invite accepted for room", payload.roomCode);
    callbacks.onAccepted(payload);
  });

  socket.on("battle_declined", (payload) => {
    console.log("[BattleLobby] Invite declined for room", payload.roomCode);
    callbacks.onDeclined(payload);
  });

  socket.on("battle_cancelled", (payload) => {
    console.log("[BattleLobby] Invite cancelled for room", payload.roomCode);
    callbacks.onCancelled(payload);
  });

  return () => {
    // Ne PAS deconnecter sur cleanup React — garder la connexion persistante
    // Seul disconnectLobby() deconnecte vraiment (quand on quitte le chat)
  };
}

export function disconnectLobby(): void {
  if (lobbySocket) { lobbySocket.disconnect(); lobbySocket = null; lobbyUserId = null; }
}

export function sendBattleInvite(payload: BattleInvitePayload): boolean {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send invite"); return false; }
  lobbySocket.emit("battle_invite", payload);
  return true;
}

export function sendBattleAccept(payload: BattleAcceptPayload): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send accept"); return; }
  lobbySocket.emit("battle_accept", payload);
}

export function sendBattleDecline(roomCode: string, fromId: string, _userId: string): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send decline"); return; }
  // userId est dérivé du JWT côté serveur — ignoré ici.
  lobbySocket.emit("battle_decline", { roomCode, fromId });
}

export function sendBattleCancel(roomCode: string, toId: string, _userId: string): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send cancel"); return; }
  // userId est dérivé du JWT côté serveur — ignoré ici.
  lobbySocket.emit("battle_cancel", { roomCode, toId });
}

/* ==================== Ranked Queue (matchmaking) ==================== */

import type { RankTier } from "./ranked";

export type RankedOpponentPreview = {
  id: string;
  name: string;
  mmr: number;
  tier: RankTier;
};

export type RankedMatchFoundPayload = {
  roomCode: string;
  opponent: RankedOpponentPreview;
  acceptTimeoutMs: number;
};

export type RankedMatchStartPayload = {
  roomCode: string;
  opponent: RankedOpponentPreview;
};

export type RankedQueueJoinedPayload = {
  mmr: number;
  tier: RankTier;
  placementPlayed: number;
};

export type RankedMatchCancelReason =
  | "timeout"
  | "declined"
  | "opponent_disconnected"
  | "unknown";

export interface RankedQueueCallbacks {
  onJoined: (payload: RankedQueueJoinedPayload) => void;
  onStatus: (payload: { waitMs: number; mmrWindow: number | null }) => void;
  onMatchFound: (payload: RankedMatchFoundPayload) => void;
  onMatchStart: (payload: RankedMatchStartPayload) => void;
  onMatchCancelled: (payload: { roomCode: string; reason: RankedMatchCancelReason }) => void;
  onLeft: () => void;
  onError: (message: string) => void;
}

/** Installe les listeners ranked queue sur le socket lobby existant. Retourne un cleanup. */
export function attachRankedQueueListeners(callbacks: RankedQueueCallbacks): () => void {
  if (!lobbySocket) {
    console.warn("[RankedQueue] lobby socket not connected — attach ignored");
    return () => {};
  }
  const socket = lobbySocket;
  const onJoined = (p: RankedQueueJoinedPayload) => callbacks.onJoined(p);
  const onStatus = (p: { waitMs: number; mmrWindow: number | null }) => callbacks.onStatus(p);
  const onFound = (p: RankedMatchFoundPayload) => callbacks.onMatchFound(p);
  const onStart = (p: RankedMatchStartPayload) => callbacks.onMatchStart(p);
  const onCancelled = (p: { roomCode: string; reason: RankedMatchCancelReason }) =>
    callbacks.onMatchCancelled(p);
  const onLeft = () => callbacks.onLeft();
  const onError = (p: { message: string }) => callbacks.onError(p?.message ?? "unknown");

  socket.on("ranked_queue_joined", onJoined);
  socket.on("ranked_queue_status", onStatus);
  socket.on("ranked_match_found", onFound);
  socket.on("ranked_match_start", onStart);
  socket.on("ranked_match_cancelled", onCancelled);
  socket.on("ranked_queue_left", onLeft);
  socket.on("ranked_queue_error", onError);

  return () => {
    socket.off("ranked_queue_joined", onJoined);
    socket.off("ranked_queue_status", onStatus);
    socket.off("ranked_match_found", onFound);
    socket.off("ranked_match_start", onStart);
    socket.off("ranked_match_cancelled", onCancelled);
    socket.off("ranked_queue_left", onLeft);
    socket.off("ranked_queue_error", onError);
  };
}

export function sendRankedQueueJoin(_userId: string, displayName: string): boolean {
  if (!lobbySocket?.connected) { console.warn("[RankedQueue] Not connected"); return false; }
  lobbySocket.emit("ranked_queue_join", { displayName });
  return true;
}

export function sendRankedQueueLeave(_userId: string): void {
  if (!lobbySocket?.connected) return;
  lobbySocket.emit("ranked_queue_leave", {});
}

export function sendRankedAccept(roomCode: string, _userId: string): void {
  if (!lobbySocket?.connected) return;
  lobbySocket.emit("ranked_accept", { roomCode });
}

export function sendRankedDecline(roomCode: string, _userId: string): void {
  if (!lobbySocket?.connected) return;
  lobbySocket.emit("ranked_decline", { roomCode });
}

/* ==================== Socket.io Relay ==================== */

let battleSocket: Socket | null = null;

/**
 * Émet `battle_end` au serveur (cas où le combat se termine sans que le jeu
 * ait écrit `battle_result` dans l'outbox — forfeit volontaire, crash, etc.)
 * et attend le `match_token` signé en réponse. Permet d'enregistrer le résultat
 * via `record_*_battle` en mode strict (token requis).
 *
 * Retourne `null` si le socket n'est pas connecté ou si le serveur n'a pas
 * répondu dans `timeoutMs`. Le caller peut alors fallback (ex: skip record).
 */
export function emitBattleEndAndAwaitToken(
  roomCode: string,
  result: "win" | "loss" | "draw",
  matchType: "ranked" | "amical",
  timeoutMs = 2000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = battleSocket;
    if (!sock || !sock.connected) {
      resolve(null);
      return;
    }
    let resolved = false;
    const onToken = (data: { roomCode?: string; token?: string }) => {
      if (resolved) return;
      if (data?.roomCode === roomCode && data?.token) {
        resolved = true;
        sock.off("match_token", onToken);
        resolve(data.token);
      }
    };
    sock.on("match_token", onToken);
    sock.emit("battle_end", { roomCode, result, matchType });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sock.off("match_token", onToken);
        resolve(null);
      }
    }, timeoutMs);
  });
}

/** Logs detailles du combat en cours — accessibles pour saveBattleLog */
export let _currentBattleTurnLog: any[] = [];
export let _currentBattleEventLog: any[] = [];

/**
 * Demarre le relay entre le jeu local et le serveur de combat.
 *
 * 1. Connecte au serveur Socket.io
 * 2. Rejoint la room du combat
 * 3. Echange les donnees initiales (equipes)
 * 4. Poll l'outbox du jeu — quand le jeu envoie des actions, les transmet au serveur
 * 5. Le serveur renvoie: actions adverses + RNG partage
 * 6. Ecrit dans l'inbox du jeu: donnees adverses + RNG
 *
 * Retourne une cleanup function.
 */
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _audioCtx;
}

export function playTurnSound(): void {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch {}
}

/** Type de match — le serveur en a besoin pour signer le bon match_type dans le HMAC. */
export type BattleMatchType = "ranked" | "amical";

export function startRelay(
  roomCode: string,
  myUserId: string,
  onBattleStarted?: () => void,
  onDisconnect?: (reason?: "forfeit" | "crash" | "opponent_forfeit" | "opponent_crash" | "game_end" | "opponent_game_end") => void,
  onTurnReady?: () => void,
  onSpectatorCount?: (count: number) => void,
  onBattleResult?: (result: string, matchToken?: string | null) => void,
  matchType: BattleMatchType = "amical",
): () => void {
  let running = true;
  let battleDetected = false;
  let disconnectFired = false;
  let selfBattleResultSent = false; // true quand NOTRE jeu a ecrit battle_result dans l'outbox
  let pendingOutbox: string | null = null;
  let lastSentHash = "";
  let waitingForServer = false;
  let initialDataSent = false; // envoyer player_data UNE SEULE FOIS
  let lastResolvedTurn = 0; // guard: ignorer les battle_command pour les tours deja resolus
  let switchResolvedForPhase = false; // guard: ignorer les battle_switch apres resolution
  // ─── Match token (HMAC signed by battle-server) ───
  // Stocké à réception de l'event `match_token`. Passé à onBattleResult pour
  // que le caller puisse le forwarder à record_*_battle qui vérifie la signature.
  let latestMatchToken: string | null = null;
  let matchTokenResolver: ((t: string | null) => void) | null = null;
  const awaitMatchToken = (timeoutMs = 1500): Promise<string | null> => {
    if (latestMatchToken) return Promise.resolve(latestMatchToken);
    return new Promise((resolve) => {
      matchTokenResolver = resolve;
      setTimeout(() => {
        if (matchTokenResolver) {
          matchTokenResolver(latestMatchToken);
          matchTokenResolver = null;
        }
      }, timeoutMs);
    });
  };
  const fireBattleResult = async (result: string) => {
    if (!onBattleResult) return;
    const token = await awaitMatchToken();
    onBattleResult(result, token);
  };
  const turnLog: { turn: number; sentAt: string; resolvedAt: string; rngCount: number; rngSeeds?: number[]; myActions: any; opponentActions: any; waitTimeMs?: number }[] = [];
  const eventLog: { time: string; event: string; data?: any }[] = [];
  // Exposer les logs pour saveBattleLog
  _currentBattleTurnLog = turnLog;
  _currentBattleEventLog = eventLog;

  eventLog.push({ time: new Date().toISOString(), event: "relay_start", data: { roomCode, userId: myUserId, serverUrl: BATTLE_SERVER_URL } });
  console.log("[BattleRelay] Starting relay for room", roomCode, "via", BATTLE_SERVER_URL);

  // ─── Connect to battle server ───
  // auth: () => ... récupère le JWT à chaque (re)connexion. Le serveur valide
  // via supabase.auth.getUser() et bind socket.data.userId — les payloads
  // qui prétendent être un autre user sont ignorés.
  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    auth: (cb) => {
      getAuthToken().then((token) => cb({ token: token ?? "" }));
    },
  });
  battleSocket = socket;

  socket.on("connect", () => {
    console.log("[BattleRelay] Connected to server:", socket.id);
    eventLog.push({ time: new Date().toISOString(), event: "socket_connect", data: { socketId: socket.id } });
    socket.emit("join_room", { roomCode });
  });

  socket.on("connect_error", (err) => {
    console.error("[BattleRelay] Connection error:", err.message);
    eventLog.push({ time: new Date().toISOString(), event: "socket_error", data: { error: err.message } });
  });

  socket.on("disconnect", (reason) => {
    eventLog.push({ time: new Date().toISOString(), event: "socket_disconnect", data: { reason } });
  });

  socket.on("reconnect", (attempt: number) => {
    eventLog.push({ time: new Date().toISOString(), event: "socket_reconnect", data: { attempt } });
  });

  // ─── Receive opponent initial data ───
  socket.on("opponent_data", async (msg: { fullPlayerData: any }) => {
    // Guard : ignorer les events stale après déconnexion. Sinon un event en vol
    // peut écraser `vms_inbox.json` juste après qu'on y ait écrit opponent_left.
    if (disconnectFired) {
      eventLog.push({ time: new Date().toISOString(), event: "opponent_data_dropped_after_disconnect" });
      return;
    }
    console.log("[BattleRelay] Received opponent initial data");
    // Log les donnees d'equipe adverses
    const opParty = msg.fullPlayerData?.party;
    eventLog.push({ time: new Date().toISOString(), event: "opponent_data_received", data: {
      opponentName: msg.fullPlayerData?.name,
      opponentId: msg.fullPlayerData?.id,
      partySize: Array.isArray(opParty) ? opParty.length : 0,
      party: Array.isArray(opParty) ? opParty.map((p: any) => ({ id: p?.id, level: p?.level, name: p?.given_name })) : [],
    }});
    try {
      await invoke("cmd_battle_write_inbox", {
        data: JSON.stringify([msg.fullPlayerData]),
      });
    } catch (e) {
      console.error("[BattleRelay] Write inbox error:", e);
      eventLog.push({ time: new Date().toISOString(), event: "error_write_inbox", data: { context: "opponent_data", error: String(e) } });
    }
  });

  // ─── Receive turn resolution (actions + RNG) ───
  socket.on("turn_resolved", async (msg: { turn: number; opponentData: any; rng: number[] }) => {
    // Guard : ignorer les events stale après déconnexion. Sinon un turn_resolved
    // en vol peut écraser l'opponent_left qu'on vient d'écrire dans l'inbox.
    if (disconnectFired) {
      eventLog.push({ time: new Date().toISOString(), event: "turn_resolved_dropped_after_disconnect", data: { turn: msg.turn } });
      return;
    }
    console.log("[BattleRelay] Turn", msg.turn, "resolved —", msg.rng.length, "RNG values");
    waitingForServer = false;
    lastResolvedTurn = msg.turn;
    switchResolvedForPhase = false; // nouveau tour = reset du guard switch

    // Log detaille du tour
    const rngSeeds = msg.rng.slice(0, 4).map((v) => Math.floor(v * 2147483647));
    const existingTurn = turnLog.find((t) => t.turn === msg.turn);
    if (existingTurn) {
      existingTurn.resolvedAt = new Date().toISOString();
      existingTurn.rngCount = msg.rng.length;
      existingTurn.rngSeeds = rngSeeds;
      existingTurn.opponentActions = msg.opponentData?.state;
      existingTurn.waitTimeMs = existingTurn.sentAt ? new Date().getTime() - new Date(existingTurn.sentAt).getTime() : 0;
    } else {
      turnLog.push({ turn: msg.turn, sentAt: "", resolvedAt: new Date().toISOString(), rngCount: msg.rng.length, rngSeeds, myActions: null, opponentActions: msg.opponentData?.state, waitTimeMs: 0 } as any);
    }

    const opponentData = msg.opponentData;
    if (opponentData) {
      opponentData.vms_rng = msg.rng;
    }

    try {
      await invoke("cmd_battle_write_inbox", {
        data: JSON.stringify([opponentData]),
      });
    } catch (e) {
      console.error("[BattleRelay] Write inbox error:", e);
      eventLog.push({ time: new Date().toISOString(), event: "error_write_inbox", data: { context: "turn_resolved", turn: msg.turn, error: String(e) } });
    }
    onTurnReady?.();
  });

  // ─── Receive switch resolution ───
  socket.on("switch_resolved", async (msg: { opponentData: any; opponentSwitchInfo: any }) => {
    // Guard : ignorer les events stale après déconnexion.
    if (disconnectFired) {
      eventLog.push({ time: new Date().toISOString(), event: "switch_resolved_dropped_after_disconnect" });
      return;
    }
    console.log("[BattleRelay] Switch resolved");
    waitingForServer = false;
    eventLog.push({ time: new Date().toISOString(), event: "switch_resolved", data: { opponentSwitchInfo: msg.opponentSwitchInfo, hasOpponentData: !!msg.opponentData } });

    try {
      await invoke("cmd_battle_write_inbox", {
        data: JSON.stringify([msg.opponentData]),
      });
    } catch (e) {
      console.error("[BattleRelay] Write inbox error:", e);
      eventLog.push({ time: new Date().toISOString(), event: "error_write_inbox", data: { context: "switch_resolved", error: String(e) } });
    }
    // NE PAS appeler onTurnReady ici — les switch ne sont pas des tours
  });

  // ─── Spectator count update ───
  socket.on("spectator_count", (data: { count: number }) => {
    console.log("[BattleRelay] Spectators:", data.count);
    onSpectatorCount?.(data.count);
  });

  // ─── Match token (HMAC signed by server) ───
  // Émis par le serveur quand un joueur émet battle_end. Contient un token signé
  // que le client passe à record_*_battle pour prouver l'authenticité du résultat.
  socket.on("match_token", (data: { roomCode?: string; result?: string; matchType?: string; token?: string }) => {
    if (!data?.token || data.roomCode !== roomCode) return;
    latestMatchToken = data.token;
    eventLog.push({ time: new Date().toISOString(), event: "match_token_received", data: { result: data.result, matchType: data.matchType } });
    if (matchTokenResolver) {
      matchTokenResolver(data.token);
      matchTokenResolver = null;
    }
  });

  /**
   * Helper : si un battle_result était bloqué dans pendingOutbox (parce que waitingForServer),
   * le traiter AVANT de fire onDisconnect — sinon le résultat est perdu.
   */
  const flushPendingBattleResult = () => {
    if (!pendingOutbox) return;
    try {
      const pd = JSON.parse(pendingOutbox);
      if (Array.isArray(pd) && pd[0] === "battle_result") {
        const result = pd[1]?.result;
        console.log("[BattleRelay] Flushing pending battle_result before disconnect:", result);
        eventLog.push({ time: new Date().toISOString(), event: "flush_pending_battle_result", data: { result } });
        // Émettre battle_end au serveur pour récupérer un match_token signé.
        if (socket.connected) socket.emit("battle_end", { roomCode, result, matchType });
        void fireBattleResult(result || "unknown");
      }
    } catch { /* ignore */ }
    pendingOutbox = null;
  };

  // ─── Battle ended by opponent (result from their game) ───
  socket.on("battle_ended", (data: { roomCode?: string; result?: string; reason?: string }) => {
    console.log("[BattleRelay] Battle ended by opponent, our result:", data.result, "selfEnded:", selfBattleResultSent);
    eventLog.push({ time: new Date().toISOString(), event: "battle_ended", data: { ...data, selfBattleResultSent } });
    if (!disconnectFired) {
      flushPendingBattleResult();
      disconnectFired = true;
      running = false;
      void fireBattleResult(data.result || "unknown");
      // Si NOTRE jeu a deja ecrit battle_result, le combat s'est termine normalement
      // des deux cotes → pas besoin de signal opponent_left. Sinon, l'adversaire a
      // quitte PENDANT qu'on jouait encore → on doit signaler au jeu.
      onDisconnect?.(selfBattleResultSent ? "game_end" : "opponent_game_end");
    }
  });

  // ─── Opponent disconnected ───
  socket.on("player_left", (data: { userId?: string; reason?: string }) => {
    const rawReason = data?.reason || "unknown";
    // forfeit = abandon via bouton in-game → victoire pour nous
    // crash = vrai crash technique du jeu adverse → match nul
    // game_end = fin normale via battle_result → opponent_game_end si on joue encore
    const reason: "opponent_forfeit" | "opponent_game_end" | "opponent_crash" =
      rawReason === "game_end" ? "opponent_game_end"
      : rawReason === "forfeit" ? "opponent_forfeit"
      : rawReason === "crash" ? "opponent_crash"
      : "opponent_crash";
    console.log("[BattleRelay] Opponent left, reason:", reason, "(raw:", rawReason, ")");
    eventLog.push({ time: new Date().toISOString(), event: "player_left", data: { reason, rawReason } });
    if (!disconnectFired) {
      flushPendingBattleResult();
      disconnectFired = true;
      running = false;
      onDisconnect?.(reason);
    }
  });

  // ─── Poll outbox and send to server ───
  const poll = async () => {
    while (running) {
      try {
        let raw: string | null = pendingOutbox;
        if (!raw) {
          raw = await invoke<string | null>("cmd_battle_read_outbox");
        }

        if (raw && raw.length > 2) {
          let data: any;
          try { data = JSON.parse(raw); } catch { await sleep(POLL_INTERVAL); continue; }

          const hash = simpleHash(raw);
          if (hash === lastSentHash) {
            pendingOutbox = null;
            await sleep(POLL_INTERVAL);
            continue;
          }

          const messageType = Array.isArray(data) ? data[0] : null;
          const playerData = Array.isArray(data) && data.length > 1 ? data[1] : null;

          // Si on attend la réponse du serveur (turn en cours), mettre en attente SAUF
          // les messages prioritaires (battle_result / disconnect) qui doivent être traités
          // immédiatement — sinon le résultat est perdu si l'adversaire quitte via socket.
          if ((!socket.connected || waitingForServer) && messageType !== "battle_result" && messageType !== "disconnect") {
            pendingOutbox = raw;
            await sleep(POLL_INTERVAL);
            continue;
          }

          if (!playerData) {
            pendingOutbox = null;
            await sleep(POLL_INTERVAL);
            continue;
          }

          // Detect message type from VMS state
          const state = playerData.state;
          const stateType = Array.isArray(state) ? state[0] : null;

          if (messageType === "connect" || messageType === "update") {
            if (stateType === "battle_command" || stateType === ":battle_command") {
              // Turn actions — send to server for synchronized resolution
              const turn = state[2];
              // Guard: ignorer les re-envois de tours deja resolus (evite de bloquer les switch)
              if (typeof turn === "number" && turn <= lastResolvedTurn) {
                eventLog.push({ time: new Date().toISOString(), event: "turn_dedup_skipped", data: { turn, lastResolvedTurn } });
                lastSentHash = hash;
                pendingOutbox = null;
                await sleep(POLL_INTERVAL);
                continue;
              }
              console.log("[BattleRelay] Sending turn", turn, "actions to server");
              turnLog.push({ turn, sentAt: new Date().toISOString(), resolvedAt: "", rngCount: 0, myActions: state[3], opponentActions: null });
              socket.emit("turn_actions", {
                roomCode,
                turn,
                fullPlayerData: playerData,
              });
              waitingForServer = true;
              lastSentHash = hash;
              pendingOutbox = null;
            } else if (stateType === "battle_switch" || stateType === ":battle_switch") {
              // Guard: ignorer les switch deja resolus pour cette phase
              if (switchResolvedForPhase) {
                lastSentHash = hash;
                pendingOutbox = null;
                await sleep(POLL_INTERVAL);
                continue;
              }
              // Forced switch — send to server
              console.log("[BattleRelay] Sending forced switch to server");
              eventLog.push({ time: new Date().toISOString(), event: "switch_sent", data: { switchInfo: state[2] } });
              socket.emit("switch_data", {
                roomCode,
                switchInfo: state[2],
                fullPlayerData: playerData,
              });
              switchResolvedForPhase = true; // Bloquer les re-envois jusqu'au prochain tour
              waitingForServer = true;
              lastSentHash = hash;
              pendingOutbox = null;
            } else if (!initialDataSent) {
              // Envoyer les donnees initiales UNE SEULE FOIS (premier message avec party)
              if (playerData.party && playerData.party.length > 0) {
                initialDataSent = true;
                console.log("[BattleRelay] Sending initial player data to server");
                eventLog.push({ time: new Date().toISOString(), event: "initial_data_sent", data: {
                  name: playerData.name,
                  trainerId: playerData.id,
                  partySize: playerData.party.length,
                  party: playerData.party.map((p: any) => ({ id: p?.id, level: p?.level, name: p?.given_name })),
                }});
                socket.emit("player_data", {
                  roomCode,
                  fullPlayerData: playerData,
                });
              }
              lastSentHash = hash;
              pendingOutbox = null;
            } else {
              // Regular update — ne pas envoyer au serveur (juste consommer l'outbox)
              lastSentHash = hash;
              pendingOutbox = null;
            }
          } else if (messageType === "disconnect") {
            // Le VMS envoie "disconnect" quand le combat se termine (VMS.leave)
            // Ce n'est PAS un forfait — c'est une fin normale. Le vrai forfait
            // est gere par le bouton "Abandonner" dans le launcher.
            eventLog.push({ time: new Date().toISOString(), event: "game_disconnect", data: { messageType } });
            if (!disconnectFired) {
              // Race condition : si le jeu ecrit "disconnect" SANS avoir ecrit
              // "battle_result" avant (certains flow PSDK normaux), on n'a pas
              // le resultat local. Le serveur va nous l'envoyer via battle_ended
              // dans les ~500ms. On attend jusqu'a 1.5s pour laisser battle_ended
              // prendre la priorite (qui setera disconnectFired=true de son cote).
              // Si le timeout expire, on fire onDisconnect sans resultat (fallback).
              const shouldWait = !selfBattleResultSent;
              const fireDisconnect = () => {
                if (disconnectFired) return; // battle_ended a deja gere
                disconnectFired = true;
                running = false;
                socket.emit("leave_room", { roomCode, reason: "game_end" });
                onDisconnect?.("game_end");
              };
              if (shouldWait) {
                eventLog.push({ time: new Date().toISOString(), event: "disconnect_wait_for_server_result" });
                setTimeout(fireDisconnect, 1500);
              } else {
                fireDisconnect();
              }
            }
            pendingOutbox = null;
          } else if (messageType === "battle_result") {
            // Le jeu envoie le resultat (win/loss) apres le combat
            const result = playerData?.result;
            selfBattleResultSent = true; // NOTRE jeu a termine — pas besoin d'opponent_left
            console.log("[BattleRelay] Battle result from game:", result);
            eventLog.push({ time: new Date().toISOString(), event: "battle_result_from_game", data: { result } });
            socket.emit("battle_end", { roomCode, result, matchType });
            pendingOutbox = null;
            // Stopper le relay et notifier le launcher
            if (!disconnectFired) {
              disconnectFired = true;
              running = false;
              void fireBattleResult(result || "unknown");
              onDisconnect?.("game_end");
            }
          }

          // Detect battle started
          if (!battleDetected && (stateType === "battle" || stateType === ":battle")) {
            battleDetected = true;
            onBattleStarted?.();
          }

          // Detect battle ended via state transition (couvre le cas "Fuir" en jeu où le VMS
          // ne renvoie pas de message "disconnect" mais le jeu retourne à l'overworld).
          const isBattleState =
            stateType === "battle" || stateType === ":battle" ||
            stateType === "battle_command" || stateType === ":battle_command" ||
            stateType === "battle_switch" || stateType === ":battle_switch";
          if (battleDetected && !disconnectFired && stateType != null && !isBattleState) {
            console.log("[BattleRelay] State transitioned from battle to", stateType, "— treating as game_end");
            eventLog.push({ time: new Date().toISOString(), event: "battle_state_transition_end", data: { newState: stateType } });
            // Race condition : idem que messageType="disconnect". Si on n'a pas
            // notre propre battle_result, on attend 1.5s que le serveur nous
            // envoie battle_ended (via le battle_end émis par l'adversaire, ou
            // via player_left). Sinon on fallback avec onDisconnect "game_end".
            const shouldWait = !selfBattleResultSent;
            const fireTransitionDisconnect = () => {
              if (disconnectFired) return; // un autre handler a pris la main entre-temps
              disconnectFired = true;
              running = false;
              socket.emit("leave_room", { roomCode, reason: "game_end" });
              onDisconnect?.("game_end");
            };
            if (shouldWait) {
              eventLog.push({ time: new Date().toISOString(), event: "transition_wait_for_server_result" });
              setTimeout(fireTransitionDisconnect, 1500);
            } else {
              fireTransitionDisconnect();
            }
          }
        }
      } catch (pollErr) {
        eventLog.push({ time: new Date().toISOString(), event: "poll_error", data: { error: String(pollErr) } });
      }
      if (running) await sleep(POLL_INTERVAL);
    }
  };

  poll();

  // ─── Game process monitor (detection de crash pur) ───
  // Si le jeu meurt SANS avoir ecrit battle_result via l'outbox, c'est
  // un vrai crash technique (freeze, exception PSDK, etc). Traite comme
  // match nul pour les deux joueurs.
  //
  // Alt-F4 volontaire : le VMS detecte l'exception "Game Window closed"
  // et ECRIT battle_result:loss via l'outbox AVANT de mourir. Le relay
  // lit ce message et fire disconnectFired=true via le handler
  // battle_result. Le gameMonitor trouvera disconnectFired deja true
  // et ne fera rien. Resultat: Alt-F4 = defaite pour l'abandoner.
  const gameMonitor = setInterval(async () => {
    if (!running || !battleDetected) return;
    const alive = await isGameRunning();
    if (!alive && !disconnectFired) {
      console.log("[BattleRelay] Game process died — crash technique (match nul)");
      eventLog.push({ time: new Date().toISOString(), event: "game_crash_detected" });
      disconnectFired = true;
      running = false;
      socket.emit("leave_room", { roomCode, reason: "crash" });
      onDisconnect?.("crash");
    }
  }, 3000);

  // ─── Cleanup ───
  return () => {
    running = false;
    clearInterval(gameMonitor);
    if (socket.connected) {
      socket.emit("leave_room", { roomCode });
      socket.disconnect();
    }
    battleSocket = null;
  };
}

/* ==================== Spectator ==================== */

export function startSpectator(
  roomCode: string,
  myUserId: string,
  onTurnUpdate?: (data: { turn: number; players: string[] }) => void,
  onBattleEnded?: (reason: string) => void,
  onError?: (msg: string) => void,
): () => void {
  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.log("[Spectator] Connected:", socket.id);
    socket.emit("spectate_room", { roomCode, userId: myUserId });
  });

  socket.on("spectate_error", (data: { message: string }) => {
    console.warn("[Spectator] Error:", data.message);
    onError?.(data.message);
  });

  socket.on("spectate_joined", (data: { roomCode: string; players: string[] }) => {
    console.log("[Spectator] Joined room", data.roomCode, "players:", data.players);
  });

  socket.on("spectate_turn", (data: { turn: number; players: string[] }) => {
    console.log("[Spectator] Turn", data.turn, "resolved");
    onTurnUpdate?.(data);
  });

  socket.on("player_left", (data: { userId?: string; reason?: string }) => {
    console.log("[Spectator] Player left:", data.reason);
    onBattleEnded?.(data.reason || "unknown");
  });

  return () => {
    socket.emit("leave_spectate", { roomCode });
    socket.disconnect();
  };
}

/* ==================== Util ==================== */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return String(h);
}

/* ==================== Bet Transfer Trigger ==================== */

/**
 * Écrit un trigger IPC `vms_trigger.json` pour que le jeu applique
 * le transfert de pari Pokémon en mémoire (via $storage).
 */
export async function writeBetTransferTrigger(opts: {
  result: "win" | "loss" | "draw";
  receivePokemonB64?: string;
  removeBoxIdx?: number;
  removeSlotIdx?: number;
}): Promise<void> {
  const trigger: Record<string, unknown> = {
    action: "bet_transfer",
    result: opts.result,
  };
  if (opts.result === "win" && opts.receivePokemonB64) {
    trigger.receive_pokemon_b64 = opts.receivePokemonB64;
  } else if (opts.result === "loss" && opts.removeBoxIdx != null && opts.removeSlotIdx != null) {
    trigger.remove_box_idx = opts.removeBoxIdx;
    trigger.remove_slot_idx = opts.removeSlotIdx;
  }
  try {
    await invoke("cmd_battle_write_trigger", { data: JSON.stringify(trigger) });
    console.log("[BetTransfer] Trigger written:", opts.result);
  } catch (e) {
    console.error("[BetTransfer] Failed to write trigger:", e);
  }
}
