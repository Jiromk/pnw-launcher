/**
 * PNW Battle Server — Resolution de tours synchronisee
 *
 * Le serveur ne connait PAS les regles Pokemon.
 * Il fait 3 choses :
 *   1. Collecter les actions des 2 joueurs
 *   2. Generer un tableau de RNG partage
 *   3. Envoyer les actions + RNG aux 2 joueurs EN MEME TEMPS
 *
 * Les deux jeux executent avec les memes RNG → meme resultat → sync parfaite.
 */

const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");
const rankedQueue = require("./rankedQueue");

const PORT = process.env.PORT || 3001;
const RNG_VALUES_PER_TURN = 300; // doit couvrir TOUS les rand() d'un tour (multi-hit, abilities, weather, etc.)
const SWITCH_TIMEOUT_MS = 15000; // timeout si un seul joueur envoie ses switch forces
const MAX_PLAYER_DATA_BYTES = 256 * 1024; // 256 KB par payload (~50 KB suffit normalement)
const MAX_PARTY_SIZE = 6;
const MAX_OBJECT_DEPTH = 12;
const MAX_TURN_NUMBER = 1000; // un combat dépasse rarement 100 tours

/**
 * Anti-DoS : refuse les payloads dont la profondeur d'imbrication dépasse N.
 * Un attaquant peut sinon envoyer `{a:{a:{a:{...10000 niveaux}}}}` qui force
 * Socket.io à parser puis réémettre vers l'autre joueur.
 */
function isPayloadShapeOk(value, maxDepth = MAX_OBJECT_DEPTH) {
  if (value == null) return true;
  if (typeof value !== "object") return true;
  if (maxDepth <= 0) return false;
  if (Array.isArray(value)) {
    if (value.length > 1024) return false;
    return value.every((v) => isPayloadShapeOk(v, maxDepth - 1));
  }
  const keys = Object.keys(value);
  if (keys.length > 256) return false;
  return keys.every((k) => isPayloadShapeOk(value[k], maxDepth - 1));
}

/**
 * Validation légère du `fullPlayerData` : structure attendue + tailles raisonnables.
 * On ne valide pas les règles Pokémon (le serveur n'en connaît rien) mais on rejette
 * les payloads manifestement malformés ou abusifs.
 */
function isFullPlayerDataValid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!isPayloadShapeOk(data)) return false;
  if (Array.isArray(data.party) && data.party.length > MAX_PARTY_SIZE) return false;
  return true;
}

// ==================== Match HMAC token ====================
// Le serveur signe le résultat de chaque match avec HMAC-SHA256.
// Le client passe le token au RPC record_*_battle qui vérifie la signature
// via Vault (secret partagé). Empêche un user d'enregistrer des résultats
// fictifs sans avoir réellement joué le match.
const MATCH_HMAC_SECRET = process.env.MATCH_HMAC_SECRET;
const MATCH_TOKEN_TTL_SEC = 600; // 10 min : couvre largement l'écriture côté client

if (!MATCH_HMAC_SECRET) {
  console.warn("[MatchToken] MATCH_HMAC_SECRET manquant — tokens non émis (clients en mode legacy).");
}

/**
 * Génère un token signé pour un résultat de match.
 * Format : base64url(json_payload).base64url(hmac_sha256(json_b64))
 *
 * Postgres `verify_match_token()` vérifie que :
 * - HMAC valide (recalculé avec le même secret depuis Vault)
 * - exp > now()
 * - room_code, user_id, opponent_id, result, match_type identiques aux paramètres du RPC
 */
