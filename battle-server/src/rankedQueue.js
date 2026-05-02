/**
 * Ranked matchmaking module.
 *
 * État en mémoire — jamais persisté. Si le serveur redémarre, les joueurs
 * doivent retaper "chercher un match".
 *
 * Flow :
 *   1. Client emit `ranked_queue_join { userId, displayName }`
 *   2. Serveur fetch le MMR du joueur depuis Supabase (source de vérité)
 *   3. Serveur ajoute à la queue, emit `ranked_queue_joined { mmr }`
 *   4. Pairing loop (toutes les 1s) trouve le meilleur match
 *   5. Emit `ranked_match_found { roomCode, opponent: { id, name, mmr, tier }, acceptTimeoutMs }` aux 2
 *   6. Les 2 clients doivent emit `ranked_accept { roomCode }` avant la deadline (10s)
 *   7. Si les 2 acceptent → `ranked_match_start { roomCode, opponent }` aux 2
 *   8. Sinon → `ranked_match_cancelled { reason }` aux 2
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const ACCEPT_TIMEOUT_MS = 10_000; // 10s pour accepter
const PAIRING_INTERVAL_MS = 1000; // tourne toutes les 1s
const ACTION_COOLDOWN_MS = 2000; // rate-limit join/leave (anti-spam)

// MMR window par tranche de temps d'attente
function mmrWindowForWait(waitMs) {
  if (waitMs < 30_000) return 150;
  if (waitMs < 90_000) return 300;
  if (waitMs < 180_000) return 600;
  return Infinity; // après 3 min, match anyone
}

// ─── Supabase (service role key → bypass RLS pour read MMR) ───
// Accepte plusieurs noms de var pour coller à différentes conventions :
//  - SUPABASE_SERVICE_KEY (nom le plus propre)
//  - SUPABASE_SERVICE_ROLE_KEY (nom officiel Supabase)
//  - SUPABASE_ANON_KEY (si la var contient en réalité une service key — cas de certains setups historiques)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  // Sanity check : une service/secret key commence par "sb_secret_" (nouveau format)
  // ou par "eyJ" (ancien JWT). Une publishable key "sb_publishable_..." ne permettra
  // pas de bypass RLS — on log un warning dans ce cas mais on laisse tourner.
  const looksLikePublishable = SUPABASE_KEY.startsWith("sb_publishable_");
  if (looksLikePublishable) {
    console.warn(
      "[RankedQueue] ATTENTION : la clé fournie ressemble à une publishable key. " +
        "Le fetch MMR sera bloqué par RLS. Utilise une service/secret key (sb_secret_...) à la place.",
    );
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  console.log("[RankedQueue] Supabase client OK");
} else {
  console.warn(
    "[RankedQueue] SUPABASE_URL ou service key manquants — matchmaking désactivé. " +
      "Set SUPABASE_URL + SUPABASE_SERVICE_KEY (ou SUPABASE_ANON_KEY avec une secret key).",
  );
}

/**
 * @typedef {Object} QueuedPlayer
 * @property {string} userId
 * @property {string} socketId
 * @property {string} displayName
 * @property {number} mmr
 * @property {string} tier
 * @property {number} joinedAt
 */

/**
 * @typedef {Object} PendingMatch
 * @property {string} roomCode
 * @property {QueuedPlayer} a
 * @property {QueuedPlayer} b
 * @property {boolean} acceptedA
 * @property {boolean} acceptedB
 * @property {number} deadline
 */

/** @type {Map<string, QueuedPlayer>} userId -> player */
const queue = new Map();

/** @type {Map<string, PendingMatch>} roomCode -> pending match */
const pendingMatches = new Map();

/** @type {Map<string, number>} userId -> last action timestamp (rate-limit) */
const lastActionAt = new Map();

/** Rate-limit : 1 action par user toutes les 2s. */
function isRateLimited(userId) {
  const now = Date.now();
  const last = lastActionAt.get(userId);
  if (last && now - last < ACTION_COOLDOWN_MS) return true;
  lastActionAt.set(userId, now);
  return false;
}

