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
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;
const RNG_VALUES_PER_TURN = 200; // doit couvrir TOUS les rand() d'un tour (multi-hit, abilities, weather, etc.)

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

function generateRng(count) {
  const values = [];
  for (let i = 0; i < count; i++) {
    values.push(Math.random());
  }
  return values;
}

// ==================== Server ====================

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 10000,
});

io.on("connection", (socket) => {
  console.log(`[Connect] ${socket.id}`);

  // ─── Lobby: register user for invite system ───
  socket.on("register_user", ({ userId }) => {
    registerUser(userId, socket.id);
    socket.data.userId = userId;
    console.log(`[Lobby] ${userId} registered (socket ${socket.id})`);
  });

  // ─── Battle invite (lobby) ───
  socket.on("battle_invite", (payload) => {
    const { toId } = payload;
    const sent = emitToUser(toId, "battle_invite", payload, io);
    console.log(`[Lobby] Invite from ${payload.fromId} to ${toId}: ${sent ? "delivered" : "user offline"}`);
    // Acknowledge to sender
    socket.emit("battle_invite_ack", { roomCode: payload.roomCode, delivered: sent });
  });

  socket.on("battle_accept", ({ roomCode, fromId, acceptedBy, partnerName }) => {
    emitToUser(fromId, "battle_accepted", { roomCode, acceptedBy, partnerName }, io);
    console.log(`[Lobby] ${acceptedBy} accepted invite for room ${roomCode}`);
  });

  socket.on("battle_decline", ({ roomCode, fromId, userId }) => {
    emitToUser(fromId, "battle_declined", { roomCode, userId }, io);
    console.log(`[Lobby] ${userId} declined invite for room ${roomCode}`);
  });

  socket.on("battle_cancel", ({ roomCode, toId, userId }) => {
    emitToUser(toId, "battle_cancelled", { roomCode, userId }, io);
    console.log(`[Lobby] ${userId} cancelled invite for room ${roomCode}`);
  });

  // ─── Join room ───
  socket.on("join_room", ({ roomCode, userId }) => {
    const room = getOrCreateRoom(roomCode);
    room.players.set(userId, { socketId: socket.id });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.userId = userId;
    console.log(`[Room ${roomCode}] ${userId} rejoint (${room.players.size} joueurs)`);

    // Notifier l'autre joueur
    socket.to(roomCode).emit("player_joined", { userId });
  });

  // ─── Initial player data exchange (avant le combat) ───
  socket.on("player_data", ({ roomCode, userId, fullPlayerData }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

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
  socket.on("turn_actions", ({ roomCode, userId, turn, fullPlayerData }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

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
      console.log(`[Room ${roomCode}] Tour ${turn} resolu (${rng.length} RNG, ${room.spectators.size} spectateurs)`);
    }
  });

  // ─── Forced switches (Pokemon KO) ───
  socket.on("switch_data", ({ roomCode, userId, switchInfo, fullPlayerData }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.switchData.set(userId, { switchInfo, fullData: fullPlayerData });
    console.log(`[Room ${roomCode}] Switch forces de ${userId}`);

    // Les deux ont soumis → echanger
    if (room.switchData.size >= 2) {
      const entries = [...room.switchData.entries()];

      for (const [uid] of entries) {
        const otherEntry = entries.find(([id]) => id !== uid);
        if (!otherEntry) continue;

        const player = room.players.get(uid);
        if (player) {
          io.to(player.socketId).emit("switch_resolved", {
            opponentData: otherEntry[1].fullData,
            opponentSwitchInfo: otherEntry[1].switchInfo,
          });
        }
      }

      room.switchData.clear();
      console.log(`[Room ${roomCode}] Switches resolus`);
    }
  });

  // ─── Battle end (result from game) ───
  socket.on("battle_end", ({ roomCode, userId, result }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const opponentResult = result === "win" ? "loss" : result === "loss" ? "win" : "draw";
    // Notify opponent
    for (const [uid, player] of room.players) {
      if (uid !== userId) {
        io.to(player.socketId).emit("battle_ended", { roomCode, result: opponentResult, reason: "battle_end" });
      }
    }
    console.log(`[Room ${roomCode}] Battle end: ${userId} ${result}`);
  });

  // ─── Spectate room (read-only) ───
  socket.on("spectate_room", ({ roomCode, userId }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit("spectate_error", { message: "Room introuvable" }); return; }
    room.spectators.add(socket.id);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.userId = userId;
    socket.data.isSpectator = true;
    const playerIds = [...room.players.keys()];
    socket.emit("spectate_joined", { roomCode, players: playerIds, turn: room.turnData.size > 0 ? "in_progress" : "waiting" });
    // Notifier les joueurs qu'un spectateur a rejoint
    for (const [, player] of room.players) {
      io.to(player.socketId).emit("spectator_count", { count: room.spectators.size });
    }
    console.log(`[Room ${roomCode}] Spectateur ${userId} (${room.spectators.size} spectateurs)`);
  });

  socket.on("leave_spectate", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.spectators.delete(socket.id);
      socket.leave(roomCode);
      // Notifier les joueurs du départ
      for (const [, player] of room.players) {
        io.to(player.socketId).emit("spectator_count", { count: room.spectators.size });
      }
    }
  });

  // ─── Leave room ───
  socket.on("leave_room", ({ roomCode, userId, reason }) => {
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

server.listen(PORT, () => {
  console.log(`[PNW Battle Server] Port ${PORT} — pret`);
});