function generateMatchToken({ roomCode, userId, opponentId, result, matchType }) {
  if (!MATCH_HMAC_SECRET) return null;
  const payload = {
    room_code: roomCode,
    user_id: userId,
    opponent_id: opponentId,
    result,
    match_type: matchType,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + MATCH_TOKEN_TTL_SEC,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", MATCH_HMAC_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

// ==================== Auth (Supabase JWT) ====================
// Le serveur valide le JWT envoyé par le client (handshake.auth.token).
// Source de vérité pour userId : socket.data.userId — ne JAMAIS faire confiance
// au userId envoyé dans les payloads.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const supabaseAuth = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
if (!supabaseAuth) {
  console.warn("[Auth] SUPABASE_URL ou key manquants — auth désactivée (mode dev uniquement).");
}

// ==================== Lobby (user -> sockets) ====================

/** @type {Map<string, Set<string>>} userId -> Set<socketId> */
const userSockets = new Map();

function registerUser(userId, socketId) {
  let set = userSockets.get(userId);
  if (!set) { set = new Set(); userSockets.set(userId, set); }
  set.add(socketId);
}

function unregisterSocket(socketId) {
  for (const [userId, set] of userSockets) {
    set.delete(socketId);
    if (set.size === 0) userSockets.delete(userId);
  }
}

/** Emit to all sockets of a given userId */
function emitToUser(userId, event, data, io) {
  const set = userSockets.get(userId);
  if (!set) return false;
  for (const sid of set) io.to(sid).emit(event, data);
  return true;
}

// ==================== Room management ====================

/** @type {Map<string, BattleRoom>} */
const rooms = new Map();

/**
 * @typedef {Object} BattleRoom
 * @property {string} code
 * @property {Map<string, {socketId: string, trainerId: number}>} players
 * @property {Map<string, {turn: number, actions: any[], fullData: any}>} turnData
 * @property {Map<string, any>} switchData - switch forces (KO)
 * @property {Map<string, any>} initialData - donnees initiales d'echange
 */

function getOrCreateRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = {
      code,
      players: new Map(),
      spectators: new Set(),
      turnData: new Map(),
      switchData: new Map(),
      initialData: new Map(),
    };
    rooms.set(code, room);
  }
  return room;
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (room && room.players.size === 0) {
    rooms.delete(code);
    console.log(`[Room ${code}] Supprimee (vide)`);
  }
}

function removePlayerFromAllRooms(socketId, io) {
  for (const [code, room] of rooms) {
    // Spectator cleanup
    if (room.spectators.has(socketId)) {
      room.spectators.delete(socketId);
      for (const [, player] of room.players) {
        io.to(player.socketId).emit("spectator_count", { count: room.spectators.size });
      }
    }
    for (const [userId, player] of room.players) {
      if (player.socketId === socketId) {
        room.players.delete(userId);
        // Socket mort sans leave_room = crash probable
        io.to(code).emit("player_left", { userId, reason: "crash" });
        console.log(`[Room ${code}] ${userId} deconnecte (crash)`);
      }
    }
    cleanupRoom(code);
  }
}

// ==================== RNG generation ====================

/**
 * Génère `count` floats uniformes dans [0, 1) avec un PRNG cryptographique.
 * Math.random() (V8) est prévisible : un attaquant qui voit ~600 RNG d'un combat
 * peut reconstruire l'état interne et prédire les rolls suivants (crits, multi-hits).
 * Avec randomBytes, chaque valeur est indépendante et imprévisible.
 */
function generateRng(count) {
  const buf = crypto.randomBytes(count * 4); // 4 octets par float
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    // Lire un uint32 puis normaliser dans [0, 1) — précision suffisante pour PSDK.
    const u32 = buf.readUInt32LE(i * 4);
    values[i] = u32 / 0x1_0000_0000;
  }
  return values;
}

// ==================== Server ====================

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      rooms: rooms.size,
      version: "1.2.0",
      rngPerTurn: RNG_VALUES_PER_TURN,
      switchTimeoutMs: SWITCH_TIMEOUT_MS,
      rankedQueueSize: rankedQueue.getQueueSize(),
      rankedPendingMatches: rankedQueue.getPendingMatchCount(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: MAX_PLAYER_DATA_BYTES,
});

