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
 *   overlay → launcher : "chat:ready" {}  (handshake)
 *   launcher → overlay : "chat:incoming" { fromUserId, text, ts }
 *   launcher → overlay : "chat:peer-info" { opponentName, opponentAvatar?, myUserId }
 *   launcher → overlay : "chat:battle-end" {}
 *
 * Polling de la fenêtre du jeu : appel à `cmd_get_game_window_rect` toutes
 * les 200ms. Si trouvée et !isFullscreen, on se positionne à droite. Sinon,
 * on se cache.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { FaPaperPlane, FaCommentDots, FaCircle } from "react-icons/fa6";
import { tierIconUrl, tierLabel, tierTheme, type RankTier } from "../ranked";

const OVERLAY_WIDTH = 340;
const POLL_INTERVAL_MS = 200;
const MAX_MESSAGE_LEN = 300;
const TEXTAREA_MAX_ROWS = 4;

interface ChatLine {
  id: number;
  fromMe: boolean;
  text: string;
  ts: number;
}

interface PeerInfo {
  opponentName: string;
  opponentAvatar?: string | null;
  myUserId: string;
}

interface RankInfo {
  tier: RankTier;
  lp: number;
  mmr: number;
  wins: number;
  losses: number;
}

interface RankInfoPayload {
  mine: RankInfo | null;
  opponent: RankInfo | null;
}

/** Initiale en majuscule pour le fallback avatar (1er char alphanum). */
function initialOf(name: string): string {
  const m = name.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "?";
}

