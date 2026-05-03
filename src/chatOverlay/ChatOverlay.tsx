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
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { FaPaperPlane, FaCommentDots, FaFaceSmile } from "react-icons/fa6";
import { isApex, tierIconUrl, tierLabel, tierTheme, type RankTier } from "../ranked";
import { EMOJI_CATEGORIES } from "./emotes";

const OVERLAY_WIDTH = 340;
const POLL_INTERVAL_MS = 200;
const MAX_MESSAGE_LEN = 300;
const TEXTAREA_MAX_ROWS = 4;
const GROUP_THRESHOLD_MS = 60_000; // bulles consécutives mêmes sender < 60s = même groupe

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

interface FloatingEmote {
  id: number;
  emoji: string;
  /** % horizontal de départ (0-100), permet aux 2 sides d'avoir des positions variées. */
  startPct: number;
  /** Drift horizontal en px sur la durée de l'animation (-50 à +50). */
  drift: number;
  /** Léger jitter sur la durée pour éviter le côté "rythmé". */
  duration: number;
  /** "me" → spawn à droite (près du smiley btn) ; "them" → spawn côté gauche. */
  side: "me" | "them";
}

const FLOAT_LIFETIME_MS = 2600;

/* ════════════════════ Audio (Web Audio API) ════════════════════
 * Sons générés dynamiquement — zéro fichier externe → zéro souci CSP.
 * Volume volontairement bas (0.04-0.08) pour rester discret.
 */
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === "closed") {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      _audioCtx = new Ctor();
    }
    return _audioCtx;
  } catch { return null; }
}

/** Ding doux à 2 tons (descendant) pour les messages reçus. */
function playReceiveSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    // Tone 1 — sin 880Hz, attaque rapide puis decay exponentiel
    const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
    o1.type = "sine"; o1.frequency.value = 880;
    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(0.07, now + 0.005);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o1.connect(g1); g1.connect(ctx.destination);
    o1.start(now); o1.stop(now + 0.2);
    // Tone 2 — overlap court, plus aigu, donne le côté "chime"
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
    o2.type = "sine"; o2.frequency.value = 1175; // ~D6
    g2.gain.setValueAtTime(0, now + 0.02);
    g2.gain.linearRampToValueAtTime(0.04, now + 0.025);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    o2.connect(g2); g2.connect(ctx.destination);
    o2.start(now + 0.02); o2.stop(now + 0.17);
  } catch {}
}

/** Swoosh court (montant) pour confirmation d'envoi. */
function playSendSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(540, now);
    o.frequency.exponentialRampToValueAtTime(820, now + 0.07);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.04, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.09);
  } catch {}
}

/** Initiale en majuscule pour le fallback avatar (1er char alphanum). */
function initialOf(name: string): string {
  const m = name.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "?";
}

/** Hash stable d'un nom → angle 0-360 pour la teinte du gradient avatar. */
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/** Format HH:MM locale (utilisé en timestamp visible et en title). */
function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

/**
 * Calcule des positions de groupage : pour chaque message, indique s'il est
 * le début, fin, ou milieu d'un groupe (même sender, < 60s du précédent).
 * Permet d'ajuster spacing et coins arrondis pour un look "chat moderne".
 */
type GroupPos = "single" | "first" | "middle" | "last";
function computeGroupPositions(msgs: ChatLine[]): GroupPos[] {
  return msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const sameAsPrev = prev && prev.fromMe === m.fromMe && m.ts - prev.ts < GROUP_THRESHOLD_MS;
    const sameAsNext = next && next.fromMe === m.fromMe && next.ts - m.ts < GROUP_THRESHOLD_MS;
    if (!sameAsPrev && !sameAsNext) return "single";
    if (!sameAsPrev) return "first";
    if (!sameAsNext) return "last";
    return "middle";
  });
}

