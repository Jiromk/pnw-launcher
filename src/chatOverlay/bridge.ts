/**
 * bridge.ts — helpers côté launcher pour gérer la fenêtre overlay chat.
 *
 * Le launcher tient le socket battle ; l'overlay est une fenêtre passive qui
 * communique via les events Tauri :
 *
 *   overlay → launcher : "chat:send"  { text }
 *   launcher → overlay : "chat:incoming" { fromUserId, text, ts }
 *   launcher → overlay : "chat:peer-info" { opponentName, myUserId }
 *   launcher → overlay : "chat:battle-end" {}
 *
 * Usage typique (au début d'un combat) :
 *   const cleanupChat = await openBattleChat({ roomCode, opponentName, myUserId });
 *   // ... combat en cours ...
 *   await cleanupChat();  // ferme la fenêtre + détache les listeners
 */
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { sendBattleChatMessage, attachBattleChatListener } from "../battleRelay";
import { fetchPvpStats } from "../leaderboard";
import type { RankTier } from "../ranked";

const OVERLAY_LABEL = "chat-overlay";

interface OpenBattleChatOptions {
  roomCode: string;
  opponentName: string;
  /** URL d'avatar adversaire — optionnel. Fallback initiale dans l'overlay. */
  opponentAvatar?: string | null;
  /** Supabase user id de l'adversaire — utilisé pour fetch son rang. */
  opponentId: string;
  myUserId: string;
}

export interface BattleChatRankInfo {
  tier: RankTier;
  lp: number;
  mmr: number;
  /** Total PVP wins (ranked + amical confondus) — affiché en stats compactes. */
  wins: number;
  losses: number;
}

/**
 * Ouvre la fenêtre overlay chat et branche le pont d'events avec le socket
 * battle déjà connecté. Retourne une cleanup function qui ferme la fenêtre
 * et détache les listeners.
 *
 * Idempotent : si une fenêtre du même label existe déjà (combat précédent
 * pas nettoyé), elle est fermée d'abord.
 */
export async function openBattleChat(opts: OpenBattleChatOptions): Promise<() => Promise<void>> {
  const { roomCode, opponentName, opponentAvatar = null, opponentId, myUserId } = opts;

  // Cleanup d'une éventuelle fenêtre orpheline (race au reload, double-clic invite)
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    try { await existing.close(); } catch {}
  }

  // Création de la fenêtre. Position/taille seront écrasées par le polling
  // côté overlay (cmd_get_game_window_rect). On démarre cachée (visible:false)
  // pour éviter le flash en haut-gauche pendant la première frame.
  const win = new WebviewWindow(OVERLAY_LABEL, {
    url: "index.html#chat-overlay",
    title: "Chat",
    width: 320,
    height: 600,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    visible: false,
    focus: false,
  });

  // Attendre `chat:ready` de l'overlay (handshake) avant d'envoyer peer-info.
  // Garantit que les listeners sont mountés. Garde-fou : 5s max.
  await new Promise<void>((resolve) => {
    let resolved = false;
    let unlistenFn: UnlistenFn | null = null;
    listen("chat:ready", () => {
      if (resolved) return;
      resolved = true;
      if (unlistenFn) unlistenFn();
      resolve();
    }).then((fn) => {
      unlistenFn = fn;
      if (resolved) fn();
    });
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      if (unlistenFn) unlistenFn();
      resolve();
    }, 5000);
  });

  // Envoyer les infos initiales à l'overlay
  await emit("chat:peer-info", { opponentName, opponentAvatar, myUserId });

  // Fetch des rangs en arrière-plan (pas await — l'overlay s'affiche déjà,
  // le badge apparaît dès la réponse Supabase). Si le fetch échoue, l'overlay
  // continue sans rang affiché — pas de blocage.
  Promise.all([
    fetchPvpStats(myUserId).catch(() => null),
    opponentId ? fetchPvpStats(opponentId).catch(() => null) : Promise.resolve(null),
  ])
    .then(([mine, theirs]) => {
      const toRank = (s: Awaited<ReturnType<typeof fetchPvpStats>> | null): BattleChatRankInfo | null =>
        s
          ? {
              tier: (s.battle_rank_tier ?? "unranked") as RankTier,
              lp: s.battle_lp ?? 0,
              mmr: s.battle_mmr ?? 0,
              wins: s.pvp_wins ?? 0,
              losses: s.pvp_losses ?? 0,
            }
          : null;
      emit("chat:rank-info", {
        mine: toRank(mine),
        opponent: toRank(theirs),
      }).catch(() => {});
    });

  // ─── Bridge : socket battle → overlay ───
  const detachIncoming = attachBattleChatListener((msg) => {
    // Ne pas re-broadcast nos propres messages (le serveur ne les renvoie pas
    // mais sécurité supplémentaire si l'auth change un jour).
    if (msg.fromUserId === myUserId) return;
    emit("chat:incoming", { fromUserId: msg.fromUserId, text: msg.text, ts: msg.ts }).catch(() => {});
  });

  // ─── Bridge : overlay → socket battle ───
  const unlistenSend: UnlistenFn = await listen<{ text: string }>("chat:send", (e) => {
    const text = e.payload?.text;
    if (typeof text === "string" && text.trim().length > 0) {
      sendBattleChatMessage(roomCode, text);
    }
  });

  // Cleanup function — à appeler quand le combat se termine
  return async () => {
    try { detachIncoming(); } catch {}
    try { unlistenSend(); } catch {}
    try { await emit("chat:battle-end", {}); } catch {}
    try {
      const w = await WebviewWindow.getByLabel(OVERLAY_LABEL);
      if (w) await w.close();
    } catch {}
  };
}

/**
 * Ferme la fenêtre overlay si elle est ouverte. À utiliser comme cleanup
 * défensif en cas de chemin de sortie inhabituel (ex: utilisateur quitte
 * le launcher pendant un combat).
 */
export async function closeBattleChatIfOpen(): Promise<void> {
  try {
    const w = await WebviewWindow.getByLabel(OVERLAY_LABEL);
    if (w) await w.close();
  } catch {}
}
