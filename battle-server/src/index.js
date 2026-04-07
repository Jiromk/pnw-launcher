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
const RNG_VALUES_PER_TURN = 50; // assez pour couvrir tous les rand() d'un tour

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
    for (const [userId, player] of room.players) {
      if (player.socketId === socketId) {
        room.players.delete(userId);
        io.to(code).emit("player_left", { userId });
        console.log(`[Room ${code}] ${userId} deconnecte`);
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

      room.turnData.clear();
      console.log(`[Room ${roomCode}] Tour ${turn} resolu (${rng.length} RNG)`);
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

  // ─── Leave room ───
  socket.on("leave_room", ({ roomCode, userId }) => {
    const room = rooms.get(roomCode);
    if (room) {
      room.players.delete(userId);
      socket.to(roomCode).emit("player_left", { userId });
      socket.leave(roomCode);
      cleanupRoom(roomCode);
    }
  });

  // ─── Disconnect ───
  socket.on("disconnect", () => {
    console.log(`[Disconnect] ${socket.id}`);
    removePlayerFromAllRooms(socket.id, io);
  });
});

// ==================== Start ====================

server.listen(PORT, () => {
  console.log(`[PNW Battle Server] Port ${PORT} — pret`);
});
