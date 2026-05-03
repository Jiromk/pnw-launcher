/**
 * ChatOverlay — fenêtre indépendante pour le chat in-battle PVP.
 *
 * Cette fenêtre vit dans une seconde webview (label "chat-overlay") qui se
 * positionne à droite de la fenêtre du jeu PNW pendant un combat. Elle ne
 * possède PAS le socket battle — c'est la fenêtre principale du launcher qui
 * tient le socket. La communication entre les deux fenêtres passe par les
 * events Tauri (`emit_to` / `listen`) :
 *
 *   overlay → launcher : "chat:send"  { text }
 *   launcher → overlay : "chat:incoming" { fromUserId, text, ts }
 *   launcher → overlay : "chat:peer-info" { opponentName, myUserId }
 *   launcher → overlay : "chat:battle-end" {}
 *
 * Polling de la fenêtre du jeu : appel à `cmd_get_game_window_rect` toutes
 * les 200ms. Si trouvée et !isFullscreen, on se positionne à droite. Sinon,
 * on se cache.
 */
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

const OVERLAY_WIDTH = 320;
const POLL_INTERVAL_MS = 200;
const MAX_MESSAGE_LEN = 300;

interface ChatLine {
  id: number;
  fromMe: boolean;
  text: string;
  ts: number;
}

interface PeerInfo {
  opponentName: string;
  myUserId: string;
}

export default function ChatOverlay() {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [peer, setPeer] = useState<PeerInfo>({ opponentName: "Adversaire", myUserId: "" });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idCounterRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Auto-scroll on new message ───
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // ─── Listen to events from launcher ───
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    Promise.all([
      listen<PeerInfo>("chat:peer-info", (e) => {
        setPeer(e.payload);
      }),
      listen<{ fromUserId: string; text: string; ts: number }>("chat:incoming", (e) => {
        idCounterRef.current += 1;
        setMessages((prev) => [
          ...prev,
          { id: idCounterRef.current, fromMe: false, text: e.payload.text, ts: e.payload.ts },
        ]);
      }),
      listen("chat:battle-end", async () => {
        try { await getCurrentWebviewWindow().close(); } catch {}
      }),
    ]).then(async (fns) => {
      if (cancelled) { fns.forEach((fn) => fn()); return; }
      fns.forEach((fn) => unlistens.push(fn));
      // Handshake : signaler au launcher que l'overlay est prêt à recevoir
      // peer-info / incoming. Sans ça, on peut louper le 1er event si le
      // launcher emit avant le mount des listeners.
      const { emit } = await import("@tauri-apps/api/event");
      await emit("chat:ready", {});
    });

    return () => { cancelled = true; unlistens.forEach((fn) => fn()); };
  }, []);

  // ─── Poll game window position + show/hide ───
  useEffect(() => {
    let cancelled = false;
    const win = getCurrentWebviewWindow();
    let lastVisible: boolean | null = null;
    let lastX = -1, lastY = -1, lastH = -1;

    const tick = async () => {
      if (cancelled) return;
      try {
        const rect = await invoke<{
          x: number; y: number; width: number; height: number; is_fullscreen: boolean;
        } | null>("cmd_get_game_window_rect");
        if (!rect || rect.is_fullscreen) {
          if (lastVisible !== false) {
            await win.hide();
            lastVisible = false;
          }
        } else {
          // Position à droite du jeu, hauteur = hauteur du jeu
          const targetX = rect.x + rect.width;
          const targetY = rect.y;
          const targetH = rect.height;
          if (targetX !== lastX || targetY !== lastY) {
            await win.setPosition(new LogicalPosition(targetX, targetY));
            lastX = targetX; lastY = targetY;
          }
          if (targetH !== lastH) {
            await win.setSize(new LogicalSize(OVERLAY_WIDTH, targetH));
            lastH = targetH;
          }
          if (lastVisible !== true) {
            await win.show();
            lastVisible = true;
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[ChatOverlay] poll error", e);
      }
    };

    const interval = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ─── Send message ───
  const send = async () => {
    const text = draft.trim();
    if (!text || text.length > MAX_MESSAGE_LEN) return;
    try {
      // emit() envoie à TOUTES les fenêtres — le launcher écoute et le serveur
      // fera le rate-limit / dédup côté backend si besoin.
      const { emit } = await import("@tauri-apps/api/event");
      await emit("chat:send", { text });
      idCounterRef.current += 1;
      setMessages((prev) => [
        ...prev,
        { id: idCounterRef.current, fromMe: true, text, ts: Date.now() },
      ]);
      setDraft("");
      inputRef.current?.focus();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ChatOverlay] send error", e);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>vs {peer.opponentName}</span>
      </div>
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyHint}>Aucun message — tapez ci-dessous.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ ...styles.bubbleRow, justifyContent: m.fromMe ? "flex-end" : "flex-start" }}>
            <div style={{ ...styles.bubble, ...(m.fromMe ? styles.bubbleMe : styles.bubbleThem) }}>
              {m.text}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={styles.inputRow}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LEN))}
          onKeyDown={onKeyDown}
          placeholder="Message…"
          rows={2}
          style={styles.textarea}
          maxLength={MAX_MESSAGE_LEN}
        />
        <button onClick={send} disabled={!draft.trim()} style={styles.sendBtn}>
          ↵
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex", flexDirection: "column", height: "100vh",
    background: "#1e1f24", color: "#e8e8ea", fontFamily: "system-ui, sans-serif",
    fontSize: 13, overflow: "hidden",
  },
  header: {
    padding: "8px 12px", background: "#272930", borderBottom: "1px solid #34363d",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    userSelect: "none",
  },
  headerTitle: { fontWeight: 600, fontSize: 13 },
  messages: {
    flex: 1, overflowY: "auto", padding: "8px 10px",
    display: "flex", flexDirection: "column", gap: 4,
  },
  emptyHint: { color: "#6b6e76", fontStyle: "italic", textAlign: "center", marginTop: 20 },
  bubbleRow: { display: "flex", width: "100%" },
  bubble: {
    maxWidth: "80%", padding: "6px 10px", borderRadius: 12,
    wordBreak: "break-word", whiteSpace: "pre-wrap", lineHeight: 1.35,
  },
  bubbleMe: { background: "#3b82f6", color: "#fff", borderBottomRightRadius: 4 },
  bubbleThem: { background: "#34363d", color: "#e8e8ea", borderBottomLeftRadius: 4 },
  inputRow: {
    display: "flex", gap: 6, padding: 8,
    background: "#272930", borderTop: "1px solid #34363d",
  },
  textarea: {
    flex: 1, resize: "none", background: "#1e1f24", color: "#e8e8ea",
    border: "1px solid #34363d", borderRadius: 6, padding: "6px 8px",
    fontFamily: "inherit", fontSize: 13, outline: "none",
  },
  sendBtn: {
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6,
    padding: "0 12px", cursor: "pointer", fontSize: 16, fontWeight: 600,
  },
};