export default function ChatOverlay() {
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [peer, setPeer] = useState<PeerInfo>({ opponentName: "Adversaire", opponentAvatar: null, myUserId: "" });
  const [myRank, setMyRank] = useState<RankInfo | null>(null);
  const [opponentRank, setOpponentRank] = useState<RankInfo | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [pulseHeader, setPulseHeader] = useState(false);
  const [emotePickerOpen, setEmotePickerOpen] = useState(false);
  const [emoteCategory, setEmoteCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [floatingEmotes, setFloatingEmotes] = useState<FloatingEmote[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idCounterRef = useRef(0);
  const floatingIdRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emotePickerWrapRef = useRef<HTMLDivElement>(null);

  const groupPositions = useMemo(() => computeGroupPositions(messages), [messages]);

  // ─── Marquer le body pour scoper les overrides CSS ───
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
        playReceiveSound();
        // Pulse header subtil pour signaler l'activité
        setPulseHeader(true);
        setTimeout(() => setPulseHeader(false), 700);
      }),
      listen<{ fromUserId: string; emoji: string; ts: number }>("chat:incoming-emote", (e) => {
        // Les emotes adverses spawnent côté gauche pour se distinguer des nôtres
        spawnFloatingEmote(e.payload.emoji, "them");
      }),
      listen("chat:battle-end", async () => {
        try { await getCurrentWebviewWindow().close(); } catch {}
      }),
    ]).then(async (fns) => {
      if (cancelled) { fns.forEach((fn) => fn()); return; }
      fns.forEach((fn) => unlistens.push(fn));
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
    const maxHeight = lineHeight * TEXTAREA_MAX_ROWS + 16;
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
      playSendSound();
      inputRef.current?.focus();
    } catch (e) {
      console.warn("[ChatOverlay] send error", e);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ─── Spawn un emoji floté qui drift bottom→top (style TikTok hearts) ───
  // `side` détermine le côté de départ : "me" = droite (près du smiley btn),
  // "them" = gauche. Auto-removed du state après FLOAT_LIFETIME_MS.
  const spawnFloatingEmote = useCallback((emoji: string, side: "me" | "them") => {
    floatingIdRef.current += 1;
    const id = floatingIdRef.current;
    // Position % : "me" cluster côté droit (60-90%), "them" côté gauche (10-40%)
    const startPct = side === "me"
      ? 60 + Math.random() * 30
      : 10 + Math.random() * 30;
    const drift = (Math.random() - 0.5) * 80; // ±40px
    const duration = FLOAT_LIFETIME_MS + (Math.random() - 0.5) * 400; // ±200ms jitter
    setFloatingEmotes((prev) => [...prev, { id, emoji, startPct, drift, duration, side }]);
    setTimeout(() => {
      setFloatingEmotes((prev) => prev.filter((e) => e.id !== id));
    }, duration + 100);
  }, []);

  // ─── Click sur emoji dans le picker = spawn local + envoi à l'adversaire ───
  const onEmotePick = useCallback((emoji: string) => {
    spawnFloatingEmote(emoji, "me");
    void emit("chat:send-emote", { emoji });
  }, [spawnFloatingEmote]);

  // ─── Fermer le picker au click-outside et à Escape ───
  useEffect(() => {
    if (!emotePickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (emotePickerWrapRef.current && !emotePickerWrapRef.current.contains(e.target as Node)) {
        setEmotePickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmotePickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [emotePickerOpen]);

  const charsLeft = MAX_MESSAGE_LEN - draft.length;
  const showCounter = charsLeft <= 50;

  // Couleur tier de l'adversaire pour teinter subtilement le chat (header glow, etc.)
  const opponentTierColor = opponentRank ? tierTheme(opponentRank.tier).accent : null;
  const opponentTierGlow = opponentRank ? tierTheme(opponentRank.tier).glow : null;

  return (
    <div
      className="chat-overlay-root flex h-screen w-screen flex-col overflow-hidden"
      style={opponentTierColor ? { ["--tier-accent" as any]: opponentTierColor, ["--tier-glow" as any]: opponentTierGlow } : undefined}
    >
      {/* ───── Header ───── */}
      <div className={`chat-overlay-header flex items-center gap-3 px-3 py-2.5 ${pulseHeader ? "chat-overlay-header--pulse" : ""}`}>
        <Avatar name={peer.opponentName} url={peer.opponentAvatar ?? null} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white tracking-tight">{peer.opponentName}</div>
          {opponentRank ? (
            <RankBadge rank={opponentRank} compact />
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-white/55 mt-0.5">
              <span className="chat-status-dot" />
              <span>combat en cours</span>
            </div>
          )}
        </div>
      </div>

      {/* ───── Messages ───── */}
      <div
        ref={messagesContainerRef}
        onScroll={onScroll}
        className="chat-overlay-messages flex-1 overflow-y-auto px-3 py-3 flex flex-col"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m, i) => {
            const pos = groupPositions[i];
            const isGroupEnd = pos === "single" || pos === "last";
            const isGroupStart = pos === "single" || pos === "first";
            return (
              <div
                key={m.id}
                className={`chat-bubble-row flex chat-bubble-row--${pos} ${
                  m.fromMe ? "justify-end" : "justify-start"
                }`}
              >
                <div className="flex flex-col max-w-[80%]" style={{ alignItems: m.fromMe ? "flex-end" : "flex-start" }}>
                  <div
                    className={`chat-bubble px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap break-words ${
                      m.fromMe ? "chat-bubble--me" : "chat-bubble--them"
                    } chat-bubble--${pos}`}
                    title={formatTime(m.ts)}
                  >
                    {m.text}
                  </div>
                  {isGroupEnd && (
                    <div className={`chat-bubble-time text-[10px] mt-0.5 px-1 ${m.fromMe ? "text-right" : "text-left"}`}>
                      {formatTime(m.ts)}
                    </div>
                  )}
                </div>
                {/* Réserver une marge subtile pour les groupes (premier de groupe = espace au-dessus) */}
                <span className="sr-only">{isGroupStart ? "" : ""}</span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ───── Input + Emote picker ───── */}
      <div ref={emotePickerWrapRef} className="relative">
        {emotePickerOpen && (
          <EmotePicker
            activeId={emoteCategory}
            onCategoryChange={setEmoteCategory}
            onPick={onEmotePick}
            onClose={() => setEmotePickerOpen(false)}
          />
        )}
        <div className="chat-overlay-input-row flex items-end gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setEmotePickerOpen((v) => !v)}
            aria-label="Emojis"
            className={`chat-overlay-emote-btn h-9 w-9 shrink-0 grid place-items-center rounded-xl text-base transition-all duration-150 ${emotePickerOpen ? "chat-overlay-emote-btn--active" : ""}`}
          >
            <FaFaceSmile />
          </button>
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LEN))}
              onKeyDown={onKeyDown}
              placeholder="Message…"
              rows={1}
              maxLength={MAX_MESSAGE_LEN}
              className="chat-overlay-textarea w-full resize-none rounded-xl px-3 py-2 text-[13px] leading-snug outline-none"
            />
            {showCounter && (
              <div
                className={`pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums ${
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
            className="chat-overlay-send-btn h-9 w-9 shrink-0 grid place-items-center rounded-xl text-white text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:scale-105 enabled:active:scale-90"
          >
            <FaPaperPlane className="translate-x-[-1px]" />
          </button>
        </div>
      </div>

      {/* ───── Mon rang (footer discret) ───── */}
      {myRank && (
        <div className="chat-overlay-myrank flex items-center gap-1.5 px-3 py-1.5 text-[10px]">
          <span className="font-semibold text-white/55 tracking-wide uppercase text-[9px]">Toi</span>
          <span className="text-white/20">·</span>
          <RankBadge rank={myRank} compact tiny />
        </div>
      )}

      {/* ───── Layer floating emotes (TikTok hearts) ─────
          Position absolute par-dessus tout le contenu, pointer-events:none
          pour ne rien bloquer en dessous. */}
      <div className="chat-floating-layer">
        {floatingEmotes.map((em) => (
          <span
            key={em.id}
            className={`chat-floating-emote chat-floating-emote--${em.side}`}
            style={{
              left: `${em.startPct}%`,
              animationDuration: `${em.duration}ms`,
              ["--drift" as any]: `${em.drift}px`,
            }}
          >
            {em.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Sub-components ─────────────────────────── */

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return (
      <img
        src={url}
        alt=""
        className="chat-avatar h-10 w-10 shrink-0 rounded-full object-cover"
        onError={() => setErrored(true)}
      />
    );
  }
  const hue = hueFromName(name);
  // Gradient unique par nom → 2 personnes différentes ne se confondent pas visuellement.
  const bg = `linear-gradient(135deg, hsl(${hue}, 65%, 55%), hsl(${(hue + 40) % 360}, 70%, 35%))`;
  return (
    <div
      className="chat-avatar chat-avatar--fallback h-10 w-10 shrink-0 rounded-full grid place-items-center font-bold text-white text-base"
      style={{ background: bg }}
    >
      {initialOf(name)}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="m-auto flex flex-col items-center text-center select-none chat-empty-state">
      <div className="chat-empty-icon grid place-items-center w-14 h-14 rounded-2xl mb-3">
        <FaCommentDots className="text-2xl" style={{ color: "var(--tier-accent, var(--accent))" }} />
      </div>
      <div className="text-[13px] font-medium text-white/60">Personne n'a encore parlé</div>
      <div className="text-[11px] mt-1 text-white/30 leading-relaxed">
        <kbd className="chat-kbd">Entrée</kbd> pour envoyer<br />
        <kbd className="chat-kbd">Maj</kbd> + <kbd className="chat-kbd">Entrée</kbd> nouvelle ligne
      </div>
    </div>
  );
}

function RankBadge({ rank, compact = false, tiny = false }: { rank: RankInfo; compact?: boolean; tiny?: boolean }) {
  const theme = tierTheme(rank.tier);
  const label = tierLabel(rank.tier, "fr");
  const showLp = rank.tier !== "unranked";
  const showStats = rank.wins + rank.losses > 0;
  const apex = isApex(rank.tier);
  const iconSize = tiny ? 12 : compact ? 14 : 18;
  const fontSize = tiny ? 10 : compact ? 11 : 13;

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap" style={{ fontSize, lineHeight: 1.2 }}>
      <div
        className={`rank-badge inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${apex ? "rank-badge--apex" : ""}`}
        style={{
          background: `linear-gradient(135deg, ${theme.glow}, transparent)`,
          boxShadow: `inset 0 0 0 1px ${theme.glow}`,
          color: theme.accent,
          ["--rank-glow" as any]: theme.glow,
          ["--rank-glow-strong" as any]: theme.glowStrong,
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

/* ─────────────────────────── EmotePicker ─────────────────────────── */

interface EmotePickerProps {
  activeId: string;
  onCategoryChange: (id: string) => void;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

function EmotePicker({ activeId, onCategoryChange, onPick, onClose }: EmotePickerProps) {
  const active = EMOJI_CATEGORIES.find((c) => c.id === activeId) ?? EMOJI_CATEGORIES[0];
  return (
    <div className="chat-emote-picker">
      {/* Onglets catégories — scrollable horizontalement */}
      <div className="chat-emote-tabs flex overflow-x-auto">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCategoryChange(c.id)}
            title={c.label}
            aria-label={c.label}
            className={`chat-emote-tab shrink-0 grid place-items-center text-base ${activeId === c.id ? "chat-emote-tab--active" : ""}`}
          >
            <span aria-hidden>{c.icon}</span>
          </button>
        ))}
      </div>

      {/* Grille de la catégorie active */}
      <div className="chat-emote-grid">
        {active.emojis.map((e, idx) => (
          <button
            key={`${active.id}-${idx}-${e}`}
            type="button"
            onClick={() => onPick(e)}
            className="chat-emote-cell"
            aria-label={`Insérer ${e}`}
          >
            <span aria-hidden>{e}</span>
          </button>
        ))}
      </div>

      {/* Footer : nom de la catégorie + close */}
      <div className="chat-emote-footer">
        <span className="chat-emote-category-name">{active.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="chat-emote-close"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
