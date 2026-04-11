/**
 * battleRelay.ts — Relay entre le jeu (VMS file IPC) et le serveur de combat Socket.io.
 *
 * Le serveur collecte les actions des 2 joueurs, genere un RNG partage,
 * et renvoie le tout aux 2 joueurs EN MEME TEMPS.
 * → Les deux jeux executent avec les memes RNG = sync parfaite.
 */
import { invoke } from "@tauri-apps/api/core";
import { io, Socket } from "socket.io-client";

/* ==================== Constants ==================== */

const POLL_INTERVAL = 300;
export const BATTLE_INVITE_TIMEOUT = 60_000;

/** URL du serveur de combat — a changer quand deploye sur Railway */
const BATTLE_SERVER_URL = import.meta.env.VITE_BATTLE_SERVER_URL || "http://localhost:3001";

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

/** Ecrire un signal dans l'inbox pour que le jeu sache que l'adversaire est parti */
export async function writeOpponentLeft(reason: string): Promise<void> {
  try {
    await invoke("cmd_battle_write_inbox", {
      data: JSON.stringify([{ id: 0, state: ["opponent_left", reason], party: [] }]),
    });
    console.log("[Battle] Wrote opponent_left signal to inbox, reason:", reason);
  } catch (e) {
    console.warn("[Battle] Failed to write opponent_left:", e);
  }
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

export interface LobbyCallbacks {
  onInvite: (payload: {
    roomCode: string; fromId: string; fromName: string; fromAvatar: string | null;
    toId: string; dmChannelId: number;
  }) => void;
  onAccepted: (payload: { roomCode: string; acceptedBy: string; partnerName: string }) => void;
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

  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });
  lobbySocket = socket;

  socket.on("connect", () => {
    console.log("[BattleLobby] Connected:", socket.id);
    socket.emit("register_user", { userId });
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

export function sendBattleInvite(payload: {
  roomCode: string; fromId: string; fromName: string; fromAvatar: string | null;
  toId: string; dmChannelId: number;
}): boolean {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send invite"); return false; }
  lobbySocket.emit("battle_invite", payload);
  return true;
}

export function sendBattleAccept(roomCode: string, fromId: string, acceptedBy: string, partnerName: string): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send accept"); return; }
  lobbySocket.emit("battle_accept", { roomCode, fromId, acceptedBy, partnerName });
}

export function sendBattleDecline(roomCode: string, fromId: string, userId: string): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send decline"); return; }
  lobbySocket.emit("battle_decline", { roomCode, fromId, userId });
}

export function sendBattleCancel(roomCode: string, toId: string, userId: string): void {
  if (!lobbySocket?.connected) { console.warn("[BattleLobby] Not connected, cannot send cancel"); return; }
  lobbySocket.emit("battle_cancel", { roomCode, toId, userId });
}

/* ==================== Socket.io Relay ==================== */

let battleSocket: Socket | null = null;

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

