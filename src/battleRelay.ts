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
  await invoke("cmd_battle_write_trigger", {
    data: JSON.stringify({ action: "start_battle", cluster_id: clusterId, opponent_name: opponentName, role }),
  });
}

export async function writeStopTrigger(): Promise<void> {
  try {
    await invoke("cmd_battle_write_trigger", {
      data: JSON.stringify({ action: "stop" }),
    });
  } catch {}
}

/* ==================== Cleanup ==================== */

export async function cleanupBattleFiles(): Promise<void> {
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

/* ==================== Socket.io Relay ==================== */

let battleSocket: Socket | null = null;

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
export function startRelay(
  roomCode: string,
  myUserId: string,
  onBattleStarted?: () => void,
  onDisconnect?: () => void,
): () => void {
  let running = true;
  let battleDetected = false;
  let disconnectFired = false;
  let pendingOutbox: string | null = null;
  let lastSentHash = "";
  let waitingForServer = false;

  console.log("[BattleRelay] Starting relay for room", roomCode, "via", BATTLE_SERVER_URL);

  // ─── Connect to battle server ───
  const socket = io(BATTLE_SERVER_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
  battleSocket = socket;

  socket.on("connect", () => {
    console.log("[BattleRelay] Connected to server:", socket.id);
    socket.emit("join_room", { roomCode, userId: myUserId });
  });

  socket.on("connect_error", (err) => {
    console.error("[BattleRelay] Connection error:", err.message);
  });

  // ─── Receive opponent initial data ───
  socket.on("opponent_data", async (msg: { fullPlayerData: any }) => {
    console.log("[BattleRelay] Received opponent initial data");
    try {
      await invoke("cmd_battle_write_inbox", {
        data: JSON.stringify([msg.fullPlayerData]),
      });
    } catch (e) {
      console.error("[BattleRelay] Write inbox error:", e);
    }
  });

  // ─── Receive turn resolution (actions + RNG) ───
  socket.on("turn_resolved", async (msg: { turn: number; opponentData: any; rng: number[] }) => {
    console.log("[BattleRelay] Turn", msg.turn, "resolved —", msg.rng.length, "RNG values");
    waitingForServer = false;

    // Injecter les RNG dans les donnees adverses pour que le jeu les lise
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
    }
  });

  // ─── Receive switch resolution ───
  socket.on("switch_resolved", async (msg: { opponentData: any; opponentSwitchInfo: any }) => {
    console.log("[BattleRelay] Switch resolved");
    waitingForServer = false;

    try {
      await invoke("cmd_battle_write_inbox", {
        data: JSON.stringify([msg.opponentData]),
      });
    } catch (e) {
      console.error("[BattleRelay] Write inbox error:", e);
    }
  });

  // ─── Opponent disconnected ───
  socket.on("player_left", () => {
    console.log("[BattleRelay] Opponent left");
    if (!disconnectFired) {
      disconnectFired = true;
      running = false;
      onDisconnect?.();
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
              console.log("[BattleRelay] Sending turn", turn, "actions to server");
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
              // Forced switch — send to server
              console.log("[BattleRelay] Sending forced switch to server");
              socket.emit("switch_data", {
                roomCode,
                userId: myUserId,
                switchInfo: state[2],
                fullPlayerData: playerData,
              });
              waitingForServer = true;
              lastSentHash = hash;
              pendingOutbox = null;
            } else {
              // Regular update (initial data exchange, idle state, etc.)
              socket.emit("player_data", {
                roomCode,
                userId: myUserId,
                fullPlayerData: playerData,
              });
              lastSentHash = hash;
              pendingOutbox = null;
            }
          } else if (messageType === "disconnect") {
            if (!disconnectFired) {
              disconnectFired = true;
              running = false;
              onDisconnect?.();
            }
            pendingOutbox = null;
          }

          // Detect battle started
          if (!battleDetected && stateType === "battle" || stateType === ":battle") {
            battleDetected = true;
            onBattleStarted?.();
          }
        }
      } catch {}
      if (running) await sleep(POLL_INTERVAL);
    }
  };

  poll();

  // ─── Cleanup ───
  return () => {
    running = false;
    if (socket.connected) {
      socket.emit("leave_room", { roomCode, userId: myUserId });
      socket.disconnect();
    }
    battleSocket = null;
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