/** Format minute:seconde locale pour le hover des messages. */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatOverlay() {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [peer, setPeer] = useState<PeerInfo>({ opponentName: "Adversaire", opponentAvatar: null, myUserId: "" });
  const [myRank, setMyRank] = useState<RankInfo | null>(null);
  const [opponentRank, setOpponentRank] = useState<RankInfo | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idCounterRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Marquer le body pour scoper les overrides CSS (cacher le GIF de fond) ───
  useEffect(() => {
    document.body.dataset.overlay = "chat";
    return () => { delete document.body.dataset.overlay; };
  }, []);

  // ─── Auto-scroll uniquement si l'utilisateur est déjà en bas ───
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isAtBottom]);

  // Détecte si l'utilisateur a scrollé manuellement vers le haut
  const onScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(dist < 32);
  }, []);

  // ─── Listen events from launcher ───
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    Promise.all([
      listen<PeerInfo>("chat:peer-info", (e) => {
        setPeer(e.payload);
      }),
      listen<RankInfoPayload>("chat:rank-info", (e) => {
        setMyRank(e.payload.mine);
        setOpponentRank(e.payload.opponent);
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
      // Handshake : signaler au launcher que l'overlay est prêt
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
          if (lastVisible !== false) { await win.hide(); lastVisible = false; }
        } else {
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
          if (lastVisible !== true) { await win.show(); lastVisible = true; }
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

  // ─── Auto-resize textarea ───
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const maxHeight = lineHeight * TEXTAREA_MAX_ROWS + 16; // +padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [draft]);

  // ─── Send message ───
  const send = async () => {
    const text = draft.trim();
    if (!text || text.length > MAX_MESSAGE_LEN) return;
    try {
      await emit("chat:send", { text });
      idCounterRef.current += 1;
      setMessages((prev) => [
        ...prev,
        { id: idCounterRef.current, fromMe: true, text, ts: Date.now() },
      ]);
      setDraft("");
      setIsAtBottom(true);
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

  const charsLeft = MAX_MESSAGE_LEN - draft.length;
  const showCounter = charsLeft <= 50;

  return (
    <div className="chat-overlay-root flex h-screen w-screen flex-col overflow-hidden">
      {/* ───── Header ───── */}
      <div className="chat-overlay-header flex items-center gap-3 px-3 py-2.5">
        {peer.opponentAvatar ? (
          <img
            src={peer.opponentAvatar}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/20"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div
            className="h-9 w-9 shrink-0 rounded-full grid place-items-center font-bold text-white text-sm ring-2 ring-white/15"
            style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 80%, #000), color-mix(in srgb, var(--accent) 55%, #000))" }}
          >
            {initialOf(peer.opponentName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{peer.opponentName}</div>
          {opponentRank ? (
            <RankBadge rank={opponentRank} compact />
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-white/55">
              <FaCircle className="text-[6px] text-emerald-400" />
              <span>combat en cours</span>
            </div>
          )}
        </div>
      </div>

      {/* ───── Messages ───── */}
      <div
        ref={messagesContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center text-center text-white/40 select-none">
            <div
              className="grid place-items-center w-12 h-12 rounded-full mb-3"
              style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}
            >
              <FaCommentDots className="text-xl" style={{ color: "var(--accent)" }} />
            </div>
            <div className="text-xs font-medium">Aucun message</div>
            <div className="text-[11px] mt-1 text-white/30">Tapez pour envoyer</div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`chat-bubble-row flex ${m.fromMe ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`chat-bubble max-w-[78%] px-3 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                  m.fromMe ? "chat-bubble--me" : "chat-bubble--them"
                }`}
                title={formatTime(m.ts)}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ───── Input ───── */}
      <div className="chat-overlay-input-row flex items-end gap-2 px-3 py-2.5">
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LEN))}
            onKeyDown={onKeyDown}
            placeholder="Message…"
            rows={1}
            maxLength={MAX_MESSAGE_LEN}
            className="chat-overlay-textarea w-full resize-none rounded-xl px-3 py-2 text-sm leading-snug outline-none"
          />
          {showCounter && (
            <div
              className={`pointer-events-none absolute bottom-1 right-2 text-[10px] tabular-nums ${
                charsLeft <= 0 ? "text-red-400" : "text-white/35"
              }`}
            >
              {charsLeft}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Envoyer"
          className="chat-overlay-send-btn h-9 w-9 shrink-0 grid place-items-center rounded-xl text-white text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:scale-105 enabled:active:scale-95"
        >
          <FaPaperPlane />
        </button>
      </div>

      {/* ───── Mon rang (footer discret) ───── */}
      {myRank && (
        <div className="chat-overlay-myrank flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-white/45">
          <span className="font-medium text-white/55">Toi</span>
          <span className="text-white/25">·</span>
          <RankBadge rank={myRank} compact tiny />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── RankBadge ─────────────────────────── */

function RankBadge({ rank, compact = false, tiny = false }: { rank: RankInfo; compact?: boolean; tiny?: boolean }) {
  const theme = tierTheme(rank.tier);
  const label = tierLabel(rank.tier, "fr");
  const showLp = rank.tier !== "unranked";
  const showStats = rank.wins + rank.losses > 0;
  const iconSize = tiny ? 12 : compact ? 14 : 18;
  const fontSize = tiny ? 10 : compact ? 11 : 13;

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap" style={{ fontSize, lineHeight: 1.2 }}>
      <div
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
        style={{
          background: `linear-gradient(135deg, ${theme.glow}, transparent)`,
          boxShadow: `inset 0 0 0 1px ${theme.glow}`,
          color: theme.accent,
        }}
      >
        <img
          src={tierIconUrl(rank.tier)}
          alt=""
          width={iconSize}
          height={iconSize}
          style={{ filter: `drop-shadow(0 0 4px ${theme.glow})` }}
        />
        <span className="font-semibold tracking-tight">{label}</span>
        {showLp && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span className="tabular-nums" style={{ opacity: 0.85 }}>{rank.lp} LP</span>
          </>
        )}
      </div>
      {showStats && (
        <span className="tabular-nums" style={{ color: "rgba(255,255,255,.5)" }}>
          <span style={{ color: "#86efac" }}>{rank.wins}W</span>
          <span style={{ opacity: 0.4, margin: "0 4px" }}>·</span>
          <span style={{ color: "#fca5a5" }}>{rank.losses}L</span>
        </span>
      )}
    </div>
  );
}
