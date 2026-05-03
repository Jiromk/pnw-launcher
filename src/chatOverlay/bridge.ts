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

const OVERLAY_LABEL = "chat-overlay";

interface OpenBattleChatOptions {
  roomCode: string;
  opponentName: string;
  myUserId: string;
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
  const { roomCode, opponentName, myUserId } = opts;

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
  await emit("chat:peer-info", { opponentName, myUserId });

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