/**
 * Génère un room code 6-chiffres (même format que l'amical) — compatible PSDK
 * qui attend un cluster_id numérique. crypto.randomInt() au lieu de Math.random()
 * pour rendre le PRNG imprévisible (un attaquant ne peut pas brute-forcer la
 * séquence en observant quelques codes).
 *
 * Mitigation supplémentaire : `spectate_room` est désactivé côté serveur, donc
 * même si un code est deviné, il n'y a aucun event à recevoir.
 */
const _usedRoomCodes = new Set();
function generateRoomCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(100000 + crypto.randomInt(0, 900000));
    if (!_usedRoomCodes.has(code)) {
      _usedRoomCodes.add(code);
      // Auto-cleanup après 15 min (le match est largement fini)
      setTimeout(() => _usedRoomCodes.delete(code), 15 * 60 * 1000);
      return code;
    }
  }
  // Fallback extrêmement improbable
  return String(Date.now()).slice(-6);
}

/** Dérive le tier d'un MMR (miroir de la fonction SQL `rank_tier_from_mmr`). */
function tierFromMmr(mmr) {
  if (mmr >= 3400) return "challenger";
  if (mmr >= 3100) return "grandmaster";
  if (mmr >= 2800) return "master";
  if (mmr >= 2450) return "diamond";
  if (mmr >= 2100) return "emerald";
  if (mmr >= 1750) return "platinum";
  if (mmr >= 1400) return "gold";
  if (mmr >= 1050) return "silver";
  if (mmr >= 700) return "bronze";
  return "iron";
}

/** Lit le MMR + rank_tier + placement d'un user depuis Supabase. */
async function fetchUserRankState(userId) {
  if (!supabase) return { mmr: 1000, tier: "unranked", placementPlayed: 0 };
  const { data, error } = await supabase
    .from("leaderboard_scores")
    .select("battle_mmr, battle_rank_tier, placement_played")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[RankedQueue] fetch MMR failed:", error.message);
    return { mmr: 1000, tier: "unranked", placementPlayed: 0 };
  }
  return {
    mmr: data?.battle_mmr ?? 1000,
    tier: data?.battle_rank_tier ?? "unranked",
    placementPlayed: data?.placement_played ?? 0,
  };
}

/** Enlève un user de la queue (propage via emit). */
function leaveQueue(userId) {
  queue.delete(userId);
}

/** Vérifie qu'un joueur n'est pas déjà dans un pending match. */
function isInPendingMatch(userId) {
  for (const pm of pendingMatches.values()) {
    if (pm.a.userId === userId || pm.b.userId === userId) return true;
  }
  return false;
}

/** Trouve le meilleur match pour un joueur (MMR le plus proche dans la fenêtre). */
function findBestMatch(player, now) {
  const window = mmrWindowForWait(now - player.joinedAt);
  let best = null;
  let bestDelta = Infinity;
  for (const other of queue.values()) {
    if (other.userId === player.userId) continue;
    if (isInPendingMatch(other.userId)) continue;
    const delta = Math.abs(other.mmr - player.mmr);
    const otherWindow = mmrWindowForWait(now - other.joinedAt);
    const mutualWindow = Math.min(window, otherWindow);
    if (delta <= mutualWindow && delta < bestDelta) {
      best = other;
      bestDelta = delta;
    }
  }
  return best;
}