// ─── Middleware: validation JWT Supabase ───
// Le client doit passer son access_token via `auth: { token }` à `io()`.
// Si la validation échoue, la connexion est refusée → impossible de spoof userId.
io.use(async (socket, next) => {
  if (!supabaseAuth) {
    // Mode dev local sans Supabase configuré : laisser passer mais avec userId null.
    socket.data.userId = null;
    socket.data.authed = false;
    return next();
  }
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== "string") {
    return next(new Error("auth_required"));
  }
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user?.id) {
      return next(new Error("auth_invalid"));
    }
    socket.data.userId = data.user.id;
    socket.data.authed = true;
    next();
  } catch (e) {
    next(new Error("auth_failed"));
  }
});

// Helper: récupère l'userId vérifié du socket. Refuse les actions sensibles
// si l'auth a échoué (mode dev fallback uniquement).
function authedUserId(socket) {
  return socket.data.authed ? socket.data.userId : null;
}

io.on("connection", (socket) => {
  console.log(`[Connect] ${socket.id} userId=${socket.data.userId ?? "anon"}`);

  // ─── Ranked matchmaking handlers (queue + pairing + accept) ───
  rankedQueue.attachRankedHandlers(socket, io);

  // ─── Lobby: register user for invite system ───
  socket.on("register_user", () => {
    const userId = authedUserId(socket);
    if (!userId) return;
    registerUser(userId, socket.id);
    console.log(`[Lobby] ${userId} registered (socket ${socket.id})`);
  });

  // ─── Battle invite (lobby) ───
  socket.on("battle_invite", (payload) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    if (!payload || typeof payload !== "object") return;
    const { toId } = payload;
    if (!toId || typeof toId !== "string") return;
    // Forcer fromId à l'identité authentifiée — ignorer ce que le client envoie.
    const safePayload = { ...payload, fromId: userId };
    const sent = emitToUser(toId, "battle_invite", safePayload, io);
    console.log(`[Lobby] Invite from ${userId} to ${toId}: ${sent ? "delivered" : "user offline"}`);
    socket.emit("battle_invite_ack", { roomCode: payload.roomCode, delivered: sent });
  });

  socket.on("battle_accept", ({ roomCode, fromId, partnerName } = {}) => {
    const userId = authedUserId(socket);
    if (!userId || !fromId || typeof fromId !== "string") return;
    emitToUser(fromId, "battle_accepted", { roomCode, acceptedBy: userId, partnerName }, io);
    console.log(`[Lobby] ${userId} accepted invite for room ${roomCode}`);
  });

  socket.on("battle_decline", ({ roomCode, fromId } = {}) => {
    const userId = authedUserId(socket);
    if (!userId || !fromId || typeof fromId !== "string") return;
    emitToUser(fromId, "battle_declined", { roomCode, userId }, io);
    console.log(`[Lobby] ${userId} declined invite for room ${roomCode}`);
  });

  socket.on("battle_cancel", ({ roomCode, toId } = {}) => {
    const userId = authedUserId(socket);
    if (!userId || !toId || typeof toId !== "string") return;
    emitToUser(toId, "battle_cancelled", { roomCode, userId }, io);
    console.log(`[Lobby] ${userId} cancelled invite for room ${roomCode}`);
  });

  // ─── Join room ───
  socket.on("join_room", ({ roomCode } = {}) => {
    const userId = authedUserId(socket);
    if (!userId || !roomCode || typeof roomCode !== "string") return;
    const room = getOrCreateRoom(roomCode);
    room.players.set(userId, { socketId: socket.id });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    console.log(`[Room ${roomCode}] ${userId} rejoint (${room.players.size} joueurs)`);

    // Notifier l'autre joueur
    socket.to(roomCode).emit("player_joined", { userId });
  });

  // ─── Initial player data exchange (avant le combat) ───
  socket.on("player_data", ({ roomCode, fullPlayerData } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.has(userId)) return; // doit avoir join_room d'abord
    if (!isFullPlayerDataValid(fullPlayerData)) {
      console.warn(`[Room ${roomCode}] player_data rejected (invalid shape) from ${userId}`);
      return;
    }

    room.initialData.set(userId, fullPlayerData);
    console.log(`[Room ${roomCode}] Donnees initiales de ${userId}`);

    // Si les deux joueurs ont envoye leurs donnees, les echanger
    if (room.initialData.size >= 2) {
      for (const [uid, data] of room.initialData) {
        const otherData = [...room.initialData.entries()].find(([id]) => id !== uid);
        if (otherData) {
          const player = room.players.get(uid);
          if (player) {
            io.to(player.socketId).emit("opponent_data", {
              fullPlayerData: otherData[1],
            });
          }
        }
      }
      console.log(`[Room ${roomCode}] Donnees initiales echangees`);
    }
  });

  // ─── Turn actions (coeur du systeme) ───
  socket.on("turn_actions", ({ roomCode, turn, fullPlayerData } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.has(userId)) return;
    if (typeof turn !== "number" || !Number.isFinite(turn) || turn < 0 || turn > MAX_TURN_NUMBER) return;
    if (!isFullPlayerDataValid(fullPlayerData)) {
      console.warn(`[Room ${roomCode}] turn_actions rejected (invalid shape) from ${userId}`);
      return;
    }

    room.turnData.set(userId, { turn, fullData: fullPlayerData });
    console.log(`[Room ${roomCode}] Actions tour ${turn} de ${userId}`);

    // Les deux joueurs ont soumis → resoudre le tour
    if (room.turnData.size >= 2) {
      const rng = generateRng(RNG_VALUES_PER_TURN);
      const entries = [...room.turnData.entries()];

      for (const [uid] of entries) {
        const otherEntry = entries.find(([id]) => id !== uid);
        if (!otherEntry) continue;

        const player = room.players.get(uid);
        if (player) {
          io.to(player.socketId).emit("turn_resolved", {
            turn,
            opponentData: otherEntry[1].fullData,
            rng,
          });
        }
      }

      // Notify spectators
      for (const specSid of room.spectators) {
        io.to(specSid).emit("spectate_turn", { turn, players: entries.map(([uid, d]) => uid) });
      }

      room.turnData.clear();
      room.switchData.clear(); // Nettoyer les switch stale du tour precedent
      if (room._switchTimeout) { clearTimeout(room._switchTimeout); room._switchTimeout = null; }
      console.log(`[Room ${roomCode}] Tour ${turn} resolu (${rng.length} RNG, ${room.spectators.size} spectateurs)`);
    }
  });

  // ─── Forced switches (Pokemon KO) ───
  socket.on("switch_data", ({ roomCode, switchInfo, fullPlayerData } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.has(userId)) return;
    if (!isPayloadShapeOk(switchInfo)) return;
    if (!isFullPlayerDataValid(fullPlayerData)) {
      console.warn(`[Room ${roomCode}] switch_data rejected (invalid shape) from ${userId}`);
      return;
    }

    room.switchData.set(userId, { switchInfo, fullData: fullPlayerData });
    console.log(`[Room ${roomCode}] Switch forces de ${userId} (ack vide: ${switchInfo === null || (Array.isArray(switchInfo) && switchInfo.length === 0)})`);

    // Fonction de resolution des switches
    const resolveSwitch = () => {
      const entries = [...room.switchData.entries()];

      for (const [uid] of entries) {
        const otherEntry = entries.find(([id]) => id !== uid);
        const player = room.players.get(uid);
        if (player) {
          io.to(player.socketId).emit("switch_resolved", {
            opponentData: otherEntry ? otherEntry[1].fullData : fullPlayerData,
            opponentSwitchInfo: otherEntry ? otherEntry[1].switchInfo : null,
          });
        }
      }

      room.switchData.clear();
      if (room._switchTimeout) { clearTimeout(room._switchTimeout); room._switchTimeout = null; }
      console.log(`[Room ${roomCode}] Switches resolus (${entries.length} joueurs)`);
    };

    // Les deux ont soumis → echanger immediatement
    if (room.switchData.size >= 2) {
      resolveSwitch();
    } else {
      // Timeout de securite : si un seul joueur soumet dans les 15s, resoudre quand meme
      if (!room._switchTimeout) {
        room._switchTimeout = setTimeout(() => {
          if (room.switchData.size >= 1) {
            console.warn(`[Room ${roomCode}] Switch timeout — resolution avec ${room.switchData.size} joueur(s)`);
            resolveSwitch();
          }
          room._switchTimeout = null;
        }, SWITCH_TIMEOUT_MS);
      }
    }
  });

  // ─── Battle end (result from game) ───
  // Émet match_token signé HMAC à CHAQUE joueur (A et B) avec le bon result
  // (perspective de chacun). Le client passera son token au RPC record_*_battle
  // qui vérifie la signature contre le secret du Vault Supabase. Sans token
  // valide, un attaquant ne peut plus falsifier de résultats.
  socket.on("battle_end", ({ roomCode, result, matchType, endType } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.players.has(userId)) return;
    if (!["win", "loss", "draw"].includes(result)) return;
    const safeMatchType = matchType === "ranked" || matchType === "amical" ? matchType : "amical";
    // endType distingue abandon volontaire vs fin normale vs crash. Sans cette info,
    // l'adversaire ne saurait pas qu'on a abandonné (le banner "X a abandonné" ne
    // s'affiche pas pour reason=game_end). Default "game_end" pour clients legacy.
    const safeEndType = endType === "forfeit" || endType === "crash" || endType === "game_end" ? endType : "game_end";

    const opponentResult = result === "win" ? "loss" : result === "loss" ? "win" : "draw";
    const opponentEntry = [...room.players.entries()].find(([uid]) => uid !== userId);
    const opponentId = opponentEntry ? opponentEntry[0] : null;

    // Notify opponent + send signed match tokens to both players
    for (const [uid, player] of room.players) {
      const myResult = uid === userId ? result : opponentResult;
      const oppId = uid === userId ? opponentId : userId;

      if (oppId) {
        const token = generateMatchToken({
          roomCode,
          userId: uid,
          opponentId: oppId,
          result: myResult,
          matchType: safeMatchType,
        });
        if (token) {
          io.to(player.socketId).emit("match_token", { roomCode, result: myResult, matchType: safeMatchType, token });
        }
      }

      if (uid !== userId) {
        io.to(player.socketId).emit("battle_ended", { roomCode, result: opponentResult, reason: safeEndType });
      }
    }
    console.log(`[Room ${roomCode}] Battle end: ${userId} ${result} (${safeMatchType}, ${safeEndType})`);
  });

  // ─── Spectate room (DÉSACTIVÉ — sécurité C4) ───
  // Codes 6 chiffres = brute-force trivial. Les payloads par tour contiennent
  // l'équipe complète (sets, IVs, EVs) et les Pokémon de pari. À réactiver
  // seulement avec : codes longs cryptographiques + opt-in explicite des joueurs.
  socket.on("spectate_room", () => {
    socket.emit("spectate_error", { message: "spectate_disabled" });
  });

  socket.on("leave_spectate", () => {
    // No-op : spectate désactivé.
  });

  // ─── Leave room ───
  socket.on("leave_room", ({ roomCode, reason } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const room = rooms.get(roomCode);
    if (room) {
      room.players.delete(userId);
      socket.to(roomCode).emit("player_left", { userId, reason: reason || "forfeit" });
      socket.leave(roomCode);
      console.log(`[Room ${roomCode}] ${userId} quitte (${reason || "forfeit"})`);
      cleanupRoom(roomCode);
    }
  });

  // ─── Disconnect ───
  socket.on("disconnect", () => {
    console.log(`[Disconnect] ${socket.id}`);
    unregisterSocket(socket.id);
    removePlayerFromAllRooms(socket.id, io);
  });
});

// ==================== Start ====================

// Ranked matchmaking background loops (pairing + accept timeout)
rankedQueue.startPairingLoop(io);
rankedQueue.startAcceptTimeoutLoop(io);

server.listen(PORT, () => {
  console.log(`[PNW Battle Server] Port ${PORT} — pret`);
});