export function startRelay(
  roomCode: string,
  myUserId: string,
  onBattleStarted?: () => void,
  onDisconnect?: (reason?: "forfeit" | "crash" | "opponent_forfeit" | "opponent_crash" | "game_end") => void,
  onTurnReady?: () => void,
  onSpectatorCount?: (count: number) => void,
  onBattleResult?: (result: string) => void,
): () => void {
  let running = true;
  let battleDetected = false;
  let disconnectFired = false;
  let pendingOutbox: string | null = null;
  let lastSentHash = "";
  let waitingForServer = false;
  let initialDataSent = false; // envoyer player_data UNE SEULE FOIS
  let lastResolvedTurn = 0; // guard: ignorer les battle_command pour les tours deja resolus
  let switchResolvedForPhase = false; // guard: ignorer les battle_switch apres resolution
  const turnLog: { turn: number; sentAt: string; resolvedAt: string; rngCount: number; rngSeeds?: number[]; myActions: any; opponentActions: any; waitTimeMs?: number }[] = [];
  const eventLog: { time: string; event: string; data?: any }[] = [];
  // Exposer les logs pour saveBattleLog
  _currentBattleTurnLog = turnLog;
  _currentBattleEventLog = eventLog;

  eventLog.push({ time: new Date().toISOString(), event: "relay_start", data: { roomCode, userId: myUserId, serverUrl: BATTLE_SERVER_URL } });
  console.log("[BattleRelay] Starting relay for room", roomCode, "via", BATTLE_SERVER_URL);

  // ─── Connect to battle server ───
  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
  battleSocket = socket;

  socket.on("connect", () => {
    console.log("[BattleRelay] Connected to server:", socket.id);
    eventLog.push({ time: new Date().toISOString(), event: "socket_connect", data: { socketId: socket.id } });
    socket.emit("join_room", { roomCode, userId: myUserId });
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

  // ─── Battle ended by opponent (result from their game) ───
  socket.on("battle_ended", (data: { roomCode?: string; result?: string; reason?: string }) => {
    console.log("[BattleRelay] Battle ended by opponent, our result:", data.result);
    eventLog.push({ time: new Date().toISOString(), event: "battle_ended", data });
    if (!disconnectFired) {
      disconnectFired = true;
      running = false;
      onBattleResult?.(data.result || "unknown");
      onDisconnect?.("game_end");
    }
  });

  // ─── Opponent disconnected ───
  socket.on("player_left", (data: { userId?: string; reason?: string }) => {
    const rawReason = data?.reason || "unknown";
    // game_end = fin normale via battle_result (Alt-F4 volontaire = loss)
    // forfeit = abandon via bouton in-game → victoire pour nous
    // crash = vrai crash technique du jeu adverse → match nul
    const reason: "opponent_forfeit" | "game_end" | "opponent_crash" =
      rawReason === "game_end" ? "game_end"
      : rawReason === "forfeit" ? "opponent_forfeit"
      : rawReason === "crash" ? "opponent_crash"
      : "opponent_crash";
    console.log("[BattleRelay] Opponent left, reason:", reason, "(raw:", rawReason, ")");
    eventLog.push({ time: new Date().toISOString(), event: "player_left", data: { reason, rawReason } });
    if (!disconnectFired) {
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

          if (!socket.connected || waitingForServer) {
            pendingOutbox = raw;
            await sleep(POLL_INTERVAL);
            continue;
          }

          const messageType = Array.isArray(data) ? data[0] : null;
          const playerData = Array.isArray(data) && data.length > 1 ? data[1] : null;

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
                userId: myUserId,
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
                userId: myUserId,
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
                  userId: myUserId,
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
              disconnectFired = true;
              running = false;
              socket.emit("leave_room", { roomCode, userId: myUserId, reason: "game_end" });
              onDisconnect?.("game_end");
            }
            pendingOutbox = null;
          } else if (messageType === "battle_result") {
            // Le jeu envoie le resultat (win/loss) apres le combat
            const result = playerData?.result;
            console.log("[BattleRelay] Battle result from game:", result);
            eventLog.push({ time: new Date().toISOString(), event: "battle_result_from_game", data: { result } });
            socket.emit("battle_end", { roomCode, userId: myUserId, result });
            pendingOutbox = null;
            // Stopper le relay et notifier le launcher
            if (!disconnectFired) {
              disconnectFired = true;
              running = false;
              onBattleResult?.(result || "unknown");
              onDisconnect?.("game_end");
            }
          }

          // Detect battle started
          if (!battleDetected && stateType === "battle" || stateType === ":battle") {
            battleDetected = true;
            onBattleStarted?.();
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
      socket.emit("leave_room", { roomCode, userId: myUserId, reason: "crash" });
      onDisconnect?.("crash");
    }
  }, 3000);

  // ─── Cleanup ───
  return () => {
    running = false;
    clearInterval(gameMonitor);
    if (socket.connected) {
      socket.emit("leave_room", { roomCode, userId: myUserId });
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