/** Boucle de pairing. */
function startPairingLoop(io) {
  setInterval(() => {
    const now = Date.now();
    // Tri par temps d'attente DESC (les plus anciens en premier)
    const sorted = [...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    for (const player of sorted) {
      if (!queue.has(player.userId)) continue; // retiré pendant la boucle
      if (isInPendingMatch(player.userId)) continue;
      const opp = findBestMatch(player, now);
      if (!opp) continue;

      // Pair !
      queue.delete(player.userId);
      queue.delete(opp.userId);
      const roomCode = generateRoomCode();
      const pm = {
        roomCode,
        a: player,
        b: opp,
        acceptedA: false,
        acceptedB: false,
        deadline: Date.now() + ACCEPT_TIMEOUT_MS,
      };
      pendingMatches.set(roomCode, pm);

      const payloadForA = {
        roomCode,
        opponent: { id: opp.userId, name: opp.displayName, mmr: opp.mmr, tier: opp.tier },
        acceptTimeoutMs: ACCEPT_TIMEOUT_MS,
      };
      const payloadForB = {
        roomCode,
        opponent: { id: player.userId, name: player.displayName, mmr: player.mmr, tier: player.tier },
        acceptTimeoutMs: ACCEPT_TIMEOUT_MS,
      };
      io.to(player.socketId).emit("ranked_match_found", payloadForA);
      io.to(opp.socketId).emit("ranked_match_found", payloadForB);
      console.log(
        `[RankedQueue] Match ${roomCode} : ${player.displayName}(${player.mmr}) vs ${opp.displayName}(${opp.mmr}), Δ${Math.abs(player.mmr - opp.mmr)}`,
      );
    }

    // Status update pour chaque joueur en queue (timer côté client)
    for (const p of queue.values()) {
      const waitMs = now - p.joinedAt;
      const window = mmrWindowForWait(waitMs);
      io.to(p.socketId).emit("ranked_queue_status", {
        waitMs,
        mmrWindow: window === Infinity ? null : window,
      });
    }
  }, PAIRING_INTERVAL_MS);
}

/** Boucle de timeout pour les pending matches. */
function startAcceptTimeoutLoop(io) {
  setInterval(() => {
    const now = Date.now();
    for (const [roomCode, pm] of pendingMatches) {
      if (now < pm.deadline) continue;
      if (pm.acceptedA && pm.acceptedB) continue; // déjà traité, devrait être retiré

      // Timeout : au moins un n'a pas accepté
      pendingMatches.delete(roomCode);
      const reason = "timeout";
      io.to(pm.a.socketId).emit("ranked_match_cancelled", { roomCode, reason });
      io.to(pm.b.socketId).emit("ranked_match_cancelled", { roomCode, reason });

      // Ceux qui ont accepté retournent en queue avec joined_at original (priorité)
      if (pm.acceptedA && !queue.has(pm.a.userId)) {
        queue.set(pm.a.userId, pm.a);
      }
      if (pm.acceptedB && !queue.has(pm.b.userId)) {
        queue.set(pm.b.userId, pm.b);
      }
      console.log(`[RankedQueue] Match ${roomCode} timeout — queue restored`);
    }
  }, 500);
}

/**
 * Attache les handlers Socket.io pour le matchmaking ranked.
 * À appeler depuis index.js dans le `io.on('connection', socket => { ... })`.
 */
function authedUserId(socket) {
  return socket.data?.authed ? socket.data.userId : null;
}

function attachRankedHandlers(socket, io) {
  // ─── Join queue ───
  socket.on("ranked_queue_join", async ({ displayName } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) {
      socket.emit("ranked_queue_error", { message: "auth_required" });
      return;
    }
    if (isRateLimited(userId)) {
      socket.emit("ranked_queue_error", { message: "rate_limited" });
      return;
    }
    if (queue.has(userId)) {
      socket.emit("ranked_queue_error", { message: "already_in_queue" });
      return;
    }
    if (isInPendingMatch(userId)) {
      socket.emit("ranked_queue_error", { message: "already_in_pending_match" });
      return;
    }

    // Fetch MMR depuis Supabase (le client ne peut pas le truquer)
    const state = await fetchUserRankState(userId);
    const tier = state.placementPlayed < 5 ? "unranked" : state.tier;

    const safeDisplayName = typeof displayName === "string" && displayName.length <= 64
      ? displayName : "Joueur";
    const player = {
      userId,
      socketId: socket.id,
      displayName: safeDisplayName,
      mmr: state.mmr,
      tier,
      joinedAt: Date.now(),
    };
    queue.set(userId, player);
    socket.emit("ranked_queue_joined", { mmr: state.mmr, tier, placementPlayed: state.placementPlayed });
    console.log(`[RankedQueue] ${safeDisplayName}(${userId}) joined — ${state.mmr} MMR, ${tier}`);
  });

  // ─── Leave queue ───
  socket.on("ranked_queue_leave", () => {
    const userId = authedUserId(socket);
    if (!userId) return;
    if (isRateLimited(userId)) return;
    leaveQueue(userId);
    socket.emit("ranked_queue_left");
    console.log(`[RankedQueue] ${userId} left queue`);
  });

  // ─── Accept match ───
  socket.on("ranked_accept", ({ roomCode } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const pm = pendingMatches.get(roomCode);
    if (!pm) return;
    if (pm.a.userId === userId) pm.acceptedA = true;
    else if (pm.b.userId === userId) pm.acceptedB = true;
    else return;

    if (pm.acceptedA && pm.acceptedB) {
      // Les deux ont accepté → start
      pendingMatches.delete(roomCode);
      const payloadForA = {
        roomCode,
        opponent: { id: pm.b.userId, name: pm.b.displayName, mmr: pm.b.mmr, tier: pm.b.tier },
      };
      const payloadForB = {
        roomCode,
        opponent: { id: pm.a.userId, name: pm.a.displayName, mmr: pm.a.mmr, tier: pm.a.tier },
      };
      io.to(pm.a.socketId).emit("ranked_match_start", payloadForA);
      io.to(pm.b.socketId).emit("ranked_match_start", payloadForB);
      console.log(`[RankedQueue] Match ${roomCode} started — both accepted`);
    }
  });

  // ─── Decline match ───
  socket.on("ranked_decline", ({ roomCode } = {}) => {
    const userId = authedUserId(socket);
    if (!userId) return;
    const pm = pendingMatches.get(roomCode);
    if (!pm) return;
    if (pm.a.userId !== userId && pm.b.userId !== userId) return;

    pendingMatches.delete(roomCode);
    io.to(pm.a.socketId).emit("ranked_match_cancelled", { roomCode, reason: "declined" });
    io.to(pm.b.socketId).emit("ranked_match_cancelled", { roomCode, reason: "declined" });

    // Celui qui n'a PAS décliné retourne en queue
    const decliner = userId;
    if (pm.a.userId !== decliner && !queue.has(pm.a.userId)) {
      queue.set(pm.a.userId, pm.a);
    }
    if (pm.b.userId !== decliner && !queue.has(pm.b.userId)) {
      queue.set(pm.b.userId, pm.b);
    }
    console.log(`[RankedQueue] Match ${roomCode} declined by ${userId}`);
  });

  // ─── Cleanup on disconnect ───
  socket.on("disconnect", () => {
    // Retirer de la queue si présent
    for (const [uid, p] of queue) {
      if (p.socketId === socket.id) {
        queue.delete(uid);
        console.log(`[RankedQueue] ${uid} removed from queue (disconnect)`);
        break;
      }
    }
    // Annuler pending matches où ce socket était un des 2 joueurs
    for (const [roomCode, pm] of pendingMatches) {
      if (pm.a.socketId === socket.id || pm.b.socketId === socket.id) {
        pendingMatches.delete(roomCode);
        const otherSocket = pm.a.socketId === socket.id ? pm.b.socketId : pm.a.socketId;
        io.to(otherSocket).emit("ranked_match_cancelled", {
          roomCode,
          reason: "opponent_disconnected",
        });
        // L'autre retourne en queue
        const other = pm.a.socketId === socket.id ? pm.b : pm.a;
        if (!queue.has(other.userId)) queue.set(other.userId, other);
        console.log(`[RankedQueue] Match ${roomCode} cancelled (disconnect)`);
      }
    }
  });
}

module.exports = {
  attachRankedHandlers,
  startPairingLoop,
  startAcceptTimeoutLoop,
  // Exposé pour health check / debug
  getQueueSize: () => queue.size,
  getPendingMatchCount: () => pendingMatches.size,
};
