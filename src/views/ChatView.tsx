import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { monIconCandidates, rootFromSavePath } from "../utils/monSprite";
import {
  FaArrowLeft, FaPaperPlane, FaMessage, FaLock, FaCommentDots,
  FaRightFromBracket, FaSpinner, FaUserShield,
  FaStar, FaHeart, FaCrown, FaPlus, FaXmark, FaMagnifyingGlass,
  FaChevronRight, FaShieldHalved, FaEnvelope,
  FaPen, FaCamera, FaImage, FaFloppyDisk, FaDiscord, FaCalendar,
  FaBolt, FaFireFlameCurved, FaVolumeXmark, FaBan, FaClock, FaGear, FaTrashCan,
  FaGaugeHigh, FaSlash, FaUsers, FaCircle, FaAt, FaQuoteLeft,
  FaUserPlus, FaUserCheck, FaUserXmark, FaUserGroup, FaBell, FaTrash,
  FaUpload, FaReply, FaScroll, FaArrowRightFromBracket, FaCode,
  FaArrowRightArrowLeft, FaShareNodes, FaTrophy, FaBookOpen, FaThumbtack,
  FaGamepad, FaMapLocationDot, FaCoins, FaMedal,
  FaChartLine, FaMars, FaVenus, FaVenusMars, FaLeaf, FaBagShopping,
  FaLayerGroup, FaChartPie, FaDna, FaHandFist, FaShield, FaWandMagicSparkles,
} from "react-icons/fa6";
import { supabase } from "../supabaseClient";
import { LoadingScreen } from "../ui";
import { NATURE_FR } from "../gtsDepositedPokemon";
import {
  signInWithDiscord, signOut, getSession, getChatProfile, onAuthStateChange,
  updateChatProfile,
  muteUser, banUser, unmuteUser, getActiveMute, getActiveBan, deleteMessage, updateMessage, toggleSlowmode,
  getMutedUserIds, getBannedUserIds,
  sendFriendRequest, acceptFriendRequest, removeFriend, getFriends, getFriendship, leaveDmChannel,
  blockUser, unblockUser, getBlockedUsers,
  uploadMessageImage, uploadDmBackground, updateChannelBackground,
  togglePinMessage, fetchPinnedMessages,
} from "../chatAuth";
import type { ChatChannel, ChatMessage, ChatProfile, ChatMute, ChatBan, ChatFriend, PlayerProfile, GameLiveState, GameLivePlayer, GameActivityShareData, TradeState, TradeSelection, TradeSelectionPreview, TradeMessageData, BattleRoomState } from "../types";
import { generateRoomCode, writeBattleTrigger, writeStopTrigger, startRelay, cleanupBattleFiles, fullCleanup, isGameRunning, BATTLE_INVITE_TIMEOUT, connectLobby, sendBattleInvite, sendBattleCancel, playTurnSound, saveBattleLog } from "../battleRelay";
import BattleArenaView from "./BattleArenaView";
import { TRADE_PREFIX, generateTradeId, validateIncomingBytes, extractAndEncode, executeTradeLocally, buildTradeMessage, parseTradeMessage, TRADE_PENDING_TIMEOUT, TRADE_SELECTING_TIMEOUT, TRADE_CONFIRMING_TIMEOUT, TRADE_EXECUTING_TIMEOUT } from "../tradeP2P";
import { loadSaveForEdit, extractPokemonFromBox, encodePokemonForGts } from "../saveWriter";
import { upsertLeaderboardScore, fetchLeaderboard, type LeaderboardEntry } from "../leaderboard";
import type { Session } from "@supabase/supabase-js";
import AdminPanel from "../components/AdminPanel";
import PCBoxView from "./PCBoxView";
import GtsSwapAnim from "../components/GtsSwapAnim";
import { getTypeStyle, getTypeLabel } from "../utils/typeStyles";

/* ==================== Role badges ==================== */

const ROLE_BADGE: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  admin:    { icon: <FaCrown />,  color: "#fff", bg: "#e74c3c", label: "Admin" },
  devteam:  { icon: <FaCode />,   color: "#fff", bg: "#3498db", label: "Dev Team" },
  patreon:  { icon: <FaHeart />,  color: "#fff", bg: "#f96854", label: "Patreon" },
  vip:      { icon: <FaStar />,   color: "#fff", bg: "#f1c40f", label: "VIP" },
};

/** Returns aura/glow style for avatar based on highest role */
function roleGlow(roles: string[]): React.CSSProperties | undefined {
  for (const r of ["admin", "devteam", "patreon", "vip"]) {
    if (roles.includes(r)) {
      const color = ROLE_BADGE[r].bg;
      return { boxShadow: `0 0 10px ${color}88, 0 0 20px ${color}44`, border: `2px solid ${color}`, borderRadius: "50%" };
    }
  }
  return undefined;
}

/** Returns accent color for author name based on highest role */
function roleColor(roles: string[]): string | undefined {
  for (const r of ["admin", "devteam", "patreon", "vip"]) {
    if (roles.includes(r)) return ROLE_BADGE[r].bg;
  }
  return undefined;
}

/** Compact badge: just icon (for message meta line) */
function RoleBadgesCompact({ roles }: { roles: string[] }) {
  if (!roles.length) return null;
  return (
    <span className="pnw-chat-badges">
      {roles.map((r) => {
        const b = ROLE_BADGE[r];
        if (!b) return null;
        return (
          <span key={r} className="pnw-chat-badge-dot" style={{ background: b.bg }} title={b.label}>
            {b.icon}
          </span>
        );
      })}
    </span>
  );
}

/** Full badge pills (for profile card) */
function RoleBadges({ roles }: { roles: string[] }) {
  if (!roles.length) return null;
  return (
    <div className="pnw-chat-badges-full">
      {roles.map((r) => {
        const b = ROLE_BADGE[r];
        if (!b) return null;
        return (
          <span key={r} className="pnw-chat-badge-pill" style={{ background: b.bg, color: b.color }}>
            {b.icon}
            <span>{b.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/* ==================== Channel icon ==================== */

function ChannelIcon({ type, name }: { type: string; name?: string | null }) {
  if (type === "moderation" && name?.toLowerCase().includes("log")) return <FaScroll />;
  if (type === "moderation") return <FaShieldHalved />;
  if (type === "dm") return <FaEnvelope />;
  return <FaMessage />;
}

/* ==================== Log types ==================== */

type LogEntry = {
  type: "edit" | "delete" | "mute" | "unmute" | "ban" | "unban";
  modName: string;
  modAvatar?: string | null;
  modId: string;
  targetName: string;
  targetAvatar?: string | null;
  targetId: string;
  detail?: string;
};

const LOG_PREFIX = "📋LOG:";
const POKEMON_PREFIX = "🎴POKEMON🎴";
const GTS_PREFIX = "🔄GTS🔄";
const ACTIVITY_PREFIX = "🎮ACTIVITY🎮";
const WISHLIST_PREFIX = "🔔WISHLIST🔔";

interface PokeEntry {
  num?: string; number?: string; name: string;
  types?: string[]; type?: string; imageUrl?: string;
  evolution?: string; rarity?: string; obtention?: string;
  hp?: number; atk?: number; def?: number;
  spa?: number; spd?: number; spe?: number; total?: number;
  talents?: Array<{ name?: string; desc?: string; hidden?: boolean }>;
  attacks?: string | Array<{ name?: string; desc?: string }>;
}

/* ==================== Collapsible category (Discord-style) ==================== */

function ChannelCategory({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pnw-chat-category">
      <button className="pnw-chat-category-header" onClick={() => setOpen((v) => !v)}>
        <span className={`pnw-chat-category-chevron ${open ? "pnw-chat-category-chevron--open" : ""}`}>
          <FaChevronRight />
        </span>
        <span className="pnw-chat-category-label">{label}</span>
      </button>
      {open && <div className="pnw-chat-category-items">{children}</div>}
    </div>
  );
}

/* ==================== Moderation Modals ==================== */

const MUTE_DURATIONS = [
  { label: "5 min", min: 5 },
  { label: "15 min", min: 15 },
  { label: "1 heure", min: 60 },
  { label: "24 heures", min: 1440 },
  { label: "Permanent", min: 0 },
];

const BAN_DURATIONS = [
  { label: "1 heure", min: 60 },
  { label: "24 heures", min: 1440 },
  { label: "7 jours", min: 10080 },
  { label: "30 jours", min: 43200 },
  { label: "Permanent", min: 0 },
];

function MuteModal({ target, moderatorId, onClose, onDone, onLog }: {
  target: ChatProfile; moderatorId: string; onClose: () => void; onDone: () => void;
  onLog?: (entry: LogEntry) => void;
}) {
  const [reason, setReason] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [saving, setSaving] = useState(false);

  async function handleMute() {
    setSaving(true);
    const dur = selectedDuration === 0 ? undefined : selectedDuration;
    await muteUser(target.id, moderatorId, reason, dur);
    const durLabel = MUTE_DURATIONS.find((d) => d.min === selectedDuration)?.label || "";
    onLog?.({ type: "mute", modName: "", modAvatar: null, modId: moderatorId, targetName: displayName(target), targetAvatar: target.avatar_url, targetId: target.id, detail: (durLabel + (reason ? ` — ${reason}` : "")).trim() });
    setSaving(false);
    onDone();
  }

  return (
    <div className="pnw-chat-profile-overlay" onClick={onClose}>
      <div className="pnw-mod-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pnw-mod-modal-header">
          <FaVolumeXmark style={{ color: "#f39c12" }} />
          <span>Muter {displayName(target)}</span>
          <button onClick={onClose}><FaXmark /></button>
        </div>
        <div className="pnw-mod-modal-body">
          <label className="pnw-mod-label">Durée</label>
          <div className="pnw-mod-duration-grid">
            {MUTE_DURATIONS.map((d) => (
              <button
                key={d.min}
                className={`pnw-mod-duration ${selectedDuration === d.min ? "pnw-mod-duration--active" : ""}`}
                onClick={() => setSelectedDuration(d.min)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <label className="pnw-mod-label">Raison (optionnel)</label>
          <input className="pnw-mod-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison du mute…" />
        </div>
        <div className="pnw-mod-modal-footer">
          <button className="pnw-admin-btn pnw-admin-btn--cancel" onClick={onClose}>Annuler</button>
          <button className="pnw-admin-btn pnw-admin-btn--mute" onClick={handleMute} disabled={saving}>
            {saving ? <FaSpinner className="pnw-chat-spinner" /> : <FaVolumeXmark />} Muter
          </button>
        </div>
      </div>
    </div>
  );
}

function BanModal({ target, moderatorId, onClose, onDone, onLog }: {
  target: ChatProfile; moderatorId: string; onClose: () => void; onDone: () => void;
  onLog?: (entry: LogEntry) => void;
}) {
  const [reason, setReason] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(1440);
  const [saving, setSaving] = useState(false);

  async function handleBan() {
    setSaving(true);
    const dur = selectedDuration === 0 ? undefined : selectedDuration;
    await banUser(target.id, moderatorId, reason, dur);
    const durLabel = BAN_DURATIONS.find((d) => d.min === selectedDuration)?.label || "";
    onLog?.({ type: "ban", modName: "", modAvatar: null, modId: moderatorId, targetName: displayName(target), targetAvatar: target.avatar_url, targetId: target.id, detail: (durLabel + (reason ? ` — ${reason}` : "")).trim() });
    setSaving(false);
    onDone();
  }

  return (
    <div className="pnw-chat-profile-overlay" onClick={onClose}>
      <div className="pnw-mod-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pnw-mod-modal-header">
          <FaBan style={{ color: "#e74c3c" }} />
          <span>Bannir {displayName(target)}</span>
          <button onClick={onClose}><FaXmark /></button>
        </div>
        <div className="pnw-mod-modal-body">
          <label className="pnw-mod-label">Durée</label>
          <div className="pnw-mod-duration-grid">
            {BAN_DURATIONS.map((d) => (
              <button
                key={d.min}
                className={`pnw-mod-duration ${selectedDuration === d.min ? "pnw-mod-duration--active" : ""}`}
                onClick={() => setSelectedDuration(d.min)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <label className="pnw-mod-label">Raison (optionnel)</label>
          <input className="pnw-mod-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison du ban…" />
        </div>
        <div className="pnw-mod-modal-footer">
          <button className="pnw-admin-btn pnw-admin-btn--cancel" onClick={onClose}>Annuler</button>
          <button className="pnw-admin-btn pnw-admin-btn--ban" onClick={handleBan} disabled={saving}>
            {saving ? <FaSpinner className="pnw-chat-spinner" /> : <FaBan />} Bannir
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==================== Display name helper ==================== */

function displayName(p: ChatProfile | null | undefined): string {
  if (!p) return "Inconnu";
  return p.display_name?.trim() || p.username || "Joueur";
}

/* ==================== VdSprite — loads a VD sprite on demand ==================== */
function VdSprite({ speciesId, form, shiny, altShiny, className }: { speciesId: number; form: number; shiny?: boolean; altShiny?: boolean; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (speciesId <= 0) return;
    let active = true;
    const formArg = form > 0 ? form : null;
    (async () => {
      // Try alt shiny first, then shiny, then normal
      if (altShiny) {
        try {
          const r = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: formArg });
          if (active && r) { setSrc(r); return; }
        } catch {}
      }
      if (shiny) {
        try {
          const r = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: formArg });
          if (active && r) { setSrc(r); return; }
        } catch {}
      }
      try {
        const r = await invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: formArg });
        if (active && r) setSrc(r);
      } catch {}
    })();
    return () => { active = false; };
  }, [speciesId, form, shiny, altShiny]);
  if (!src) return <div className={className} style={{ display: "grid", placeItems: "center", background: "rgba(255,255,255,.05)", borderRadius: 8 }}><span style={{ fontSize: 10, opacity: 0.2 }}>?</span></div>;
  return <img src={src} alt="" className={className} style={{ objectFit: "contain", imageRendering: "pixelated" as any }} />;
}

/* ==================== SpriteImg — fallback-aware image ==================== */
function SpriteImg({ srcs, alt, className }: { srcs: string[]; alt?: string; className?: string }) {
  const [idx, setIdx] = useState(0);
  const triedRef = useRef(0);
  // Reset idx + triedRef when the first src changes (e.g. VD sprite loaded)
  const firstSrcRef = useRef(srcs[0]);
  if (firstSrcRef.current !== srcs[0]) {
    firstSrcRef.current = srcs[0];
    triedRef.current = 0;
    if (idx !== 0) setIdx(0);
  }

  const onError = useCallback(() => {
    triedRef.current += 1;
    if (triedRef.current < srcs.length) {
      setIdx(triedRef.current);
    }
  }, [srcs.length]);

  if (!srcs.length) return null;
  return <img src={srcs[idx]} onError={onError} alt={alt || ""} className={className} />;
}

/* ==================== TradePokeDetails — chips summary (for inline/embed) ==================== */
function TradePokeDetails({ pk, psdkNames }: { pk: import("../types").TradeSelectionPreview; psdkNames: { species: string[] | null; skills: string[] | null; abilities: string[] | null; items: string[] | null } }) {
  const ni = Array.isArray(pk.nature) ? pk.nature[0] : pk.nature;
  const nat = ni != null ? NATURE_FR[ni] : null;
  const itm = pk.itemName || (pk.itemHolding != null && pk.itemHolding > 0 ? (psdkNames.items?.[pk.itemHolding] ?? null) : null);
  const ivT = pk.ivHp != null ? ((pk.ivHp ?? 0) + (pk.ivAtk ?? 0) + (pk.ivDfe ?? 0) + (pk.ivSpd ?? 0) + (pk.ivAts ?? 0) + (pk.ivDfs ?? 0)) : null;
  return (
    <>
      <div className="pnw-trade-embed-details" style={{ marginTop: 6 }}>
        {nat && <span className="pnw-trade-embed-chip"><FaLeaf style={{ fontSize: 7 }} /> {nat}</span>}
        {itm && <span className="pnw-trade-embed-chip"><FaBagShopping style={{ fontSize: 7 }} /> {itm}</span>}
        {ivT != null && <span className="pnw-trade-embed-chip"><FaDna style={{ fontSize: 7 }} /> IV {ivT}/186</span>}
      </div>
      {pk.moves && pk.moves.length > 0 && (
        <div className="pnw-trade-embed-moves" style={{ marginTop: 4 }}>
          {pk.moves.map((mid, mi) => <span key={mi} className="pnw-trade-embed-move">{psdkNames.skills?.[mid] ?? `#${mid}`}</span>)}
        </div>
      )}
    </>
  );
}

/* ==================== TradePokeOverlay — full IV overlay (like profile hover) for trade modal ==================== */
function TradePokeOverlay({ pk, psdkNames }: { pk: import("../types").TradeSelectionPreview; psdkNames: { species: string[] | null; skills: string[] | null; abilities: string[] | null; items: string[] | null } }) {
  const ni = Array.isArray(pk.nature) ? pk.nature[0] : pk.nature;
  const nat = ni != null ? NATURE_FR[ni] : null;
  const itm = pk.itemName || (pk.itemHolding != null && pk.itemHolding > 0 ? (psdkNames.items?.[pk.itemHolding] ?? null) : null);
  const hasIvs = pk.ivHp != null;
  const ivRows = hasIvs ? [
    { Icon: FaHeart, label: "PS", v: pk.ivHp!, fill: "team-iv-fill--hp" },
    { Icon: FaHandFist, label: "Atk", v: pk.ivAtk!, fill: "team-iv-fill--atk" },
    { Icon: FaShield, label: "Déf", v: pk.ivDfe!, fill: "team-iv-fill--def" },
    { Icon: FaBolt, label: "Vit", v: pk.ivSpd!, fill: "team-iv-fill--spe" },
    { Icon: FaWandMagicSparkles, label: "Sp.A", v: pk.ivAts!, fill: "team-iv-fill--spa" },
    { Icon: FaShieldHalved, label: "Sp.D", v: pk.ivDfs!, fill: "team-iv-fill--spd" },
  ] : null;
  const ivTotal = ivRows ? ivRows.reduce((s, r) => s + r.v, 0) : 0;
  return (
    <div className="pnw-trade-overlay-details">
      <div className="team-ov-chips">
        <div className="team-ov-chip team-ov-chip--level">
          <FaChartLine className="team-ov-chip-ico team-ov-chip-ico--level" aria-hidden />
          <span className="team-ov-chip-val">{pk.level}</span>
        </div>
        {pk.gender != null && (
          <div className={`team-ov-chip team-ov-chip--gender${pk.gender}`}>
            {pk.gender === 0 ? <FaMars className="team-ov-chip-ico team-ov-chip-ico--male" /> : pk.gender === 1 ? <FaVenus className="team-ov-chip-ico team-ov-chip-ico--female" /> : null}
            <span className="team-ov-chip-val">{pk.gender === 0 ? "♂" : pk.gender === 1 ? "♀" : "—"}</span>
          </div>
        )}
        {nat && (
          <div className="team-ov-chip team-ov-chip--nature">
            <FaLeaf className="team-ov-chip-ico team-ov-chip-ico--nature" aria-hidden />
            <span className="team-ov-chip-val">{nat}</span>
          </div>
        )}
      </div>
      <div className="team-ov-details">
        {itm && (
          <div className="team-ov-detail">
            <FaBagShopping className="team-ov-detail-ico team-ov-detail-ico--item" aria-hidden />
            <span className="team-ov-detail-label">Objet</span>
            <span className="team-ov-detail-val">{itm}</span>
          </div>
        )}
      </div>
      {pk.moves && pk.moves.length > 0 && (
        <div className="team-ov-moves">
          <div className="team-ov-moves-head"><FaLayerGroup className="team-ov-moves-ico" aria-hidden /><span>Attaques</span></div>
          <div className="team-ov-moves-list">
            {pk.moves.map((id, mi) => <span key={mi} className="team-ov-move-chip">{pk.moveNames?.[mi] || (psdkNames.skills?.[id] ?? `#${id}`)}</span>)}
          </div>
        </div>
      )}
      {ivRows && (
        <>
          <div className="team-iv-head">
            <FaChartPie className="team-iv-head-ico" aria-hidden />
            <span className="team-iv-head-title">IV</span>
            <span className="team-iv-total"><FaDna className="team-iv-total-ico" aria-hidden /> Σ {ivTotal}<span className="team-iv-total-max">/186</span></span>
          </div>
          <div className="team-iv-rows">
            {ivRows.map(({ Icon, label: l, v, fill }) => (
              <div key={l} className="team-iv-row">
                <div className="team-iv-meta"><Icon className="team-iv-stat-ico" aria-hidden /><span className="team-iv-lab">{l}</span></div>
                <div className="team-iv-bar-track" aria-hidden><div className={`team-iv-bar-fill ${fill}`} style={{ width: `${Math.min(100, (v / 31) * 100)}%` }} /></div>
                <span className="team-iv-val">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ==================== ActivityEmbedParty — party grid with hover overlay in chat embeds ==================== */
function ActivityEmbedParty({ party, psdkNames }: { party: import("../types").GameActivitySharePartyMember[]; psdkNames: { species: string[] | null; skills: string[] | null; abilities: string[] | null; items: string[] | null } }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pk = hovered != null ? party[hovered] : null;
  const hasIvs = pk?.ivHp != null;
  const ivRows = hasIvs ? [
    { Icon: FaHeart, label: "PS", v: pk!.ivHp!, fill: "team-iv-fill--hp" },
    { Icon: FaHandFist, label: "Atk", v: pk!.ivAtk!, fill: "team-iv-fill--atk" },
    { Icon: FaShield, label: "Déf", v: pk!.ivDfe!, fill: "team-iv-fill--def" },
    { Icon: FaBolt, label: "Vit", v: pk!.ivSpd!, fill: "team-iv-fill--spe" },
    { Icon: FaWandMagicSparkles, label: "Sp.A", v: pk!.ivAts!, fill: "team-iv-fill--spa" },
    { Icon: FaShieldHalved, label: "Sp.D", v: pk!.ivDfs!, fill: "team-iv-fill--spd" },
  ] : null;
  const ivTotal = ivRows ? ivRows.reduce((s, r) => s + r.v, 0) : 0;
  return (
    <>
      <div className="pnw-chat-activity-embed-party">
        {party.map((p, i) => {
          const speciesLabel = psdkNames.species && p.speciesId > 0 ? psdkNames.species[p.speciesId] ?? p.species : p.species;
          return (
            <div
              key={i}
              className={`pnw-chat-activity-embed-poke${hovered === i ? " pnw-chat-activity-embed-poke--active" : ""}`}
              onMouseEnter={(e) => { setHovered(i); setRect(e.currentTarget.getBoundingClientRect()); }}
              onMouseLeave={() => setHovered((prev) => prev === i ? null : prev)}
            >
              {p.altShiny && <FaStar className="pnw-chat-activity-embed-poke-alt-shiny" />}
              {p.shiny && !p.altShiny && <FaStar className="pnw-chat-activity-embed-poke-shiny" />}
              <div className="pnw-chat-activity-embed-poke-sprite">
                <VdSprite speciesId={p.speciesId} form={p.form ?? 0} shiny={p.shiny} altShiny={p.altShiny} className="pnw-chat-activity-embed-poke-img" />
              </div>
              <span className="pnw-chat-activity-embed-poke-name">{speciesLabel}</span>
              <span className="pnw-chat-activity-embed-poke-lvl">Nv.{p.level}</span>
            </div>
          );
        })}
      </div>
      {pk && rect && createPortal((() => {
        const speciesLabel = psdkNames.species && pk.speciesId > 0 ? psdkNames.species[pk.speciesId] ?? pk.species : pk.species;
        const nickname = pk.nickname;
        const label = nickname ? (speciesLabel ? `${nickname} (${speciesLabel})` : nickname) : speciesLabel;
        const ow = 180;
        let left = rect.left + rect.width / 2 - ow / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - ow - 8));
        const top = rect.top - 8;
        return (
          <div className="team-mon-iv-overlay team-mon-iv-overlay--portal" style={{ left, bottom: window.innerHeight - top }}>
            <div className="team-iv-sprite-wrap" style={{ margin: "0 auto 0.3rem" }}>
              <VdSprite speciesId={pk.speciesId} form={pk.form ?? 0} shiny={pk.shiny} altShiny={pk.altShiny} className="team-iv-sprite" />
              {pk.altShiny && <FaStar className="team-iv-alt-shiny-star" />}
              {pk.shiny && !pk.altShiny && <FaStar className="team-iv-shiny-star" />}
            </div>
            {label && <div className="team-iv-nickname">{label}</div>}
            <div className="team-ov-chips">
              <div className="team-ov-chip team-ov-chip--level">
                <FaChartLine className="team-ov-chip-ico team-ov-chip-ico--level" aria-hidden />
                <span className="team-ov-chip-val">{pk.level}</span>
              </div>
              {pk.gender != null && (
                <div className={`team-ov-chip team-ov-chip--gender${pk.gender}`}>
                  {pk.gender === 0 ? <FaMars className="team-ov-chip-ico team-ov-chip-ico--male" /> :
                   pk.gender === 1 ? <FaVenus className="team-ov-chip-ico team-ov-chip-ico--female" /> :
                   <FaVenusMars className="team-ov-chip-ico team-ov-chip-ico--neutral" />}
                  <span className="team-ov-chip-val">{pk.gender === 0 ? "♂" : pk.gender === 1 ? "♀" : "—"}</span>
                </div>
              )}
              {pk.nature != null && (() => {
                const nIdx = Array.isArray(pk.nature) ? pk.nature[0] : pk.nature;
                return nIdx != null ? (
                  <div className="team-ov-chip team-ov-chip--nature">
                    <FaLeaf className="team-ov-chip-ico team-ov-chip-ico--nature" aria-hidden />
                    <span className="team-ov-chip-val">{NATURE_FR[nIdx] ?? `#${nIdx}`}</span>
                  </div>
                ) : null;
              })()}
            </div>
            <div className="team-ov-details">
              <div className="team-ov-detail">
                <FaWandMagicSparkles className="team-ov-detail-ico team-ov-detail-ico--ability" aria-hidden />
                <span className="team-ov-detail-label">Talent</span>
                <span className="team-ov-detail-val">{pk.ability != null && pk.ability > 0 ? (psdkNames.abilities?.[pk.ability] ?? `#${pk.ability}`) : "Aucun"}</span>
              </div>
              <div className="team-ov-detail">
                <FaBagShopping className="team-ov-detail-ico team-ov-detail-ico--item" aria-hidden />
                <span className="team-ov-detail-label">Objet</span>
                <span className="team-ov-detail-val">{pk.itemHolding != null && pk.itemHolding > 0 ? (psdkNames.items?.[pk.itemHolding] ?? `#${pk.itemHolding}`) : "Aucun"}</span>
              </div>
              {pk.exp != null && pk.exp > 0 && (
                <div className="team-ov-detail">
                  <FaChartLine className="team-ov-detail-ico team-ov-detail-ico--exp" aria-hidden />
                  <span className="team-ov-detail-label">EXP</span>
                  <span className="team-ov-detail-val">{pk.exp.toLocaleString("fr-FR")}</span>
                </div>
              )}
            </div>
            {pk.moves && pk.moves.length > 0 && (
              <div className="team-ov-moves">
                <div className="team-ov-moves-head">
                  <FaLayerGroup className="team-ov-moves-ico" aria-hidden />
                  <span>Attaques</span>
                </div>
                <div className="team-ov-moves-list">
                  {pk.moves.map((id, mi) => (
                    <span key={`${id}-${mi}`} className="team-ov-move-chip">{psdkNames.skills?.[id] ?? `#${id}`}</span>
                  ))}
                </div>
              </div>
            )}
            {ivRows && (<>
              <div className="team-iv-head">
                <FaChartPie className="team-iv-head-ico" aria-hidden />
                <span className="team-iv-head-title">IV</span>
                <span className="team-iv-total">
                  <FaDna className="team-iv-total-ico" aria-hidden />
                  Σ {ivTotal}<span className="team-iv-total-max">/186</span>
                </span>
              </div>
              <div className="team-iv-rows">
                {ivRows.map(({ Icon, label: l, v, fill }) => (
                  <div key={l} className="team-iv-row">
                    <div className="team-iv-meta"><Icon className="team-iv-stat-ico" aria-hidden /><span className="team-iv-lab">{l}</span></div>
                    <div className="team-iv-bar-track" aria-hidden><div className={`team-iv-bar-fill ${fill}`} style={{ width: `${Math.min(100, (v / 31) * 100)}%` }} /></div>
                    <span className="team-iv-val">{v}</span>
                  </div>
                ))}
              </div>
            </>)}
          </div>
        );
      })(), document.body)}
    </>
  );
}

/* ==================== ProfileCard popup ==================== */

function ProfileCard({
  target,
  isOwn,
  isMod,
  myRoles,
  targetMute,
  friendship,
  isBlocked,
  gameState,
  liveStatus,
  dexEntries,
  siteUrl,
  psdkNames,
  installDir,
  lastSavePath,
  gameProfile,
  onShareActivity,
  onProposeTrade,
  canTrade,
  onProposeBattle,
  canBattle,
  onClose,
  onEdit,
  onSendDm,
  onMute,
  onUnmute,
  onBan,
  onBlock,
  onUnblock,
  onAddFriend,
  onAcceptFriend,
  onRemoveFriend,
}: {
  target: ChatProfile;
  isOwn: boolean;
  isMod: boolean;
  myRoles: string[];
  targetMute?: ChatMute | null;
  friendship?: ChatFriend | null;
  isBlocked: boolean;
  gameState?: GameLiveState | null;
  liveStatus?: GameLivePlayer["liveStatus"];
  dexEntries: PokeEntry[];
  siteUrl: string;
  psdkNames: { species: string[] | null; skills: string[] | null; abilities: string[] | null; items: string[] | null };
  installDir: string;
  lastSavePath?: string | null;
  gameProfile?: PlayerProfile | null;
  onShareActivity: (data: GameActivityShareData) => void;
  onProposeTrade?: () => void;
  canTrade?: boolean;
  onProposeBattle?: () => void;
  canBattle?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSendDm: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onBan: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onAddFriend: () => void;
  onAcceptFriend: () => void;
  onRemoveFriend: () => void;
}) {
  const nameColor = roleColor(target.roles);
  const joinDate = new Date(target.created_at).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Resolve speciesId from name via psdkNames array
  const resolveSpeciesId = (speciesName: string, speciesId?: number): number => {
    if (speciesId && speciesId > 0) return speciesId;
    if (!psdkNames.species || !speciesName) return 0;
    const norm = normForLiveMatch(speciesName);
    const idx = psdkNames.species.findIndex((n) => n && normForLiveMatch(n) === norm);
    return idx > 0 ? idx : 0;
  };

  const [hoveredPoke, setHoveredPoke] = useState<number | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);

  // Load VD sprites for game state party + battle pokemon
  // Always resolve from gameState.party (real-time), use gameProfile.team only for form lookup
  const [vdSprites, setVdSprites] = useState<Record<string, string>>({});
  const vdRequestedRef = useRef<Set<string>>(new Set());

  // Detect when party composition changes (new Pokémon, different order, etc.)
  const partyKey = useMemo(() => {
    if (!gameState?.party) return "";
    return gameState.party.map((pk) => `${pk.species}_${pk.level}_${pk.shiny}`).join("|");
  }, [gameState?.party]);
  // Reset VD sprite cache when party composition changes
  const prevPartyKeyRef = useRef(partyKey);
  if (prevPartyKeyRef.current !== partyKey) {
    prevPartyKeyRef.current = partyKey;
    vdRequestedRef.current.clear();
  }
  useEffect(() => {
    if (!gameState) return;
    let active = true;
    const toLoad: { sid: number; form: number; shiny: boolean; altShiny?: boolean }[] = [];

    // Build a lookup from speciesId → form using gameProfile.team (for accurate forms)
    const formLookup = new Map<number, number>();
    if (isOwn && gameProfile?.team) {
      for (const m of gameProfile.team) {
        const sid = typeof m.code === "string" ? parseInt(m.code, 10) : Number(m.code);
        const form = typeof m.form === "string" ? parseInt(m.form, 10) : (m.form ?? 0);
        if (Number.isFinite(sid) && sid > 0) formLookup.set(sid, form);
      }
    }

    const addPoke = (speciesName: string, speciesId?: number, form?: number, shiny?: boolean, altShiny?: boolean) => {
      const sid = resolveSpeciesId(speciesName, speciesId);
      if (sid <= 0) return;
      const resolvedForm = formLookup.get(sid) ?? (typeof form === "number" && form > 0 ? form : 0);
      toLoad.push({ sid, form: resolvedForm, shiny: !!shiny, altShiny: !!altShiny });
    };

    // Utilise directement les données du jeu (game_state.json) — alt_shiny est maintenant inclus par le bridge
    gameState.party?.forEach((pk) => addPoke(pk.species, pk.species_id, pk.form, pk.shiny, pk.alt_shiny));
    if (gameState.battle_ally) addPoke(gameState.battle_ally.species, gameState.battle_ally.species_id, undefined, gameState.battle_ally.shiny, gameState.battle_ally.alt_shiny);
    gameState.battle_foes?.forEach((f) => addPoke(f.species, f.species_id, f.form, f.shiny, f.alt_shiny));

    // Filter out already-requested sprites to prevent infinite loop
    const newToLoad = toLoad.filter(({ sid, form, shiny, altShiny }) => {
      const keys = [`${sid}_${form}_n`];
      if (shiny) keys.push(`${sid}_${form}_s`);
      if (altShiny) keys.push(`${sid}_${form}_a`);
      const allRequested = keys.every((k) => vdRequestedRef.current.has(k));
      if (allRequested) return false;
      keys.forEach((k) => vdRequestedRef.current.add(k));
      return true;
    });
    if (newToLoad.length === 0) return;

    (async () => {
      const result: Record<string, string> = {};
      for (const { sid, form, shiny, altShiny } of newToLoad) {
        const formArg = form > 0 ? form : null;
        if (altShiny) {
          const aKey = `${sid}_${form}_a`;
          try {
            const r = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId: sid, form: formArg });
            if (r) result[aKey] = r;
          } catch {}
        }
        if (shiny) {
          const sKey = `${sid}_${form}_s`;
          try {
            const r = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId: sid, form: formArg });
            if (r) result[sKey] = r;
          } catch {}
        }
        const nKey = `${sid}_${form}_n`;
        try {
          const r = await invoke<string | null>("cmd_get_normal_sprite", { speciesId: sid, form: formArg });
          if (r) result[nKey] = r;
        } catch {}
      }
      if (active && Object.keys(result).length) setVdSprites((prev) => ({ ...prev, ...result }));
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyKey, psdkNames.species, isOwn]);

  // Build a lookup from speciesId to form using gameProfile.team (site data)
  const profileFormMap = useMemo(() => {
    const map = new Map<number, number>();
    if (isOwn && gameProfile?.team) {
      for (const m of gameProfile.team) {
        const sid = typeof m.code === "string" ? parseInt(m.code, 10) : Number(m.code);
        const form = typeof m.form === "string" ? parseInt(m.form, 10) : (m.form ?? 0);
        if (Number.isFinite(sid) && sid > 0) map.set(sid, form);
      }
    }
    return map;
  }, [isOwn, gameProfile?.team]);

  const getSprite = (speciesName: string, speciesId?: number, form?: number, shiny?: boolean, altShiny?: boolean): string[] => {
    const urls: string[] = [];
    const sid = resolveSpeciesId(speciesName, speciesId);
    if (sid > 0) {
      const f = profileFormMap.get(sid) ?? (typeof form === "number" && form > 0 ? form : 0);
      if (altShiny) {
        const aUrl = vdSprites[`${sid}_${f}_a`];
        if (aUrl) urls.push(aUrl);
      }
      if (shiny) {
        const sUrl = vdSprites[`${sid}_${f}_s`];
        if (sUrl) urls.push(sUrl);
      }
      const nUrl = vdSprites[`${sid}_${f}_n`];
      if (nUrl) urls.push(nUrl);
    }
    // Fallback: local game files (same as home page)
    const root = lastSavePath ? rootFromSavePath(lastSavePath, installDir) : installDir;
    if (root) {
      const m = { code: speciesId ?? sid, form: form ?? 0, speciesName };
      const { list } = monIconCandidates(root, m);
      urls.push(...list);
    }
    return urls;
  };

  const hpPct = (hp: number, max: number) => max > 0 ? Math.round((hp / max) * 100) : 0;
  const hpColor = (pct: number) => pct > 50 ? "#4ade80" : pct > 20 ? "#facc15" : "#ef4444";

  const formatPlayTime = (frames?: number) => {
    if (!frames) return "0h";
    const s = Math.floor(frames / 60);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
  };

  return (
    <div className="pnw-chat-profile-overlay" onClick={onClose}>
      <div className="pnw-chat-profile-card" onClick={(e) => e.stopPropagation()}>
        {/* Banner */}
        <div className="pnw-chat-profile-banner">
          {target.banner_url && <img src={target.banner_url} alt="" className="pnw-chat-profile-banner-img" />}
        </div>

        {/* Avatar */}
        <div className="pnw-chat-profile-avatar-wrap" style={roleGlow(target.roles)}>
          {target.avatar_url ? (
            <img src={target.avatar_url} alt="" className="pnw-chat-profile-avatar" />
          ) : (
            <div className="pnw-chat-profile-avatar pnw-chat-profile-avatar--placeholder">
              {displayName(target)[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Close button */}
        <button className="pnw-chat-profile-close" onClick={onClose}><FaXmark /></button>

        {/* Mod action buttons (top right, icon-only) */}
        {(() => {
          const targetRoles = target.roles || [];
          const targetIsAdmin = targetRoles.includes("admin");
          const targetIsMod = targetRoles.includes("moderator");
          const iAmAdmin = myRoles.includes("admin");
          const canModerate = isMod && !isOwn && !targetIsAdmin && (iAmAdmin || !targetIsMod);
          if (!canModerate) return null;
          return (
            <div className="pnw-chat-profile-mod-btns">
              <button className="pnw-chat-profile-mod-btn pnw-chat-profile-mod-btn--mute" onClick={targetMute ? onUnmute : onMute} title={targetMute ? "Démuter" : "Mute"}>
                <FaVolumeXmark />
              </button>
              <button className="pnw-chat-profile-mod-btn pnw-chat-profile-mod-btn--ban" onClick={onBan} title="Bannir">
                <FaBan />
              </button>
            </div>
          );
        })()}

        {/* Friend button (top right, under close) */}
        {!isOwn && (
          friendship === undefined ? null : friendship === null ? (
            <button className="pnw-chat-profile-friend-btn" onClick={onAddFriend} title="Ajouter en ami">
              <FaUserPlus />
            </button>
          ) : friendship.status === "pending" && friendship.friend_id === target.id ? (
            <button className="pnw-chat-profile-friend-btn pnw-chat-profile-friend-btn--pending" onClick={onRemoveFriend} title="Annuler la demande">
              <FaClock />
            </button>
          ) : friendship.status === "pending" ? (
            <button className="pnw-chat-profile-friend-btn pnw-chat-profile-friend-btn--accept" onClick={onAcceptFriend} title="Accepter la demande">
              <FaUserCheck />
            </button>
          ) : (
            <button className="pnw-chat-profile-friend-btn pnw-chat-profile-friend-btn--added" onClick={onRemoveFriend} title="Retirer des amis">
              <FaUserXmark />
            </button>
          )
        )}

        {/* Info */}
        <div className="pnw-chat-profile-body">
          <h3 className="pnw-chat-profile-name" style={nameColor ? { color: nameColor } : undefined}>
            {displayName(target)}
          </h3>
          <RoleBadges roles={target.roles} />

          {target.bio && (
            <p className="pnw-chat-profile-bio">{target.bio}</p>
          )}

          <div className="pnw-chat-profile-meta">
            <div className="pnw-chat-profile-meta-row">
              <FaDiscord />
              <span>{target.username}</span>
            </div>
            <div className="pnw-chat-profile-meta-row">
              <FaCalendar />
              <span>Membre depuis le {joinDate}</span>
            </div>
          </div>

          {/* Game state — shown when player is in-game */}
          {/* Lightweight status for other players (no full gameState) */}
          {!gameState && liveStatus?.gameActive && (
            <div className="pnw-profile-game">
              <div className="pnw-profile-game-header">
                <span className="pnw-profile-game-live-dot" />
                <span>En jeu</span>
                {liveStatus.mapName && <span className="pnw-profile-game-location"><FaMapLocationDot /> {liveStatus.mapName}</span>}
              </div>
              {liveStatus.inBattle && (
                <div className="pnw-profile-game-battle">
                  <div className="pnw-profile-game-battle-label"><FaBolt /> <span>En combat...</span></div>
                </div>
              )}
            </div>
          )}
          {gameState && (() => {
            return (
            <div className="pnw-profile-game">
              <div className="pnw-profile-game-header">
                <span className="pnw-profile-game-live-dot" />
                <span>En jeu</span>
                {gameState.map_name && <span className="pnw-profile-game-location"><FaMapLocationDot /> {gameState.map_name}</span>}
                <button
                  className="pnw-profile-game-share-btn"
                  title="Partager l'activité"
                  onClick={() => {
                    const party = gameState.party?.map((pk, idx) => {
                      const tm = isOwn && gameProfile?.team?.[idx] ? gameProfile.team[idx] : null;
                      const sid = pk.species_id ?? resolveSpeciesId(pk.species, pk.species_id);
                      const tmSid = tm ? (typeof tm.code === "string" ? parseInt(tm.code, 10) : Number(tm.code)) : 0;
                      const form = tm ? (typeof tm.form === "string" ? parseInt(tm.form, 10) : (tm.form ?? 0)) : (pk.form ?? 0);
                      return {
                        species: pk.species,
                        speciesId: tmSid || sid,
                        level: pk.level,
                        form,
                        shiny: pk.shiny,
                        altShiny: pk.alt_shiny || tm?.isAltShiny || false,
                        nickname: tm?.nickname || (pk.name !== pk.species ? pk.name : null),
                        gender: tm?.gender ?? pk.gender,
                        nature: tm?.nature ?? pk.nature,
                        ability: pk.ability ?? tm?.ability,
                        itemHolding: tm?.itemHolding ?? pk.item,
                        exp: tm?.exp ?? pk.exp,
                        moves: tm?.moves ?? pk.moves,
                        ivHp: tm?.ivHp ?? pk.iv_hp,
                        ivAtk: tm?.ivAtk ?? pk.iv_atk,
                        ivDfe: tm?.ivDfe ?? pk.iv_dfe,
                        ivSpd: tm?.ivSpd ?? pk.iv_spd,
                        ivAts: tm?.ivAts ?? pk.iv_ats,
                        ivDfs: tm?.ivDfs ?? pk.iv_dfs,
                      };
                    }) || [];
                    onShareActivity({
                      targetUserId: target.id,
                      targetName: displayName(target),
                      targetAvatar: target.avatar_url,
                      mapName: gameState.map_name || "",
                      inBattle: !!gameState.in_battle,
                      party,
                      battleAlly: gameState.battle_ally ? (() => {
                        const ally = gameState.battle_ally!;
                        const allyPk = gameState.party?.find((p) => p.species === ally.species);
                        return { species: ally.species, speciesId: resolveSpeciesId(ally.species, ally.species_id), level: ally.level, shiny: !!ally.shiny, altShiny: !!ally.alt_shiny, hp: ally.hp ?? allyPk?.hp, max_hp: ally.max_hp ?? allyPk?.max_hp };
                      })() : null,
                      battleFoes: gameState.battle_foes?.map((f) => ({ species: f.species, speciesId: resolveSpeciesId(f.species, f.species_id), level: f.level, shiny: !!f.shiny, altShiny: !!f.alt_shiny, hp: f.hp, max_hp: f.max_hp })) || [],
                      timestamp: Date.now(),
                    });
                  }}
                >
                  <FaShareNodes />
                </button>
              </div>
              <div className="pnw-profile-game-stats">
                <div className="pnw-profile-game-stat"><FaMedal /> <span>{gameState.badge_count || 0} boss</span></div>
                <div className="pnw-profile-game-stat"><FaCoins /> <span>{(gameState.money || 0).toLocaleString("fr-FR")} ¥</span></div>
                <div className="pnw-profile-game-stat"><FaClock /> <span>{formatPlayTime(gameState.play_time)}</span></div>
              </div>
              {gameState.party && gameState.party.length > 0 && (
                <div className="pnw-profile-game-party">
                  {gameState.party.map((pk, i) => {
                    // Priorité : données du jeu en cours (game_state.json), fallback save parsée
                    const isAltShiny = !!pk.alt_shiny;
                    const sprites = getSprite(pk.species, pk.species_id, pk.form, pk.shiny, isAltShiny);
                    const pct = hpPct(pk.hp, pk.max_hp);
                    const sid = resolveSpeciesId(pk.species, pk.species_id);
                    const speciesName = psdkNames.species && sid > 0 ? psdkNames.species[sid] ?? pk.species : pk.species;
                    return (
                      <div
                        key={i}
                        className={`team-mon-card group${pk.hp === 0 ? " pnw-profile-game-poke--ko" : ""}${hoveredPoke === i ? " team-mon-card--active" : ""}`}
                        onMouseEnter={(e) => { setHoveredPoke(i); setHoveredRect(e.currentTarget.getBoundingClientRect()); }}
                        onMouseLeave={() => setHoveredPoke((prev) => prev === i ? null : prev)}
                      >
                        {isAltShiny && <FaStar className="team-mon-alt-shiny-star" title="Shiny Alt" />}
                        {pk.shiny && !isAltShiny && <FaStar className="team-mon-shiny-star" title="Shiny" />}
                        <div className="team-mon-sprite-wrap">
                          {sprites.length > 0 ? <SpriteImg srcs={sprites} alt={pk.species} className="team-mon-sprite" /> : <span>{pk.species?.[0] || "?"}</span>}
                        </div>
                        <div className="team-mon-name" title={speciesName}>{speciesName}</div>
                        <div className="team-mon-level">Nv. {pk.level}</div>
                        <div className="pnw-profile-game-poke-hpbar" style={{ marginTop: 2 }}>
                          <div className="pnw-profile-game-poke-hpbar-fill" style={{ width: `${pct}%`, background: hpColor(pct) }} />
                        </div>
                        <span className="pnw-profile-game-poke-hptxt">{pk.hp}/{pk.max_hp}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Portal overlay for hovered Pokémon — renders above everything */}
              {hoveredPoke != null && hoveredRect && gameState?.party?.[hoveredPoke] && createPortal((() => {
                const pk = gameState.party[hoveredPoke];
                const hovAltShiny = !!pk.alt_shiny;
                const sprites = getSprite(pk.species, pk.species_id, pk.form, pk.shiny, hovAltShiny);
                const sid = resolveSpeciesId(pk.species, pk.species_id);
                const speciesName = psdkNames.species && sid > 0 ? psdkNames.species[sid] ?? pk.species : pk.species;
                const nickname = pk.name !== pk.species ? pk.name : null;
                const label = nickname ? (speciesName ? `${nickname} (${speciesName})` : nickname) : speciesName;
                const gender = pk.gender;
                const rawNature = pk.nature;
                const nature = Array.isArray(rawNature) ? rawNature[0] : rawNature;
                const ability = pk.ability;
                const abilityName = (pk as any).ability_name || (ability != null && ability > 0 ? psdkNames.abilities?.[ability] : null) || null;
                const itemHolding = pk.item;
                const exp = pk.exp;
                const moves = pk.moves;
                const ivHp = pk.iv_hp;
                const ivAtk = pk.iv_atk;
                const ivDfe = pk.iv_dfe;
                const ivSpd = pk.iv_spd;
                const ivAts = pk.iv_ats;
                const ivDfs = pk.iv_dfs;
                const hasIvs = ivHp != null;
                const ivRows = hasIvs ? [
                  { Icon: FaHeart, label: "PS", v: ivHp!, fill: "team-iv-fill--hp" },
                  { Icon: FaHandFist, label: "Atk", v: ivAtk!, fill: "team-iv-fill--atk" },
                  { Icon: FaShield, label: "Déf", v: ivDfe!, fill: "team-iv-fill--def" },
                  { Icon: FaBolt, label: "Vit", v: ivSpd!, fill: "team-iv-fill--spe" },
                  { Icon: FaWandMagicSparkles, label: "Sp.A", v: ivAts!, fill: "team-iv-fill--spa" },
                  { Icon: FaShieldHalved, label: "Sp.D", v: ivDfs!, fill: "team-iv-fill--spd" },
                ] : null;
                const ivTotal = ivRows ? ivRows.reduce((s, r) => s + r.v, 0) : 0;
                // Position above the hovered card, clamped to viewport
                const ow = 180;
                let left = hoveredRect.left + hoveredRect.width / 2 - ow / 2;
                left = Math.max(8, Math.min(left, window.innerWidth - ow - 8));
                let top = hoveredRect.top - 8;
                return (
                  <div className="team-mon-iv-overlay team-mon-iv-overlay--portal" style={{ left, bottom: window.innerHeight - top }}>
                    <div className="team-iv-sprite-wrap" style={{ margin: "0 auto 0.3rem" }}>
                      {sprites.length > 0 && <SpriteImg srcs={sprites} className="team-iv-sprite" />}
                      {hovAltShiny ? <FaStar className="team-iv-alt-shiny-star" /> : pk.shiny ? <FaStar className="team-iv-shiny-star" /> : null}
                    </div>
                    {label && <div className="team-iv-nickname">{label}</div>}
                    <div className="team-ov-chips">
                      <div className="team-ov-chip team-ov-chip--level">
                        <FaChartLine className="team-ov-chip-ico team-ov-chip-ico--level" aria-hidden />
                        <span className="team-ov-chip-val">{pk.level}</span>
                      </div>
                      {gender != null && (
                        <div className={`team-ov-chip team-ov-chip--gender${gender}`}>
                          {gender === 0 ? <FaMars className="team-ov-chip-ico team-ov-chip-ico--male" /> :
                           gender === 1 ? <FaVenus className="team-ov-chip-ico team-ov-chip-ico--female" /> :
                           <FaVenusMars className="team-ov-chip-ico team-ov-chip-ico--neutral" />}
                          <span className="team-ov-chip-val">{gender === 0 ? "♂" : gender === 1 ? "♀" : "—"}</span>
                        </div>
                      )}
                      {nature != null && (
                        <div className="team-ov-chip team-ov-chip--nature">
                          <FaLeaf className="team-ov-chip-ico team-ov-chip-ico--nature" aria-hidden />
                          <span className="team-ov-chip-val">{NATURE_FR[nature] ?? `#${nature}`}</span>
                        </div>
                      )}
                    </div>
                    <div className="team-ov-details">
                      <div className="team-ov-detail">
                        <FaWandMagicSparkles className="team-ov-detail-ico team-ov-detail-ico--ability" aria-hidden />
                        <span className="team-ov-detail-label">Talent</span>
                        <span className="team-ov-detail-val">{abilityName || "Aucun"}</span>
                      </div>
                      <div className="team-ov-detail">
                        <FaBagShopping className="team-ov-detail-ico team-ov-detail-ico--item" aria-hidden />
                        <span className="team-ov-detail-label">Objet</span>
                        <span className="team-ov-detail-val">{itemHolding != null && itemHolding > 0 ? (psdkNames.items?.[itemHolding] ?? `#${itemHolding}`) : "Aucun"}</span>
                      </div>
                      {exp != null && exp > 0 && (
                        <div className="team-ov-detail">
                          <FaChartLine className="team-ov-detail-ico team-ov-detail-ico--exp" aria-hidden />
                          <span className="team-ov-detail-label">EXP</span>
                          <span className="team-ov-detail-val">{exp.toLocaleString("fr-FR")}</span>
                        </div>
                      )}
                    </div>
                    {moves && moves.length > 0 && (
                      <div className="team-ov-moves">
                        <div className="team-ov-moves-head">
                          <FaLayerGroup className="team-ov-moves-ico" aria-hidden />
                          <span>Attaques</span>
                        </div>
                        <div className="team-ov-moves-list">
                          {moves.map((id, mi) => (
                            <span key={`${id}-${mi}`} className="team-ov-move-chip">{psdkNames.skills?.[id] ?? `#${id}`}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ivRows && (<>
                      <div className="team-iv-head">
                        <FaChartPie className="team-iv-head-ico" aria-hidden />
                        <span className="team-iv-head-title">IV</span>
                        <span className="team-iv-total">
                          <FaDna className="team-iv-total-ico" aria-hidden />
                          Σ {ivTotal}<span className="team-iv-total-max">/186</span>
                        </span>
                      </div>
                      <div className="team-iv-rows">
                        {ivRows.map(({ Icon, label: l, v, fill }) => (
                          <div key={l} className="team-iv-row">
                            <div className="team-iv-meta"><Icon className="team-iv-stat-ico" aria-hidden /><span className="team-iv-lab">{l}</span></div>
                            <div className="team-iv-bar-track" aria-hidden><div className={`team-iv-bar-fill ${fill}`} style={{ width: `${Math.min(100, (v / 31) * 100)}%` }} /></div>
                            <span className="team-iv-val">{v}</span>
                          </div>
                        ))}
                      </div>
                    </>)}
                  </div>
                );
              })(), document.body)}
              {gameState.in_battle && gameState.battle_ally && gameState.battle_foes?.length ? (
                <div className="pnw-profile-game-battle">
                  <div className="pnw-profile-game-battle-label">
                    <FaBolt />
                    <span>{gameState.is_trainer_battle && gameState.trainer_battle_names?.length ? `vs ${gameState.trainer_battle_names.join(" & ")}` : "Combat sauvage"}</span>
                    {gameState.battle_turn ? <span className="pnw-profile-game-battle-turn">Tour {gameState.battle_turn}</span> : null}
                  </div>
                  <div className="pnw-profile-game-battle-arena">
                    {(() => {
                      const ally = gameState.battle_ally;
                      const ss = getSprite(ally.species, ally.species_id, undefined, ally.shiny, ally.alt_shiny);
                      // Fallback: get ally HP from party if not in battle_ally data
                      const partyMatch = (ally.hp == null && gameState.party) ? gameState.party.find((p) => p.species === ally.species) : null;
                      const allyHp = ally.hp ?? partyMatch?.hp;
                      const allyMaxHp = ally.max_hp ?? partyMatch?.max_hp;
                      const allyPct = allyHp != null && allyMaxHp ? hpPct(allyHp, allyMaxHp) : null;
                      return (
                        <div className="pnw-profile-game-battle-side pnw-profile-game-battle-side--ally">
                          {ss.length > 0 ? <SpriteImg srcs={ss} className="pnw-profile-game-battle-sprite" /> : <div className="pnw-profile-game-battle-sprite-ph">{ally.species?.[0]}</div>}
                          <span className="pnw-profile-game-battle-name">{ally.species}{ally.alt_shiny && <FaStar style={{ fontSize: 7, color: "#c084fc", marginLeft: 2 }} />}{ally.shiny && !ally.alt_shiny && <FaStar style={{ fontSize: 7, color: "#f1c40f", marginLeft: 2 }} />}</span>
                          <span className="pnw-profile-game-battle-lvl">Nv.{ally.level}</span>
                          {allyPct != null && (<><div className="pnw-profile-game-poke-hpbar"><div className="pnw-profile-game-poke-hpbar-fill" style={{ width: `${allyPct}%`, background: hpColor(allyPct) }} /></div><span className="pnw-profile-game-poke-hptxt">{allyHp}/{allyMaxHp}</span></>)}
                        </div>
                      );
                    })()}
                    <div className="pnw-profile-game-battle-vs">VS</div>
                    {gameState.battle_foes.map((f, fi) => {
                      const foePct = hpPct(f.hp, f.max_hp);
                      return (
                        <div key={fi} className="pnw-profile-game-battle-side pnw-profile-game-battle-side--foe">
                          {(() => { const ss = getSprite(f.species, f.species_id, f.form, f.shiny, f.alt_shiny); return ss.length > 0 ? <SpriteImg srcs={ss} className="pnw-profile-game-battle-sprite" /> : <div className="pnw-profile-game-battle-sprite-ph">{f.species?.[0]}</div>; })()}
                          <span className="pnw-profile-game-battle-name">{f.species}{f.alt_shiny && <FaStar style={{ fontSize: 7, color: "#c084fc", marginLeft: 2 }} />}{f.shiny && !f.alt_shiny && <FaStar style={{ fontSize: 7, color: "#f1c40f", marginLeft: 2 }} />}</span>
                          <span className="pnw-profile-game-battle-lvl">Nv.{f.level}</span>
                          <div className="pnw-profile-game-poke-hpbar"><div className="pnw-profile-game-poke-hpbar-fill" style={{ width: `${foePct}%`, background: hpColor(foePct) }} /></div>
                          <span className="pnw-profile-game-poke-hptxt">{f.hp}/{f.max_hp}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : gameState.in_battle ? (
                <div className="pnw-profile-game-battle"><div className="pnw-profile-game-battle-label"><FaBolt /> <span>En combat...</span></div></div>
              ) : null}
            </div>
            );
          })()}

          {/* Mute status (visible to mods) */}
          {isMod && targetMute && (
            <div className="pnw-chat-profile-mute-info">
              <FaVolumeXmark />
              <div>
                <span className="pnw-chat-profile-mute-label">Muté</span>
                {targetMute.expires_at ? (
                  <span className="pnw-chat-profile-mute-until">
                    jusqu'au {new Date(targetMute.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : (
                  <span className="pnw-chat-profile-mute-until">définitivement</span>
                )}
                {targetMute.reason && (
                  <span className="pnw-chat-profile-mute-reason">Raison : {targetMute.reason}</span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pnw-chat-profile-actions">
            {isOwn ? (
              <button className="pnw-chat-profile-btn pnw-chat-profile-btn--edit" onClick={onEdit}>
                <FaPen /> Modifier le profil
              </button>
            ) : (
              <>
                <button className="pnw-chat-profile-btn pnw-chat-profile-btn--dm" onClick={onSendDm}>
                  <FaEnvelope /> Message
                </button>
                <button
                  className={`pnw-chat-profile-btn ${isBlocked ? "pnw-chat-profile-btn--unblock" : "pnw-chat-profile-btn--block"}`}
                  onClick={isBlocked ? onUnblock : onBlock}
                >
                  <FaBan /> {isBlocked ? "Débloquer" : "Bloquer"}
                </button>
              </>
            )}
          </div>
          {canTrade && onProposeTrade && (
            <button className="pnw-trade-profile-btn" onClick={() => { onProposeTrade(); onClose(); }}>
              <FaArrowRightArrowLeft /> Proposer un échange
            </button>
          )}
          {canBattle && onProposeBattle && (
            <button className="pnw-trade-profile-btn" style={{ background: "linear-gradient(135deg, rgba(220,50,50,.85), rgba(180,30,80,.85))" }} onClick={() => {
              if (sessionStorage.getItem("pnw_battle_unlocked") === "1") { onProposeBattle(); onClose(); return; }
              const code = prompt("Code d'acces :");
              if (code === "1964") { sessionStorage.setItem("pnw_battle_unlocked", "1"); onProposeBattle(); onClose(); }
              else if (code !== null) alert("Code incorrect.");
            }}>
              <FaGamepad /> Défier en combat
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

/* ==================== EditProfile modal ==================== */

function EditProfile({
  profile,
  onClose,
  onSaved,
}: {
  profile: ChatProfile;
  onClose: () => void;
  onSaved: (updated: ChatProfile) => void;
}) {
  const [name, setName] = useState(profile.display_name || profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar_url);
  const [bannerPreview, setBannerPreview] = useState(profile.banner_url);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const fields: Partial<ChatProfile> = {};

    if (name.trim() && name.trim() !== (profile.display_name || profile.username)) {
      fields.display_name = name.trim();
    }
    if (bio !== (profile.bio || "")) {
      fields.bio = bio;
    }

    // Avatar & Banner: URL only
    if (avatarUrl.trim()) {
      fields.avatar_url = avatarUrl.trim();
    }
    if (bannerUrl.trim()) {
      fields.banner_url = bannerUrl.trim();
    }

    if (Object.keys(fields).length > 0) {
      await updateChatProfile(profile.id, fields);
    }

    const updated = { ...profile, ...fields, display_name: fields.display_name ?? profile.display_name };
    setSaving(false);
    onSaved(updated);
  }

  return (
    <div className="pnw-chat-profile-overlay" onClick={onClose}>
      <div className="pnw-chat-profile-card pnw-chat-profile-card--edit" onClick={(e) => e.stopPropagation()}>
        {/* Banner preview */}
        <div
          className={`pnw-chat-profile-banner pnw-chat-profile-banner--edit${bannerPreview ? " pnw-chat-profile-banner--has-img" : ""}`}
          style={bannerPreview ? { backgroundImage: `url(${bannerPreview})` } : undefined}
        />

        {/* Avatar preview */}
        <div className="pnw-chat-profile-avatar-wrap">
          {avatarPreview ? (
            <img src={avatarPreview} alt="" className="pnw-chat-profile-avatar" />
          ) : (
            <div className="pnw-chat-profile-avatar pnw-chat-profile-avatar--placeholder">
              {name[0]?.toUpperCase() || "?"}
            </div>
          )}
        </div>

        <button className="pnw-chat-profile-close" onClick={onClose}><FaXmark /></button>

        {/* Edit form */}
        <div className="pnw-chat-profile-body">
          <label className="pnw-chat-edit-label">
            <span className="pnw-chat-edit-label-text"><FaAt /> Pseudo</span>
            <input
              className="pnw-chat-edit-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="Ton pseudo chat"
            />
          </label>

          <label className="pnw-chat-edit-label">
            <span className="pnw-chat-edit-label-text"><FaQuoteLeft /> Bio</span>
            <textarea
              className="pnw-chat-edit-textarea"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              placeholder="Décris-toi en quelques mots…"
              rows={3}
            />
            <span className={`pnw-chat-edit-count${bio.length >= 180 ? " pnw-chat-edit-count--danger" : bio.length >= 150 ? " pnw-chat-edit-count--warn" : ""}`}>{bio.length}/200</span>
          </label>

          {/* Avatar URL */}
          <label className="pnw-chat-edit-label">
            <span className="pnw-chat-edit-label-text"><FaCamera /> Avatar</span>
            <input
              className="pnw-chat-edit-input"
              value={avatarUrl}
              onChange={(e) => { setAvatarUrl(e.target.value); if (e.target.value.trim()) setAvatarPreview(e.target.value.trim()); }}
              placeholder="https://exemple.com/avatar.png"
            />
          </label>

          {/* Banner URL */}
          <label className="pnw-chat-edit-label">
            <span className="pnw-chat-edit-label-text"><FaImage /> Bannière</span>
            <input
              className="pnw-chat-edit-input"
              value={bannerUrl}
              onChange={(e) => { setBannerUrl(e.target.value); if (e.target.value.trim()) setBannerPreview(e.target.value.trim()); }}
              placeholder="https://exemple.com/banniere.png"
            />
          </label>

          <div className="pnw-chat-profile-actions">
            <button className="pnw-chat-profile-btn pnw-chat-profile-btn--cancel" onClick={onClose}>
              Annuler
            </button>
            <button className="pnw-chat-profile-btn pnw-chat-profile-btn--save" onClick={handleSave} disabled={saving}>
              {saving ? <FaSpinner className="pnw-chat-spinner" /> : <FaFloppyDisk />}
              {saving ? "Sauvegarde…" : "Sauvegarder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== Slash Commands ==================== */

interface SlashCommand {
  name: string;
  description: string;
  icon: React.ReactNode;
  roles: string[];  // required roles (empty = everyone)
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "slowmode",
    description: "Active/désactive le mode lent (15s entre chaque message)",
    icon: <FaGaugeHigh />,
    roles: ["admin"],
  },
  {
    name: "clear",
    description: "Supprimer des messages du channel",
    icon: <FaTrashCan />,
    roles: ["admin"],
  },
];

function SlashCommandPicker({
  filter,
  userRoles,
  selectedIndex,
  onSelect,
}: {
  filter: string;
  userRoles: string[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}) {
  const available = SLASH_COMMANDS.filter((cmd) => {
    // Check permissions
    if (cmd.roles.length && !cmd.roles.some((r) => userRoles.includes(r))) return false;
    // Check filter
    if (filter && !cmd.name.startsWith(filter)) return false;
    return true;
  });

  if (!available.length) return null;

  return (
    <div className="pnw-slash-picker">
      <div className="pnw-slash-picker-header">
        <FaSlash /> Commandes
      </div>
      {available.map((cmd, i) => (
        <button
          key={cmd.name}
          className={`pnw-slash-cmd ${i === selectedIndex ? "pnw-slash-cmd--active" : ""}`}
          onClick={() => onSelect(cmd)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="pnw-slash-cmd-icon">{cmd.icon}</span>
          <div className="pnw-slash-cmd-info">
            <span className="pnw-slash-cmd-name">/{cmd.name}</span>
            <span className="pnw-slash-cmd-desc">{cmd.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ==================== Mention picker ==================== */

function MentionPicker({
  members,
  filter,
  selectedIndex,
  onSelect,
}: {
  members: ChatProfile[];
  filter: string;
  selectedIndex: number;
  onSelect: (member: ChatProfile) => void;
}) {
  const filtered = members.filter((m) => {
    const name = (m.display_name || m.username || "").toLowerCase();
    return name.includes(filter.toLowerCase());
  }).slice(0, 10);

  if (!filtered.length) return null;

  return (
    <div className="pnw-mention-picker">
      <div className="pnw-mention-picker-header">
        <FaAt /> Mentionner un joueur
      </div>
      {filtered.map((m, i) => (
        <button
          key={m.id}
          className={`pnw-mention-item ${i === selectedIndex ? "pnw-mention-item--active" : ""}`}
          onClick={() => onSelect(m)}
          onMouseDown={(e) => e.preventDefault()}
        >
          {m.avatar_url ? (
            <img src={m.avatar_url} alt="" className="pnw-mention-item-avatar" />
          ) : (
            <div className="pnw-mention-item-avatar pnw-mention-item-avatar--placeholder">
              {(m.display_name || m.username || "?")[0]?.toUpperCase()}
            </div>
          )}
          <span className="pnw-mention-item-name">{m.display_name || m.username}</span>
          {m.display_name && m.username && m.display_name !== m.username && (
            <span className="pnw-mention-item-username">@{m.username}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ==================== Helpers for game-live sprite resolution ==================== */

const normForLiveMatch = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-\s]+/g, " ").trim();


/* ==================== Props ==================== */

interface ChatViewProps {
  siteUrl: string;
  onBack: () => void;
  onUnreadChange?: (count: number) => void;
  /** true quand le panel chat est visible (ouvert). */
  visible?: boolean;
  gtsSharePending?: import("../types").GtsShareData | null;
  onGtsShareDone?: () => void;
  onOpenGts?: (onlineId?: string | number) => void;
  gameProfile?: PlayerProfile | null;
  installDir: string;
  lastSavePath?: string | null;
  onProfileReload?: () => void;
  /** Quand true, affiche la vue Tour de Combat au lieu du chat. */
  battleMode?: boolean;
}

/* ==================== Main Component ==================== */

export default function ChatView({ siteUrl, onBack, onUnreadChange, visible = true, battleMode = false, gtsSharePending, onGtsShareDone, onOpenGts, gameProfile, installDir, lastSavePath, onProfileReload }: ChatViewProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // DM creation
  const [showNewDm, setShowNewDm] = useState(false);
  const [dmSearch, setDmSearch] = useState("");
  const [dmResults, setDmResults] = useState<ChatProfile[]>([]);

  // Pinned DMs (persisted in Supabase profiles.pinned_dms)
  const [pinnedDms, setPinnedDms] = useState<Set<number>>(new Set());
  const pinnedDmsLoaded = useRef(false);
  const togglePinDm = useCallback((chId: number) => {
    setPinnedDms((prev) => {
      const next = new Set(prev);
      if (next.has(chId)) next.delete(chId); else next.add(chId);
      const arr = [...next];
      if (session?.user?.id) {
        supabase.from("profiles").update({ pinned_dms: arr }).eq("id", session.user.id).then();
      }
      return next;
    });
  }, [session?.user?.id]);

  // Profile popup
  const [profilePopup, setProfilePopup] = useState<ChatProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  // Friends
  const [friendsList, setFriendsList] = useState<ChatFriend[]>([]);
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [profileFriendship, setProfileFriendship] = useState<ChatFriend | null | undefined>(undefined);

  // ─── P2P Trade state ───
  const [tradeState, setTradeState] = useState<TradeState>({ phase: "idle" });
  const tradeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameLiveRef2 = useRef<any>(null); // ref to game-live channel for trade broadcasts

  // ─���─ P2P Battle state ───
  const [battleState, setBattleState] = useState<BattleRoomState>({ phase: "idle" });
  const battleStateRef = useRef<BattleRoomState>({ phase: "idle" });
  const battleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battleRelayCleanupRef = useRef<(() => void) | null>(null);
  const battleResultRef = useRef<string>("");
  const [showTradeBoxes, setShowTradeBoxes] = useState(false);
  const [showTradeSwapAnim, setShowTradeSwapAnim] = useState(false);
  const [tradeSwapInfo, setTradeSwapInfo] = useState<{ mySpriteUrl: string | null; myName: string; myShiny: boolean; myAltShiny: boolean; theirSpriteUrl: string | null; theirName: string; theirShiny: boolean; theirAltShiny: boolean; boxName: string | null } | null>(null);
  const theirPokemonB64Ref = useRef<string | null>(null);
  const [tradeBytesReady, setTradeBytesReady] = useState(0); // incremented when both bytes available — triggers execution useEffect
  const tradeCompleteRef = useRef<{ myDone: boolean; theirDone: boolean; boxName: string | null }>({ myDone: false, theirDone: false, boxName: null });

  const clearTradeTimeout = useCallback(() => {
    if (tradeTimeoutRef.current) { clearTimeout(tradeTimeoutRef.current); tradeTimeoutRef.current = null; }
  }, []);

  const cancelTrade = useCallback((reason?: string) => {
    clearTradeTimeout();
    const st = tradeState;
    if (st.phase !== "idle" && st.phase !== "complete" && st.phase !== "error") {
      gameLiveRef2.current?.send({ type: "broadcast", event: "trade_cancel", payload: { tradeId: st.tradeId, userId: session?.user?.id } });
    }
    setTradeState(reason ? { phase: "error", tradeId: (st as any).tradeId ?? "", partnerId: (st as any).partnerId ?? "", partnerName: (st as any).partnerName ?? "", message: reason } : { phase: "idle" });
    setShowTradeBoxes(false);
    theirPokemonB64Ref.current = null;
  }, [tradeState, session?.user?.id, clearTradeTimeout]);

  // Keep battleStateRef in sync (pour que les listeners broadcast aient toujours la valeur courante)
  useEffect(() => { battleStateRef.current = battleState; }, [battleState]);

  // ─── P2P Battle helpers ───
  const clearBattleTimeout = useCallback(() => {
    if (battleTimeoutRef.current) { clearTimeout(battleTimeoutRef.current); battleTimeoutRef.current = null; }
  }, []);

  const cancelBattle = useCallback(async (reason?: string) => {
    clearBattleTimeout();
    const st = battleState;
    if (st.phase !== "idle" && st.phase !== "complete" && st.phase !== "error") {
      sendBattleCancel((st as any).roomCode, (st as any).partnerId, session?.user?.id || "");
    }
    await fullCleanup(battleRelayCleanupRef);
    setBattleState(reason ? { phase: "error", roomCode: (st as any).roomCode ?? "", partnerId: (st as any).partnerId ?? "", partnerName: (st as any).partnerName ?? "", message: reason } : { phase: "idle" });
  }, [battleState, session?.user?.id, clearBattleTimeout]);

  // Execute trade when both bytes are available — write save, then wait for partner
  useEffect(() => {
    if (tradeState.phase !== "executing") return;
    const theirB64 = theirPokemonB64Ref.current;
    if (import.meta.env.DEV) console.debug("[Trade Execute]", { phase: tradeState.phase, role: tradeState.role, hasTheirB64: !!theirB64, theirB64Len: theirB64?.length, lastSavePath, myDone: tradeCompleteRef.current.myDone });
    if (!theirB64 || !lastSavePath) return;
    if (!validateIncomingBytes(theirB64)) {
      cancelTrade("Données du Pokémon reçu invalides.");
      return;
    }
    const mySelection = tradeState.mySelection;
    if (!mySelection) return;
    // Prevent double execution
    if (tradeCompleteRef.current.myDone) return;
    tradeCompleteRef.current.myDone = true;

    (async () => {
      try {
        const theirPreview = tradeState.theirPreview;
        const { boxName, evolvedTo, evolvedForm } = await executeTradeLocally(lastSavePath, mySelection.boxIdx, mySelection.slotIdx, theirB64, theirPreview.speciesId, theirPreview.form, theirPreview.itemHolding, mySelection.speciesId);
        tradeCompleteRef.current.boxName = boxName;
        gameLiveRef2.current?.send({ type: "broadcast", event: "trade_complete", payload: { tradeId: tradeState.tradeId, userId: session?.user?.id } });
        // Insert trade completion message in DM (initiator only)
        const dmChId = (tradeState as any).dmChannelId;
        if (dmChId && session?.user?.id && tradeState.role === "initiator") {
          const msgData: TradeMessageData = {
            tradeId: tradeState.tradeId,
            playerA: { userId: session.user.id, name: profile?.display_name || profile?.username || "?", pokemon: { speciesId: mySelection.speciesId, name: mySelection.name, nickname: mySelection.nickname, level: mySelection.level, shiny: mySelection.shiny, altShiny: mySelection.altShiny, gender: mySelection.gender, nature: mySelection.nature, form: mySelection.form, ability: mySelection.ability, itemHolding: mySelection.itemHolding, moves: mySelection.moves, ivHp: mySelection.ivHp, ivAtk: mySelection.ivAtk, ivDfe: mySelection.ivDfe, ivSpd: mySelection.ivSpd, ivAts: mySelection.ivAts, ivDfs: mySelection.ivDfs } },
            playerB: { userId: tradeState.partnerId, name: tradeState.partnerName, pokemon: tradeState.theirPreview },
            timestamp: Date.now(),
          };
          await supabase.from("messages").insert({ channel_id: dmChId, user_id: session.user.id, content: buildTradeMessage(msgData) });
        }
        // Preload sprites while waiting for partner
        const loadSprite = async (speciesId: number, form: number, shiny: boolean, altShiny: boolean): Promise<string | null> => {
          const formArg = form > 0 ? form : null;
          if (altShiny) { try { const r = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: formArg }); if (r) return r; } catch {} }
          if (shiny) { try { const r = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: formArg }); if (r) return r; } catch {} }
          try { const r = await invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: formArg }); if (r) return r; } catch {}
          return null;
        };
        // Si le Pokémon reçu a évolué, charger le sprite de l'évolution
        const receivedSpeciesId = evolvedTo ?? tradeState.theirPreview.speciesId;
        const receivedName = evolvedTo && psdkNames.species && evolvedTo > 0
          ? (psdkNames.species[evolvedTo] ?? tradeState.theirPreview.name)
          : tradeState.theirPreview.name;
        const receivedForm = evolvedTo ? (evolvedForm ?? 0) : tradeState.theirPreview.form;
        const [mySpr, theirSpr] = await Promise.all([
          loadSprite(mySelection.speciesId, mySelection.form, mySelection.shiny, mySelection.altShiny),
          loadSprite(receivedSpeciesId, receivedForm, tradeState.theirPreview.shiny, tradeState.theirPreview.altShiny),
        ]);
        setTradeSwapInfo({
          mySpriteUrl: mySpr, myName: mySelection.name, myShiny: mySelection.shiny, myAltShiny: mySelection.altShiny,
          theirSpriteUrl: theirSpr, theirName: evolvedTo ? `${receivedName} ✨` : tradeState.theirPreview.name, theirShiny: tradeState.theirPreview.shiny, theirAltShiny: tradeState.theirPreview.altShiny,
          boxName,
        });
        // Check if partner also done — if yes, show animation now
        if (tradeCompleteRef.current.theirDone) {
          setShowTradeSwapAnim(true);
          clearTradeTimeout();
          setTradeState({ phase: "complete", tradeId: tradeState.tradeId, partnerId: tradeState.partnerId, partnerName: tradeState.partnerName });
          theirPokemonB64Ref.current = null;
          tradeCompleteRef.current = { myDone: false, theirDone: false, boxName: null };
          setTimeout(() => onProfileReload?.(), 500);
        }
        // Otherwise animation will be triggered by trade_complete handler
      } catch (err: any) {
        gameLiveRef2.current?.send({ type: "broadcast", event: "trade_error", payload: { tradeId: tradeState.tradeId, userId: session?.user?.id, message: err?.message || "Erreur" } });
        tradeCompleteRef.current = { myDone: false, theirDone: false, boxName: null };
        cancelTrade(err?.message || "Erreur lors de l'échange.");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeState.phase, lastSavePath, tradeBytesReady]);

  // Auto-start execution when both confirmed
  useEffect(() => {
    if (tradeState.phase !== "confirming") return;
    if (!tradeState.myConfirmed || !tradeState.theirConfirmed) return;
    // Both confirmed — initiator sends execute with bytes first
    if (tradeState.role === "initiator") {
      gameLiveRef2.current?.send({ type: "broadcast", event: "trade_execute", payload: { tradeId: tradeState.tradeId, userId: session?.user?.id, pokemonB64: tradeState.mySelection.pokemonB64 } });
      setTradeState((prev) => prev.phase === "confirming" ? { phase: "executing", role: prev.role, tradeId: prev.tradeId, partnerId: prev.partnerId, partnerName: prev.partnerName, partnerAvatar: prev.partnerAvatar, dmChannelId: prev.dmChannelId, mySelection: prev.mySelection, theirPreview: prev.theirPreview } : prev);
    }
    // Responder waits for trade_execute from initiator (handled in broadcast handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeState]);

  // Trade timeouts
  useEffect(() => {
    clearTradeTimeout();
    if (tradeState.phase === "pending") {
      tradeTimeoutRef.current = setTimeout(() => cancelTrade("Délai d'attente dépassé."), TRADE_PENDING_TIMEOUT);
    } else if (tradeState.phase === "selecting") {
      tradeTimeoutRef.current = setTimeout(() => cancelTrade("Délai de sélection dépassé."), TRADE_SELECTING_TIMEOUT);
    } else if (tradeState.phase === "confirming") {
      tradeTimeoutRef.current = setTimeout(() => cancelTrade("Délai de confirmation dépassé."), TRADE_CONFIRMING_TIMEOUT);
    } else if (tradeState.phase === "executing") {
      tradeTimeoutRef.current = setTimeout(() => cancelTrade("Délai d'exécution dépassé."), TRADE_EXECUTING_TIMEOUT);
    }
    return clearTradeTimeout;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeState.phase]);

  // Unread counts & mention/reply badge counts
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [mentionCounts, setMentionCounts] = useState<Record<number, number>>({});
  const activeChannelRef = useRef<ChatChannel | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const channelsRef = useRef<ChatChannel[]>([]);
  const profileRef = useRef<ChatProfile | null>(null);

  // Admin / Moderation
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMuteModal, setShowMuteModal] = useState<ChatProfile | null>(null);
  const [showBanModal, setShowBanModal] = useState<ChatProfile | null>(null);
  const [activeMute, setActiveMute] = useState<ChatMute | null>(null);
  const [activeBan, setActiveBan] = useState<ChatBan | null>(null);

  // Slash commands
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  // Mention picker
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  // Slowmode
  const [slowmodeActive, setSlowmodeActive] = useState(false);
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Members list
  const [allMembers, setAllMembers] = useState<ChatProfile[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [showMembers, setShowMembers] = useState(true);

  // Detect partner disconnect during trade (must be after onlineUserIds declaration)
  useEffect(() => {
    if (tradeState.phase === "idle" || tradeState.phase === "complete" || tradeState.phase === "error") return;
    const partnerId = (tradeState as any).partnerId;
    if (!partnerId) return;
    if (!onlineUserIds.has(partnerId)) {
      cancelTrade(`${(tradeState as any).partnerName} s'est déconnecté.`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineUserIds, tradeState.phase]);

  // Leaderboard
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [lbTab, setLbTab] = useState<"pokedex" | "shiny">("pokedex");
  const [lbLoading, setLbLoading] = useState(false);

  // Pinned messages
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(false);

  // Muted users map (user_id -> ChatMute)
  const [mutedUsersMap, setMutedUsersMap] = useState<Map<string, ChatMute>>(new Map());
  // Banned users set
  const [bannedUsersSet, setBannedUsersSet] = useState<Set<string>>(new Set());
  // Blocked users
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [blockedUsersMap, setBlockedUsersMap] = useState<Map<string, number>>(new Map()); // blocked_id → block.id
  const [revealedBlockedMsgs, setRevealedBlockedMsgs] = useState<Set<number>>(new Set());

  // Game Live Dashboard
  const [gameLivePlayers, setGameLivePlayers] = useState<Map<string, GameLivePlayer>>(new Map());
  const gameLiveRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTrackedState = useRef<string>("");
  const [glReconnect, setGlReconnect] = useState(0); // increment to force channel recreation
  const spriteCache = useRef<Map<string, string>>(new Map());

  const isMod = profile?.roles?.includes("admin") ?? false;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const lastReadMsgId = useRef<Record<number, number>>({}); // channelId → last read msg id
  const scrollPositions = useRef<Record<number, number>>({}); // channelId → scrollTop
  const [unreadSeparatorId, setUnreadSeparatorId] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<{ name: string; avatar?: string | null }[]>([]);
  const [deletingMsgIds, setDeletingMsgIds] = useState<Set<number>>(new Set());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<any>(null);

  // Edit & Reply state
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Image upload
  const [imagePreview, setImagePreview] = useState<{ file: File; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // DM background modal
  const [showDmBgModal, setShowDmBgModal] = useState(false);

  // Clear modal
  const [showClearModal, setShowClearModal] = useState(false);

  // GTS share modal
  const [showGtsShareModal, setShowGtsShareModal] = useState(false);
  const [activityShareData, setActivityShareData] = useState<GameActivityShareData | null>(null);

  // Pokémon picker
  const [showPokemonPicker, setShowPokemonPicker] = useState(false);
  const [pokedexEntries, setPokedexEntries] = useState<PokeEntry[]>([]);
  const [extradexEntries, setExtradexEntries] = useState<PokeEntry[]>([]);
  const [bstEntries, setBstEntries] = useState<any[]>([]);
  const [pokemonSearch, setPokemonSearch] = useState("");
  const [pokemonTab, setPokemonTab] = useState<"pokedex" | "extradex" | "bst">("pokedex");

  // PSDK name arrays for Pokemon detail overlays
  const [psdkNames, setPsdkNames] = useState<{ species: string[] | null; skills: string[] | null; abilities: string[] | null; items: string[] | null }>({ species: null, skills: null, abilities: null, items: null });
  useEffect(() => {
    Promise.all([
      invoke<string>("cmd_psdk_french_species_names").then((r) => JSON.parse(r) as string[]).catch(() => null),
      invoke<string>("cmd_psdk_french_skill_names").then((r) => JSON.parse(r) as string[]).catch(() => null),
      invoke<string>("cmd_psdk_french_ability_names").then((r) => JSON.parse(r) as string[]).catch(() => null),
      invoke<string>("cmd_psdk_french_item_names").then((r) => JSON.parse(r) as string[]).catch(() => null),
    ]).then(([species, skills, abilities, items]) => setPsdkNames({ species, skills, abilities, items }));
  }, []);

  // Notify parent of total unread count
  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    onUnreadChange?.(total);
  }, [unreadCounts]);

  /* ---------- Moderation log helper ---------- */

  async function sendLog(entry: LogEntry) {
    const logChannel = channelsRef.current.find((c) => c.type === "moderation" && c.name?.toLowerCase().includes("log"));
    if (!logChannel || !session) {
      console.warn("[PNW Chat] sendLog: no log channel or no session", { logChannel, session: !!session });
      return;
    }
    const { error } = await supabase.from("messages").insert({
      channel_id: logChannel.id,
      user_id: session.user.id,
      content: LOG_PREFIX + JSON.stringify(entry),
    });
    if (error) console.error("[PNW Chat] sendLog error:", error);
  }

  /* ---------- Auth ---------- */

  useEffect(() => {
    getSession().then((s) => {
      setSession(s);
      if (!s) setLoading(false); // Only stop loading if not logged in
    });
    const sub = onAuthStateChange((s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setChannels([]);
        setMessages([]);
        setActiveChannel(null);
      }
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    // Batch 1: critical data (profile + channels)
    Promise.all([
      getChatProfile(session.user.id),
      getActiveMute(session.user.id),
      getActiveBan(session.user.id),
    ]).then(([p, mute, ban]) => {
      setProfile(p); profileRef.current = p;
      setActiveMute(mute);
      setActiveBan(ban);
    });
    // Load pinned DMs
    if (!pinnedDmsLoaded.current) {
      supabase.from("profiles").select("pinned_dms").eq("id", session.user.id).single().then(({ data }) => {
        if (data?.pinned_dms && Array.isArray(data.pinned_dms)) {
          setPinnedDms(new Set(data.pinned_dms));
        }
        pinnedDmsLoaded.current = true;
      });
    }
    loadChannels();
  }, [session?.user?.id]);


  /* ---------- GTS share from external ---------- */

  useEffect(() => {
    if (gtsSharePending && session && channels.length) {
      setShowGtsShareModal(true);
    }
  }, [gtsSharePending, session, channels.length]);

  /* ---------- Leaderboard: auto-submit scores ---------- */

  useEffect(() => {
    if (session?.user?.id && gameProfile) {
      upsertLeaderboardScore(session.user.id, gameProfile);
    }
  }, [session?.user?.id, gameProfile]);

  /* ---------- Leaderboard: fetch on open ---------- */

  useEffect(() => {
    if (!showLeaderboard) return;
    setLbLoading(true);
    fetchLeaderboard().then((d) => { setLeaderboardData(d); setLbLoading(false); });
  }, [showLeaderboard]);

  /* ---------- Load Pokédex / Extradex / Fakemon entries ---------- */

  function loadPokedexData() {
    const base = siteUrl.replace(/\/$/, "");
    Promise.all([
      fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/extradex?t=${Date.now()}`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/bst?t=${Date.now()}`).then((r) => r.json()).catch(() => null),
    ]).then(([pokedexRes, extradexRes, bstRes]) => {
      if (pokedexRes?.success && Array.isArray(pokedexRes.pokedex?.entries)) setPokedexEntries(pokedexRes.pokedex.entries);
      if (extradexRes?.success && Array.isArray(extradexRes.extradex?.entries)) setExtradexEntries(extradexRes.extradex.entries);
      if (bstRes?.success && bstRes?.bst) {
        const all = [
          ...(Array.isArray(bstRes.bst.fakemon) ? bstRes.bst.fakemon : []),
          ...(Array.isArray(bstRes.bst.megas) ? bstRes.bst.megas : []),
          ...(Array.isArray(bstRes.bst.speciaux) ? bstRes.bst.speciaux : []),
        ];
        setBstEntries(all);
      }
    });
  }

  useEffect(() => { loadPokedexData(); }, [siteUrl]);

  /* ---------- Load channels ---------- */

  async function loadChannels() {
    // Load public channels AND DM memberships in PARALLEL
    const [pubRes, memRes] = await Promise.all([
      supabase.from("channels").select("*").in("type", ["public", "moderation"]).order("id"),
      supabase.from("channel_members").select("channel_id").eq("user_id", session!.user.id),
    ]);
    const publicChannels = (pubRes.data as ChatChannel[]) || [];

    let dmChannels: ChatChannel[] = [];
    if (memRes.data?.length) {
      const dmIds = memRes.data.map((m: any) => m.channel_id);
      const { data } = await supabase.from("channels").select("*").in("id", dmIds).eq("type", "dm");
      dmChannels = (data as ChatChannel[]) || [];
    }

    const merged = [...publicChannels, ...dmChannels];
    const all = Array.from(new Map(merged.map((c) => [c.id, c])).values());
    setChannels(all);
    channelsRef.current = all;
    setLoading(false);
    if (!activeChannel && all.length) setActiveChannel(all[0]);
  }

  /* ---------- Load messages for active channel ---------- */

  useEffect(() => {
    if (!activeChannel) return;
    let cancelled = false;

    // Vider les messages et charger les nouveaux
    setMessages([]);
    setLoadingMessages(true);
    setHasMoreMessages(true);

    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(*)")
        .eq("channel_id", activeChannel.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        const msgs = ((data as ChatMessage[]) || []).reverse();
        setMessages(msgs);
        setLoadingMessages(false);
        if ((data?.length || 0) < 50) setHasMoreMessages(false);
      }
    })();

    // Subscribe to realtime (INSERT + DELETE)
    const channel = supabase
      .channel(`messages:${activeChannel.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${activeChannel.id}` },
        (payload) => {
          if (cancelled) return;
          const newMsg = payload.new as ChatMessage;
          supabase
            .from("profiles")
            .select("*")
            .eq("id", newMsg.user_id)
            .single()
            .then(({ data }) => {
              if (cancelled) return;
              newMsg.profiles = data as ChatProfile;
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
            });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${activeChannel.id}` },
        (payload) => {
          if (cancelled) return;
          const updated = payload.new as ChatMessage;
          setMessages((prev) => prev.map((m) =>
            m.id === updated.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m
          ));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          if (cancelled) return;
          const old = payload.old as any;
          const deletedId = old?.id;
          if (deletedId) {
            setMessages((prev) => prev.filter((m) => m.id !== deletedId));
          }
        }
      )
      .subscribe();

    // Typing indicator channel
    setTypingUsers([]);
    const typingCh = supabase.channel(`typing-${activeChannel.id}`);
    typingCh.on("broadcast", { event: "typing" }, ({ payload }: any) => {
      if (payload.userId === session?.user?.id) return;
      const entry = { name: payload.name, avatar: payload.avatar };
      setTypingUsers((prev) => prev.some((u) => u.name === entry.name) ? prev : [...prev, entry]);
      // Auto-remove after 3s
      setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.name !== entry.name));
      }, 3000);
    });
    typingCh.subscribe();
    typingChannelRef.current = typingCh;

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      supabase.removeChannel(typingCh);
      typingChannelRef.current = null;
    };
  }, [activeChannel?.id]);


  /* ---------- Load older messages ---------- */

  async function loadOlderMessages() {
    if (!activeChannel || loadingOlder || !hasMoreMessages || !messages.length) return;
    setLoadingOlder(true);
    const oldestMsg = messages[0];
    const { data } = await supabase
      .from("messages")
      .select("*, profiles(*)")
      .eq("channel_id", activeChannel.id)
      .lt("created_at", oldestMsg.created_at)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data?.length) {
      const older = (data as ChatMessage[]).reverse();
      // Preserve scroll position
      const el = messagesContainerRef.current;
      const prevHeight = el?.scrollHeight || 0;
      setMessages((prev) => [...older, ...prev]);
      // Restore scroll position after render
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
      if (data.length < 50) setHasMoreMessages(false);
    } else {
      setHasMoreMessages(false);
    }
    setLoadingOlder(false);
  }

  /* ---------- Smart scroll ---------- */

  function checkIfAtBottom() {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior });
      setIsAtBottom(true);
      setHasNewMessages(false);
    }, 50);
  }

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom("smooth");
    } else {
      setHasNewMessages(true);
    }
  }, [messages]);

  // Reset scroll state on channel switch + restore scroll position
  useEffect(() => {
    setHasNewMessages(false);
    const chId = activeChannel?.id;
    if (!chId) return;
    const savedPos = scrollPositions.current[chId];
    if (savedPos !== undefined && savedPos > 0) {
      setIsAtBottom(false);
      setTimeout(() => {
        if (messagesContainerRef.current) messagesContainerRef.current.scrollTop = savedPos;
      }, 80);
    } else {
      setIsAtBottom(true);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 50);
    }
  }, [activeChannel?.id]);

  /* ---------- Slash command execution ---------- */

  async function executeSlashCommand(cmd: SlashCommand) {
    if (!activeChannel || !session) return;

    if (cmd.name === "clear") {
      setShowClearModal(true);
      setDraft("");
      setShowSlashPicker(false);
      return;
    }

    if (cmd.name === "slowmode") {
      const SLOWMODE_SECONDS = 15;
      const newVal = await toggleSlowmode(activeChannel.id, SLOWMODE_SECONDS);
      setSlowmodeActive(newVal > 0);
      // Update the channel locally
      setActiveChannel((prev) => prev ? { ...prev, slowmode_seconds: newVal } : prev);
      setChannels((prev) => prev.map((ch) =>
        ch.id === activeChannel.id ? { ...ch, slowmode_seconds: newVal } : ch
      ));
      // Post a system-like message in chat
      await supabase.from("messages").insert({
        channel_id: activeChannel.id,
        user_id: session.user.id,
        content: newVal > 0
          ? `⏱️ Mode lent activé (${newVal}s entre chaque message)`
          : "⏱️ Mode lent désactivé",
      });
    }

    setDraft("");
    setShowSlashPicker(false);
    inputRef.current?.focus();
  }

  /* ---------- Slowmode cooldown timer ---------- */

  function startSlowmodeCooldown() {
    const seconds = activeChannel?.slowmode_seconds || 15;
    setSlowmodeCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setSlowmodeCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); };
  }, []);

  // Sync slowmode state when activeChannel changes
  useEffect(() => {
    if (activeChannel) {
      setSlowmodeActive((activeChannel.slowmode_seconds || 0) > 0);
    }
  }, [activeChannel?.slowmode_seconds]);

  /* ---------- Load all members + Presence ---------- */

  useEffect(() => {
    if (!session) return;

    // Batch 2: secondary data (members, mod lists, friends, blocks)
    Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      getMutedUserIds(),
      getBannedUserIds(),
      getFriends(session.user.id),
      getBlockedUsers(session.user.id),
    ]).then(([profilesRes, mutedMap, bannedSet, friends, blocks]) => {
      if (profilesRes.data) setAllMembers(profilesRes.data as ChatProfile[]);
      setMutedUsersMap(mutedMap);
      setBannedUsersSet(bannedSet);
      setFriendsList(friends);
      setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
      setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
    });

    // Listen for friend requests & profiles
    const notifChannel = supabase
      .channel(`notif-misc-${Date.now()}`)
      // Listen for friend requests (inserts on friends table)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "friends" }, (payload) => {
        const f = payload.new as any;
        if (f.friend_id === session.user.id) {
          // Someone sent us a friend request — refresh
          getFriends(session.user.id).then(setFriendsList);
          // Play notification
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 600;
            osc.type = "sine";
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.2);
            setTimeout(() => {
              const osc2 = ctx.createOscillator();
              const gain2 = ctx.createGain();
              osc2.connect(gain2);
              gain2.connect(ctx.destination);
              osc2.frequency.value = 900;
              osc2.type = "sine";
              gain2.gain.setValueAtTime(0.1, ctx.currentTime);
              gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
              osc2.start(ctx.currentTime);
              osc2.stop(ctx.currentTime + 0.2);
            }, 150);
          } catch {}
        }
      })
      // Listen for friend request updates (accepted)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "friends" }, () => {
        getFriends(session.user.id).then(setFriendsList);
      })
      // Listen for friend removals
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "friends" }, () => {
        getFriends(session.user.id).then(setFriendsList);
      })
      // Listen for new profiles (new players joining)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (payload) => {
        const newProfile = payload.new as ChatProfile;
        setAllMembers((prev) => {
          if (prev.some((m) => m.id === newProfile.id)) return prev;
          return [...prev, newProfile];
        });
      })
      // Listen for profile updates (name, roles, avatar changes)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const updated = payload.new as ChatProfile;
        setAllMembers((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m));
        setMessages((prev) => prev.map((m) => m.user_id === updated.id && m.profiles ? { ...m, profiles: { ...m.profiles, ...updated } } : m));
        setFriendsList((prev) => prev.map((f) => f.profiles && f.profiles.id === updated.id ? { ...f, profiles: { ...f.profiles, ...updated } } : f));
      })
      .subscribe((status) => {
        console.log("[PNW Notif] Subscription status:", status);
        // Quand le channel revient de CLOSED → SUBSCRIBED, re-fetch les données perdues
        if (status === "SUBSCRIBED") {
          supabase.from("profiles").select("*").order("created_at").then(({ data }) => {
            if (data) setAllMembers(data as ChatProfile[]);
          });
          getFriends(session.user.id).then(setFriendsList);
        }
      });

    // Presence: track online users
    const presenceChannel = supabase.channel("online-users", {
      config: { presence: { key: session.user.id } },
    });

    const syncPresence = () => {
      const state = presenceChannel.presenceState();
      const ids = new Set<string>(Object.keys(state));
      setOnlineUserIds(ids);
    };

    presenceChannel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // (Re)track presence — couvre aussi la reconnexion après CLOSED
          await presenceChannel.track({
            user_id: session.user.id,
            username: profile?.display_name || profile?.username || "",
          });
          // Re-sync la liste des en ligne après reconnexion
          syncPresence();
        }
      });

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(presenceChannel);
    };
  }, [session?.user?.id, profile?.display_name]);

  /* ---------- Game Live Dashboard — presence channel ---------- */

  useEffect(() => {
    if (!session?.user?.id || !profile) return;
    // Si le channel existe deja et est vivant, ne pas le recreer
    if (gameLiveRef.current) {
      const existingState = (gameLiveRef.current as any).state;
      if (existingState === "joined" || existingState === "SUBSCRIBED") return;
      // Channel mort — le supprimer proprement avant de recreer
      console.log("[GameLive] Removing dead channel (state=" + existingState + ") for recreation");
      supabase.removeChannel(gameLiveRef.current);
      gameLiveRef.current = null;
      gameLiveRef2.current = null;
    }

    const channel = supabase.channel("game-live", {
      config: { presence: { key: session.user.id }, broadcast: { ack: true } },
    });

    const syncGameLive = () => {
      const state = channel.presenceState();
      const map = new Map<string, GameLivePlayer>();
      for (const [uid, presences] of Object.entries(state)) {
        const p = (presences as any[])?.[0];
        if (!p) continue;
        // Support both old full-gameState format and new lightweight format
        if (p.gameActive || p.gameState) {
          map.set(uid, {
            userId: uid,
            displayName: p.displayName || "",
            avatarUrl: p.avatarUrl || null,
            roles: p.roles || [],
            gameState: p.gameState ? (p.gameState as GameLiveState) : null,
            liveStatus: p.gameActive ? {
              gameActive: true,
              mapName: p.mapName || "",
              inBattle: !!p.inBattle,
              partySize: p.partySize || 0,
              timestamp: p.timestamp || 0,
            } : null,
          });
        }
      }
      // For our own user, ALWAYS keep local data (polling reads game_state.json directly — freshest source)
      setGameLivePlayers((prev) => {
        const myId = session?.user?.id;
        if (myId) {
          const localEntry = prev.get(myId);
          if (localEntry) {
            map.set(myId, localEntry);
          }
        }
        return map;
      });
    };

    channel
      .on("presence", { event: "sync" }, syncGameLive)
      .on("presence", { event: "join" }, syncGameLive)
      .on("presence", { event: "leave" }, syncGameLive)
      // On-demand gameState broadcast: respond to requests from other players
      .on("broadcast", { event: "game_state_request" }, async (payload: any) => {
        const { requesterId, targetId } = payload.payload || {};
        if (targetId !== session?.user?.id || !requesterId) return;
        // Read our fresh local game state and send it back
        try {
          const state = await invoke<GameLiveState | null>("cmd_read_game_state");
          if (state) {
            channel.send({
              type: "broadcast",
              event: "game_state_response",
              payload: { targetId: session.user.id, requesterId, gameState: state },
            });
          }
        } catch {}
      })
      // Receive gameState responses for profiles we opened
      .on("broadcast", { event: "game_state_response" }, (payload: any) => {
        const { targetId, requesterId, gameState } = payload.payload || {};
        if (requesterId !== session?.user?.id || !targetId || !gameState) return;
        // Update the target player's full gameState
        setGameLivePlayers((prev) => {
          const entry = prev.get(targetId);
          if (!entry) return prev;
          const next = new Map(prev);
          next.set(targetId, { ...entry, gameState: gameState as GameLiveState });
          return next;
        });
      })
      // ─── P2P Trade Broadcast handlers ───
      .on("broadcast", { event: "trade_request" }, (msg: any) => {
        const p = msg.payload;
        if (p?.toId !== session?.user?.id) return;
        // Block if same save (same rawTrainerId)
        const mySaveId = gameProfile?.rawTrainerId ?? 0;
        if (mySaveId > 0 && p.saveId > 0 && mySaveId === p.saveId) {
          channel.send({ type: "broadcast", event: "trade_decline", payload: { tradeId: p.tradeId, fromId: p.toId, toId: p.fromId, reason: "same_save" } });
          return;
        }
        // Ignore if already in a trade
        setTradeState((prev) => {
          if (prev.phase !== "idle") {
            channel.send({ type: "broadcast", event: "trade_decline", payload: { tradeId: p.tradeId, fromId: p.toId, toId: p.fromId } });
            return prev;
          }
          return { phase: "pending", role: "responder", tradeId: p.tradeId, partnerId: p.fromId, partnerName: p.fromName, partnerAvatar: p.fromAvatar, dmChannelId: p.dmChannelId, startedAt: Date.now() };
        });
      })
      .on("broadcast", { event: "trade_accept" }, (msg: any) => {
        const p = msg.payload;
        setTradeState((prev) => {
          if (prev.phase !== "pending" || prev.tradeId !== p.tradeId) return prev;
          return { phase: "selecting", role: prev.role, tradeId: prev.tradeId, partnerId: prev.partnerId, partnerName: prev.partnerName, partnerAvatar: prev.partnerAvatar, dmChannelId: prev.dmChannelId, mySelection: null, theirPreview: null };
        });
      })
      .on("broadcast", { event: "trade_decline" }, (msg: any) => {
        const p = msg.payload;
        setTradeState((prev) => {
          if (prev.phase !== "pending" || prev.tradeId !== p.tradeId) return prev;
          const reason = p.reason === "same_save"
            ? "Impossible d'échanger : vous utilisez la même sauvegarde."
            : p.reason === "game_running"
            ? `${prev.partnerName} doit fermer le jeu avant d'échanger.`
            : `${prev.partnerName} a refusé l'échange.`;
          return { phase: "error", tradeId: prev.tradeId, partnerId: prev.partnerId, partnerName: prev.partnerName, message: reason };
        });
      })
      .on("broadcast", { event: "trade_cancel" }, (msg: any) => {
        const p = msg.payload;
        setTradeState((prev) => {
          if ((prev as any).tradeId !== p.tradeId || p.userId === session?.user?.id) return prev;
          return { phase: "error", tradeId: p.tradeId, partnerId: (prev as any).partnerId ?? "", partnerName: (prev as any).partnerName ?? "", message: "L'échange a été annulé." };
        });
      })
      .on("broadcast", { event: "trade_select" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        setTradeState((prev) => {
          if (prev.phase !== "selecting" || prev.tradeId !== p.tradeId) return prev;
          return { ...prev, theirPreview: p.preview };
        });
      })
      .on("broadcast", { event: "trade_unselect" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        setTradeState((prev) => {
          if (prev.phase !== "selecting" || prev.tradeId !== p.tradeId) return prev;
          return { ...prev, theirPreview: null };
        });
      })
      .on("broadcast", { event: "trade_confirm" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        setTradeState((prev) => {
          if ((prev as any).tradeId !== p.tradeId) return prev;
          // If we're still selecting, transition to confirming with their confirm already true
          if (prev.phase === "selecting" && (prev as any).mySelection && (prev as any).theirPreview) {
            return { phase: "confirming", role: prev.role, tradeId: (prev as any).tradeId, partnerId: (prev as any).partnerId, partnerName: (prev as any).partnerName, partnerAvatar: (prev as any).partnerAvatar, dmChannelId: (prev as any).dmChannelId, mySelection: (prev as any).mySelection, theirPreview: (prev as any).theirPreview, myConfirmed: false, theirConfirmed: true };
          }
          if (prev.phase === "confirming") {
            return { ...prev, theirConfirmed: true };
          }
          return prev;
        });
      })
      .on("broadcast", { event: "trade_confirm_cancel" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        setTradeState((prev) => {
          if (prev.phase !== "confirming" || prev.tradeId !== p.tradeId) return prev;
          // Back to selecting
          return { phase: "selecting", role: prev.role, tradeId: prev.tradeId, partnerId: prev.partnerId, partnerName: prev.partnerName, partnerAvatar: prev.partnerAvatar, dmChannelId: prev.dmChannelId, mySelection: prev.mySelection, theirPreview: prev.theirPreview };
        });
      })
      .on("broadcast", { event: "trade_execute" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        // Store their bytes immediately and trigger execution
        theirPokemonB64Ref.current = p.pokemonB64;
        setTradeBytesReady((n) => n + 1);
        setTradeState((prev) => {
          if ((prev as any).tradeId !== p.tradeId) return prev;
          if (prev.phase !== "confirming" && prev.phase !== "executing") return prev;
          // Responder: send ack with our bytes
          const myB64 = (prev as any).mySelection?.pokemonB64;
          if (myB64 && prev.role === "responder") {
            channel.send({ type: "broadcast", event: "trade_execute_ack", payload: { tradeId: (prev as any).tradeId, userId: session?.user?.id, pokemonB64: myB64 } });
          }
          return { phase: "executing", role: prev.role, tradeId: (prev as any).tradeId, partnerId: (prev as any).partnerId, partnerName: (prev as any).partnerName, partnerAvatar: (prev as any).partnerAvatar, dmChannelId: (prev as any).dmChannelId, mySelection: (prev as any).mySelection, theirPreview: (prev as any).theirPreview };
        });
      })
      .on("broadcast", { event: "trade_execute_ack" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        // Initiator receives ack — store their bytes and trigger execution
        theirPokemonB64Ref.current = p.pokemonB64;
        setTradeBytesReady((n) => n + 1);
        setTradeState((prev) => {
          if ((prev as any).tradeId !== p.tradeId) return prev;
          if (prev.phase === "executing") return prev; // already executing, don't recreate
          return { phase: "executing", role: (prev as any).role, tradeId: (prev as any).tradeId, partnerId: (prev as any).partnerId, partnerName: (prev as any).partnerName, partnerAvatar: (prev as any).partnerAvatar, dmChannelId: (prev as any).dmChannelId, mySelection: (prev as any).mySelection, theirPreview: (prev as any).theirPreview };
        });
      })
      .on("broadcast", { event: "trade_complete" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        // Partner finished writing their save — if we're also done, show animation
        tradeCompleteRef.current.theirDone = true;
        if (tradeCompleteRef.current.myDone) {
          // Both done — trigger animation
          setShowTradeSwapAnim(true);
          clearTradeTimeout();
          setTradeState((prev) => {
            if ((prev as any).tradeId !== p.tradeId) return prev;
            return { phase: "complete", tradeId: (prev as any).tradeId, partnerId: (prev as any).partnerId ?? "", partnerName: (prev as any).partnerName ?? "" };
          });
          theirPokemonB64Ref.current = null;
          tradeCompleteRef.current = { myDone: false, theirDone: false, boxName: null };
          setTimeout(() => onProfileReload?.(), 500);
        }
      })
      .on("broadcast", { event: "trade_error" }, (msg: any) => {
        const p = msg.payload;
        if (p.userId === session?.user?.id) return;
        setTradeState((prev) => {
          if ((prev as any).tradeId !== p.tradeId) return prev;
          return { phase: "error", tradeId: p.tradeId, partnerId: (prev as any).partnerId ?? "", partnerName: (prev as any).partnerName ?? "", message: p.message || "Erreur lors de l'échange." };
        });
      })
      .subscribe((status: string) => {
        console.log("[GameLive] Channel subscribe status:", status);
      });

    gameLiveRef.current = channel;
    gameLiveRef2.current = channel;

    // Health check: if channel drops to CLOSED, remove it and trigger recreation with exponential backoff
    let reconnectScheduled = false;
    let reconnectDelay = 5000; // start at 5s, double each time, cap at 60s
    const MAX_RECONNECT_DELAY = 60000;
    const healthCheck = setInterval(() => {
      const ch = gameLiveRef.current;
      if (!ch || reconnectScheduled) return;
      const st = (ch as any).state;
      if (st === "closed" || st === "errored" || st === "CLOSED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
        reconnectScheduled = true;
        console.warn("[GameLive] Channel dead (state=" + st + "), will recreate in " + (reconnectDelay / 1000) + "s...");
        setTimeout(() => {
          reconnectScheduled = false;
          const ch2 = gameLiveRef.current;
          if (!ch2) return;
          const st2 = (ch2 as any).state;
          if (st2 === "joined" || st2 === "SUBSCRIBED") {
            reconnectDelay = 5000; // reset backoff on success
            return;
          }
          console.log("[GameLive] Removing dead channel for recreation...");
          supabase.removeChannel(ch2);
          gameLiveRef.current = null;
          gameLiveRef2.current = null;
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
          setGlReconnect((n) => n + 1);
        }, reconnectDelay);
      }
    }, 8000);

    // Poll game state every 3 seconds
    const poll = setInterval(async () => {
      // Ne pas tracker si le channel n'est pas connecte
      const chState = (channel as any).state;
      if (chState !== "joined" && chState !== "SUBSCRIBED") return;
      try {
        const state = await invoke<GameLiveState | null>("cmd_read_game_state");
        const json = state ? JSON.stringify(state) : "";
        if (json === lastTrackedState.current) return;
        lastTrackedState.current = json;
        if (state?.active) {
          const prof = profileRef.current;
          setGameLivePlayers((prev) => {
            const next = new Map(prev);
            next.set(session.user.id, {
              userId: session.user.id,
              displayName: prof?.display_name || prof?.username || "",
              avatarUrl: prof?.avatar_url ?? null,
              roles: prof?.roles || [],
              gameState: state,
            });
            return next;
          });
          channel.track({
            displayName: prof?.display_name || prof?.username || "",
            avatarUrl: prof?.avatar_url ?? null,
            roles: prof?.roles || [],
            gameActive: true,
            mapName: state.map_name || "",
            inBattle: !!state.in_battle,
            partySize: state.party?.length || 0,
            timestamp: state.timestamp,
          });
        } else {
          setGameLivePlayers((prev) => {
            if (!prev.has(session.user.id)) return prev;
            const next = new Map(prev);
            next.delete(session.user.id);
            return next;
          });
          channel.untrack();
        }
      } catch {
        // Tauri command not available or game not running
      }
    }, 3000);

    return () => {
      clearInterval(poll);
      clearInterval(healthCheck);
      // NE PAS appeler removeChannel ici — le channel doit rester vivant
      // Il sera nettoye uniquement au logout (session change) OU par le health check
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- glReconnect forces recreation when channel dies; profileRef is read inside the poll
  }, [session?.user?.id, !!profile, glReconnect]);

  // Cleanup du channel game-live au unmount reel uniquement
  useEffect(() => {
    return () => {
      if (gameLiveRef.current) {
        supabase.removeChannel(gameLiveRef.current);
        gameLiveRef.current = null;
        gameLiveRef2.current = null;
      }
    };
  }, []);

  /* ---------- Battle lobby — Socket.io invite system (Railway) ---------- */

  useEffect(() => {
    if (!session?.user?.id) return;

    const playInviteSound = () => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 700; osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
        setTimeout(() => { const o2 = ctx.createOscillator(); const g2 = ctx.createGain(); o2.connect(g2); g2.connect(ctx.destination); o2.frequency.value = 1000; o2.type = "sine"; g2.gain.setValueAtTime(0.15, ctx.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); o2.start(ctx.currentTime); o2.stop(ctx.currentTime + 0.3); }, 150);
      } catch {}
    };

    const cleanup = connectLobby(session.user.id, {
      onInvite: (p) => {
        if (battleStateRef.current.phase !== "idle") return;
        console.log("[BattleLobby] Invite received from", p.fromName, "room", p.roomCode);
        setBattleState({
          phase: "inviting",
          roomCode: p.roomCode,
          partnerId: p.fromId,
          partnerName: p.fromName,
          partnerAvatar: p.fromAvatar || null,
          dmChannelId: p.dmChannelId || 0,
        });
        playInviteSound();
      },
      onAccepted: async (p) => {
        const cur = battleStateRef.current;
        if (cur.phase !== "inviting" || (cur as any).roomCode !== p.roomCode) return;
        const code = p.roomCode;
        const partnerName = (cur as any).partnerName || p.partnerName || "Adversaire";
        if (battleTimeoutRef.current) { clearTimeout(battleTimeoutRef.current); battleTimeoutRef.current = null; }
        setBattleState((prev) => ({ ...prev, phase: "waiting_game" } as any));
        if (battleRelayCleanupRef.current) { battleRelayCleanupRef.current(); battleRelayCleanupRef.current = null; }
        await cleanupBattleFiles();
        try { await writeBattleTrigger(Number(code), partnerName, "host"); } catch (e) { console.error("[Battle] writeBattleTrigger error:", e); }
        battleResultRef.current = "";
        const relayCleanup = startRelay(
          code, session?.user?.id || "",
          () => setBattleState((prev) => (prev as any).roomCode === code ? { ...prev, phase: "relaying" } as any : prev),
          (reason) => {
            const prev = battleStateRef.current;
            const result = reason === "opponent_forfeit" ? "win" : reason === "opponent_crash" ? "draw" : reason === "game_end" ? (battleResultRef.current || "unknown") : "unknown";
            saveBattleLog({ roomCode: code, myUserId: session?.user?.id || "", partnerId: (prev as any).partnerId || "", partnerName: (prev as any).partnerName || partnerName, result, reason: reason || "unknown", turns: 0, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
            setBattleState((prev2) => (prev2 as any).roomCode === code ? { phase: "complete", roomCode: code, partnerId: (prev2 as any).partnerId || "", partnerName: (prev2 as any).partnerName || "", endReason: reason, battleResult: result } : prev2);
            writeStopTrigger().then(() => cleanupBattleFiles()).catch(() => {});
          },
          undefined, // son de tour gere par le jeu
          undefined, // spectator count handled in BattleArenaView
          (result) => { battleResultRef.current = result; },
        );
        battleRelayCleanupRef.current = relayCleanup;
      },
      onDeclined: (p) => {
        if ((battleStateRef.current as any).roomCode !== p.roomCode) return;
        if (battleTimeoutRef.current) { clearTimeout(battleTimeoutRef.current); battleTimeoutRef.current = null; }
        cleanupBattleFiles().catch(() => {});
        setBattleState({ phase: "idle" });
      },
      onCancelled: (p) => {
        if ((battleStateRef.current as any).roomCode !== p.roomCode) return;
        if (battleRelayCleanupRef.current) { battleRelayCleanupRef.current(); battleRelayCleanupRef.current = null; }
        if (battleTimeoutRef.current) { clearTimeout(battleTimeoutRef.current); battleTimeoutRef.current = null; }
        writeStopTrigger().catch(() => {});
        cleanupBattleFiles().catch(() => {});
        setBattleState({ phase: "idle" });
      },
    });

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  /* ---------- Per-channel notification subscriptions ---------- */

  useEffect(() => {
    if (!session || !channels.length) return;

    const handler = async (payload: any) => {
      const msg = payload.new as any;
      if (msg.user_id === session.user.id) return;

      const isViewingChannel = visibleRef.current && activeChannelRef.current?.id === msg.channel_id;
      const isDm = channelsRef.current.some((c) => c.id === msg.channel_id && c.type === "dm");

      // Check if user is mentioned
      const p = profileRef.current;
      const myNames = [p?.display_name, p?.username].filter(Boolean).map((n) => n!.toLowerCase());
      const contentLower = (msg.content || "").toLowerCase();
      const isMentioned = myNames.some((name) => contentLower.includes(`@${name}`));

      // Check if reply to me
      let isReplyToMe = false;
      if (msg.reply_to) {
        try {
          const { data } = await supabase.from("messages").select("user_id").eq("id", msg.reply_to).single();
          isReplyToMe = data?.user_id === session.user.id;
        } catch {}
      }

      const shouldNotify = isDm || isMentioned || isReplyToMe;

      // If viewing the channel, only play sound for mentions/replies
      if (isViewingChannel) {
        if (shouldNotify) {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 1000; osc.type = "sine";
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
          } catch {}
        }
        return;
      }

      // Not viewing: unread + badge
      setUnreadCounts((prev) => ({ ...prev, [msg.channel_id]: (prev[msg.channel_id] || 0) + 1 }));
      if (shouldNotify) {
        setMentionCounts((prev) => ({ ...prev, [msg.channel_id]: (prev[msg.channel_id] || 0) + 1 }));
      }

      // Sound
      if (shouldNotify) {
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = isMentioned || isReplyToMe ? 1000 : 800;
          osc.type = "sine";
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
        } catch {}
      }
    };

    // Create one subscription per known channel (filtered = works with Supabase RLS)
    const sub = supabase.channel(`msg-notifs-${Date.now()}`);
    channels.forEach((ch) => {
      sub.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${ch.id}` }, handler);
    });
    sub.subscribe((status) => {
      console.log("[PNW Notif] Per-channel sub status:", status, "channels:", channels.length);
    });

    return () => { supabase.removeChannel(sub); };
  }, [session?.user?.id, channels.map((c) => c.id).join(",")]);

  /* ---------- Send message ---------- */

  async function handleSend() {
    if ((!draft.trim() && !imagePreview) || !activeChannel || !session || sending || activeMute || activeBan) return;
    if (slowmodeCooldown > 0 && !isMod) return; // blocked by cooldown (mods bypass)

    // Check if it's a slash command
    if (draft.trim().startsWith("/")) {
      const cmdName = draft.trim().slice(1).split(" ")[0].toLowerCase();
      const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
      if (cmd && (cmd.roles.length === 0 || cmd.roles.some((r) => profile?.roles?.includes(r)))) {
        await executeSlashCommand(cmd);
        return;
      }
    }

    // Edit mode: save edit instead of sending new message
    if (editingMsg) {
      await handleSaveEdit();
      return;
    }

    setSending(true);

    // Upload image if attached
    let content = draft.trim();
    if (imagePreview) {
      const imgUrl = await uploadMessageImage(activeChannel.id, imagePreview.file);
      if (imgUrl) {
        content = content ? `${content}\n${imgUrl}` : imgUrl;
      }
      URL.revokeObjectURL(imagePreview.url);
      setImagePreview(null);
    }

    if (!content) { setSending(false); return; }

    const insertPayload: any = {
      channel_id: activeChannel.id,
      user_id: session.user.id,
      content,
    };
    if (replyingTo) insertPayload.reply_to = replyingTo.id;

    const { error } = await supabase.from("messages").insert(insertPayload);
    setSending(false);
    if (!error) {
      setDraft("");
      setReplyingTo(null);
      if (inputRef.current) { inputRef.current.style.height = "auto"; inputRef.current.focus(); }
      // Force scroll to bottom after sending
      scrollToBottom("smooth");
      // Start slowmode cooldown if active (mods bypass)
      if (slowmodeActive && !isMod) {
        startSlowmodeCooldown();
      }
    }
  }

  /* ---------- Handle input changes (slash detection) ---------- */

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraft(val);

    // Auto-resize textarea
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";

    // Broadcast typing indicator (throttled)
    if (val.trim() && typingChannelRef.current && !typingTimeoutRef.current) {
      typingChannelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: session?.user?.id, name: displayName(profile), avatar: profile?.avatar_url } });
      typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 2000);
    }

    // Detect slash command typing
    if (val.startsWith("/")) {
      const filter = val.slice(1).toLowerCase();
      setSlashFilter(filter);
      setShowSlashPicker(true);
      setSlashSelectedIndex(0);
      setShowMentionPicker(false);
    } else {
      setShowSlashPicker(false);
    }

    // Detect @mention typing
    const cursorPos = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
    if (atMatch && !val.startsWith("/")) {
      setShowMentionPicker(true);
      setMentionFilter(atMatch[1]);
      setMentionStartPos(cursorPos - atMatch[0].length);
      setMentionSelectedIndex(0);
    } else {
      setShowMentionPicker(false);
    }
  }

  function selectMention(member: ChatProfile) {
    const username = member.display_name || member.username || "";
    const before = draft.slice(0, mentionStartPos);
    const after = draft.slice(mentionStartPos + 1 + mentionFilter.length);
    setDraft(before + `@${username} ` + after);
    setShowMentionPicker(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Navigate mention picker
    if (showMentionPicker) {
      const filtered = allMembers.filter((m) => {
        const name = (m.display_name || m.username || "").toLowerCase();
        return name.includes(mentionFilter.toLowerCase());
      }).slice(0, 10);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        if (filtered[mentionSelectedIndex]) {
          e.preventDefault();
          selectMention(filtered[mentionSelectedIndex]);
          return;
        }
      }
      if (e.key === "Escape") {
        setShowMentionPicker(false);
        return;
      }
    }

    // Navigate slash picker
    if (showSlashPicker) {
      const available = SLASH_COMMANDS.filter((cmd) => {
        if (cmd.roles.length && !cmd.roles.some((r) => profile?.roles?.includes(r))) return false;
        if (slashFilter && !cmd.name.startsWith(slashFilter)) return false;
        return true;
      });

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => Math.min(prev + 1, available.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        if (available[slashSelectedIndex]) {
          e.preventDefault();
          executeSlashCommand(available[slashSelectedIndex]);
          return;
        }
      }
      if (e.key === "Escape") {
        setShowSlashPicker(false);
        return;
      }
    }

    if (e.key === "Escape") {
      if (editingMsg) { cancelEditing(); return; }
      if (replyingTo) { cancelReply(); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /* ---------- Delete message (mod or own message) ---------- */

  async function handleDeleteMessage(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    // Animate fade-out
    setDeletingMsgIds((prev) => new Set(prev).add(msgId));
    const ok = await deleteMessage(msgId);
    if (ok) {
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
        setDeletingMsgIds((prev) => { const n = new Set(prev); n.delete(msgId); return n; });
      }, 250);
      if (msg && session) {
        sendLog({
          type: "delete", modName: displayName(profile), modAvatar: profile?.avatar_url,
          modId: session.user.id, targetName: displayName(msg.profiles), targetAvatar: msg.profiles?.avatar_url,
          targetId: msg.user_id, detail: msg.content.length > 100 ? msg.content.slice(0, 100) + "…" : msg.content,
        });
      }
    } else console.warn("[PNW Chat] Impossible de supprimer le message", msgId);
  }

  /* ---------- Pin / unpin message ---------- */

  async function handleTogglePin(msg: ChatMessage) {
    const newPin = !msg.is_pinned;
    const ok = await togglePinMessage(msg.id, newPin, session?.user?.id);
    if (ok) {
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: newPin, pinned_by: newPin ? (session?.user?.id ?? null) : null } : m));
      // Refresh pinned panel if open
      if (showPinnedPanel && activeChannel) {
        fetchPinnedMessages(activeChannel.id).then(setPinnedMessages);
      }
    }
  }

  async function loadPinnedMessages() {
    if (!activeChannel) return;
    setPinnedLoading(true);
    const pins = await fetchPinnedMessages(activeChannel.id);
    setPinnedMessages(pins);
    setPinnedLoading(false);
  }

  /* ---------- Edit message ---------- */

  function startEditing(msg: ChatMessage) {
    setEditingMsg(msg);
    setReplyingTo(null);
    setDraft(msg.content);
    inputRef.current?.focus();
  }

  function cancelEditing() {
    setEditingMsg(null);
    setDraft("");
  }

  async function handleSaveEdit() {
    if (!editingMsg || !draft.trim()) return;
    if (draft.trim() === editingMsg.content) { cancelEditing(); return; }
    const oldContent = editingMsg.content;
    const ok = await updateMessage(editingMsg.id, draft.trim());
    if (ok) {
      setMessages((prev) => prev.map((m) =>
        m.id === editingMsg.id ? { ...m, content: draft.trim(), edited_at: new Date().toISOString() } : m
      ));
      sendLog({
        type: "edit", modName: displayName(profile), modAvatar: profile?.avatar_url,
        modId: session!.user.id, targetName: displayName(profile), targetAvatar: profile?.avatar_url,
        targetId: session!.user.id, detail: (oldContent.length > 50 ? oldContent.slice(0, 50) + "…" : oldContent) + " → " + (draft.trim().length > 50 ? draft.trim().slice(0, 50) + "…" : draft.trim()),
      });
      cancelEditing();
    }
  }

  /* ---------- Reply ---------- */

  function startReplying(msg: ChatMessage) {
    setReplyingTo(msg);
    setEditingMsg(null);
    setDraft("");
    inputRef.current?.focus();
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  /* ---------- DM creation ---------- */

  async function searchUsers(query: string) {
    setDmSearch(query);
    if (query.length < 2) { setDmResults([]); return; }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", `%${query}%`)
      .neq("id", session!.user.id)
      .limit(10);
    setDmResults((data as ChatProfile[]) || []);
  }

  async function startDm(targetUser: ChatProfile) {
    if (!session) return;
    if (blockedUserIds.has(targetUser.id)) return; // Can't DM blocked user

    // Check if DM already exists — query only MY memberships (RLS allows this)
    const { data: myDmMemberships } = await supabase
      .from("channel_members")
      .select("channel_id")
      .eq("user_id", session.user.id);

    if (myDmMemberships?.length) {
      const myDmIds = myDmMemberships.map((m) => m.channel_id);
      // Query DM channels from DB (not just local state, in case hidden)
      const { data: dbDmChannels } = await supabase
        .from("channels")
        .select("*")
        .in("id", myDmIds)
        .eq("type", "dm");

      // Check if any of these DMs is with the target user
      for (const ch of (dbDmChannels as ChatChannel[]) || []) {
        const { data: members } = await supabase
          .from("channel_members")
          .select("user_id")
          .eq("channel_id", ch.id);
        if (members?.some((m) => m.user_id === targetUser.id)) {
          // Re-add to local state if it was hidden
          setChannels((prev) => {
            if (prev.some((c) => c.id === ch.id)) return prev;
            return [...prev, ch];
          });
          setActiveChannel(ch);
          setShowNewDm(false);
          setDmSearch("");
          setDmResults([]);
          return;
        }
      }
    }

    // Create DM via RPC (bypasses RLS issues)
    const { data: newId, error: rpcErr } = await supabase.rpc("create_dm_channel", {
      target_user_id: targetUser.id,
    });

    if (rpcErr || !newId) {
      console.error("[PNW Chat] DM create error:", rpcErr);
      return;
    }

    await loadChannels();
    const { data: newCh } = await supabase.from("channels").select("*").eq("id", newId).single();
    if (newCh) setActiveChannel(newCh as ChatChannel);

    setShowNewDm(false);
    setDmSearch("");
    setDmResults([]);
  }

  /* ---------- DM channel display name ---------- */

  const [dmPartners, setDmPartners] = useState<Record<number, { name: string; avatar: string | null; displayName: string | null }>>({});

  useEffect(() => {
    if (!session) return;
    const dmChannelsList = channels.filter((c) => c.type === "dm");
    if (!dmChannelsList.length) return;

    Promise.all(
      dmChannelsList.map(async (ch) => {
        const { data: members } = await supabase
          .from("channel_members")
          .select("user_id, profiles(username, display_name, avatar_url)")
          .eq("channel_id", ch.id)
          .neq("user_id", session.user.id)
          .limit(1);
        const prof = (members?.[0] as any)?.profiles;
        return {
          id: ch.id,
          name: prof?.username || "DM",
          displayName: prof?.display_name || null,
          avatar: prof?.avatar_url || null,
        };
      })
    ).then((results) => {
      const map: Record<number, { name: string; avatar: string | null; displayName: string | null }> = {};
      results.forEach((r) => (map[r.id] = { name: r.name, avatar: r.avatar, displayName: r.displayName }));
      setDmPartners(map);
    });
  }, [channels, session]);

  function getChannelDisplayName(ch: ChatChannel) {
    if (ch.type === "dm") {
      const partner = dmPartners[ch.id];
      return partner?.displayName || partner?.name || "Message privé";
    }
    return ch.name || "Salon";
  }

  /* ---------- Render message content with @mentions ---------- */

  const IMAGE_URL_RE = /https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/gi;

  function renderContent(text: string) {
    // Split by lines first to handle image URLs on their own lines
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];

    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) elements.push(<br key={`br-${lineIdx}`} />);

      // Check if entire line is an image URL
      const trimmed = line.trim();
      if (IMAGE_URL_RE.test(trimmed) && trimmed.match(IMAGE_URL_RE)?.[0] === trimmed) {
        IMAGE_URL_RE.lastIndex = 0;
        elements.push(
          <img
            key={`img-${lineIdx}`}
            src={trimmed}
            alt=""
            className="pnw-chat-msg-image"
            onClick={() => setLightboxUrl(trimmed)}
            loading="lazy"
          />
        );
        return;
      }
      IMAGE_URL_RE.lastIndex = 0;

      // Parse @mentions and inline image URLs
      const parts = line.split(/(@\S+)/g);
      parts.forEach((part, i) => {
        if (part.startsWith("@")) {
          const mentionName = part.slice(1);
          const member = allMembers.find(
            (m) => (m.display_name || "").toLowerCase() === mentionName.toLowerCase() ||
                   (m.username || "").toLowerCase() === mentionName.toLowerCase()
          );
          const isMe = member?.id === session?.user?.id;
          elements.push(
            <span
              key={`${lineIdx}-${i}`}
              className={`pnw-chat-mention${isMe ? " pnw-chat-mention--me" : ""}`}
              onClick={() => member && openProfile(member)}
            >
              {part}
            </span>
          );
        } else {
          elements.push(<React.Fragment key={`${lineIdx}-${i}`}>{part}</React.Fragment>);
        }
      });
    });

    return elements;
  }

  /* ---------- Profile popup ---------- */

  function openProfile(p: ChatProfile | undefined) {
    if (!p || !session) return;
    setProfilePopup(p);
    // Load friendship status
    if (p.id !== session.user.id) {
      setProfileFriendship(undefined); // loading
      getFriendship(session.user.id, p.id).then((f) => setProfileFriendship(f));
      // Request full gameState from the other player if they're online
      if (gameLivePlayers.has(p.id) && gameLiveRef.current) {
        gameLiveRef.current.send({
          type: "broadcast",
          event: "game_state_request",
          payload: { requesterId: session.user.id, targetId: p.id },
        });
      }
    }
  }

  function handleProfileSaved(updated: ChatProfile) {
    setProfile(updated);
    profileRef.current = updated;
    setEditingProfile(false);
    setProfilePopup(null);
    // Refresh messages to show new avatar/name
    setMessages((prev) =>
      prev.map((m) =>
        m.user_id === updated.id
          ? { ...m, profiles: updated }
          : m
      )
    );
    // Refresh member list
    setAllMembers((prev) =>
      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
    );
  }

  // Poll other player's gameState while their profile is open
  useEffect(() => {
    if (!profilePopup || !session?.user?.id || profilePopup.id === session.user.id) return;
    if (!gameLivePlayers.has(profilePopup.id) || !gameLiveRef.current) return;
    const ch = gameLiveRef.current;
    const targetId = profilePopup.id;
    const myId = session.user.id;
    const interval = setInterval(() => {
      ch.send({
        type: "broadcast",
        event: "game_state_request",
        payload: { requesterId: myId, targetId },
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [profilePopup?.id, session?.user?.id]);

  async function handleDmFromProfile(targetProfile: ChatProfile) {
    setProfilePopup(null);
    await startDm(targetProfile);
  }

  /* ---------- Format time ---------- */

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatFullTimestamp(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  /* ---------- Group messages by date ---------- */

  function groupMessagesByDate(msgs: ChatMessage[]) {
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let currentDate = "";
    for (const msg of msgs) {
      const d = formatDate(msg.created_at);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, messages: [] });
      }
      groups[groups.length - 1].messages.push(msg);
    }
    return groups;
  }

  const publicChannels = channels.filter((c) => c.type === "public");
  const modChannels = channels.filter((c) => c.type === "moderation");
  const dmChannelsList = channels.filter((c) => c.type === "dm");
  const groups = React.useMemo(() => groupMessagesByDate(messages), [messages]);

  /* ---------- Render ---------- */

  if (loading) {
    return <LoadingScreen label="Chargement" />;
  }

  // Not logged in
  if (!session) {
    return (
      <div className="pnw-chat-login">
        <div className="pnw-chat-login-card">
          {/* Decorative glow */}
          <div className="pnw-chat-login-glow" />

          {/* Logo area */}
          <div className="pnw-chat-login-logo">
            <img src="/logo.png" alt="PNW" />
          </div>

          <h2>Chat PNW</h2>
          <p>Rejoins la communauté Pokémon New World.<br />Discute, échange et partage avec les joueurs.</p>

          <div className="pnw-chat-login-features">
            <div className="pnw-chat-login-feature">
              <FaMessage className="pnw-chat-login-feature-icon" />
              <span>Salons de discussion</span>
            </div>
            <div className="pnw-chat-login-feature">
              <FaEnvelope className="pnw-chat-login-feature-icon" />
              <span>Messages privés</span>
            </div>
            <div className="pnw-chat-login-feature">
              <FaUserShield className="pnw-chat-login-feature-icon" />
              <span>Rôles & badges</span>
            </div>
          </div>

          <button className="pnw-chat-discord-btn" onClick={signInWithDiscord}>
            <FaDiscord style={{ fontSize: 20 }} />
            Se connecter avec Discord
          </button>

          <button className="pnw-chat-back-btn" onClick={onBack}>
            <FaArrowLeft /> Retour au launcher
          </button>
        </div>
      </div>
    );
  }

  function selectChannel(ch: ChatChannel) {
    // Save last read msg & scroll position for current channel before switching
    if (activeChannel && messages.length) {
      lastReadMsgId.current[activeChannel.id] = messages[messages.length - 1].id;
    }
    if (activeChannel && messagesContainerRef.current) {
      scrollPositions.current[activeChannel.id] = messagesContainerRef.current.scrollTop;
    }
    setActiveChannel(ch);
    activeChannelRef.current = ch;
    setShowPinnedPanel(false);
    // Set unread separator: first unread msg after last read
    const lastRead = lastReadMsgId.current[ch.id];
    setUnreadSeparatorId(lastRead || null);
    // Clear unread & mention counts for this channel
    setUnreadCounts((prev) => { const n = { ...prev }; delete n[ch.id]; return n; });
    setMentionCounts((prev) => { const n = { ...prev }; delete n[ch.id]; return n; });
    // Check slowmode for this channel
    setSlowmodeActive((ch.slowmode_seconds || 0) > 0);
    setSlowmodeCooldown(0);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
  }

  // Banned user screen
  if (activeBan) {
    const banExpiry = activeBan.expires_at
      ? new Date(activeBan.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
    return (
      <div className="pnw-chat-login">
        <div className="pnw-chat-ban-screen">
          <div className="pnw-chat-ban-icon">
            <FaBan />
          </div>
          <h2 className="pnw-chat-ban-title">Accès suspendu</h2>
          <p className="pnw-chat-ban-desc">
            Ton accès au Chat PNW a été temporairement restreint.
          </p>
          {activeBan.reason && (
            <div className="pnw-chat-ban-reason">
              <FaMessage style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{activeBan.reason}</span>
            </div>
          )}
          {banExpiry ? (
            <div className="pnw-chat-ban-expiry">
              <FaClock /> Expire le {banExpiry}
            </div>
          ) : (
            <div className="pnw-chat-ban-expiry pnw-chat-ban-expiry--permanent">
              <FaBan /> Bannissement définitif
            </div>
          )}
          <button className="pnw-chat-ban-back" onClick={onBack}>
            <FaArrowLeft /> Retour au launcher
          </button>
        </div>
      </div>
    );
  }

  // ──�� Battle Mode: render BattleArenaView instead of chat ───
  if (battleMode && session && profile) {
    return (
      <BattleArenaView
        session={session}
        profile={profile}
        friendsList={friendsList}
        onlineUserIds={onlineUserIds}
        gameLivePlayers={gameLivePlayers}
        dmPartners={dmPartners}
        channels={channels}
        battleState={battleState}
        setBattleState={setBattleState}
        battleRelayCleanupRef={battleRelayCleanupRef}
        battleTimeoutRef={battleTimeoutRef}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="pnw-chat">
      {/* ====== LEFT: Channel sidebar ====== */}
      <div className="pnw-chat-sidebar">
        {/* Header */}
        <div className="pnw-chat-sidebar-header">
          <button className="pnw-chat-header-close" onClick={onBack} title="Fermer">
            <FaXmark />
          </button>
          <div className="pnw-chat-header-brand">
            <img src="/logo.png" alt="" className="pnw-chat-header-logo" />
            <div className="pnw-chat-header-brand-text">
              <span className="pnw-chat-header-title">Chat PNW</span>
              <span className="pnw-chat-header-subtitle">{allMembers.filter(m => onlineUserIds.has(m.id)).length} en ligne</span>
            </div>
          </div>
          {isMod && (
            <button className="pnw-chat-admin-btn" onClick={() => setShowAdmin(true)} title="Administration">
              <FaGear />
            </button>
          )}
        </div>

        {/* User card */}
        {profile && (
          <div className="pnw-chat-user-card">
            <button className="pnw-chat-user-card-avatar-btn" onClick={() => openProfile(profile)}>
              <div className="pnw-chat-avatar-wrap">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="pnw-chat-avatar pnw-chat-avatar--lg" style={roleGlow(profile.roles)} />
                ) : (
                  <div className="pnw-chat-avatar pnw-chat-avatar--lg pnw-chat-avatar--placeholder" style={roleGlow(profile.roles)}>
                    {displayName(profile)[0]?.toUpperCase()}
                  </div>
                )}
                <span className="pnw-chat-online-dot" />
              </div>
            </button>
            <div className="pnw-chat-user-card-content">
              <span className="pnw-chat-user-card-name" style={roleColor(profile.roles) ? { color: roleColor(profile.roles) } : undefined}>
                {displayName(profile)}
              </span>
              <RoleBadgesCompact roles={profile.roles} />
            </div>
            <div className="pnw-chat-user-card-actions">
              <button className="pnw-chat-user-card-edit" onClick={() => { setProfilePopup(profile); setEditingProfile(true); }} title="Modifier le profil">
                <FaPen />
              </button>
              <button className="pnw-chat-user-card-friends" onClick={() => { getFriends(session!.user.id).then(setFriendsList); setShowFriendsPanel(true); }} title="Liste d'amis">
                <FaUserGroup />
                {friendsList.filter((f) => f.status === "pending" && f.friend_id === session?.user?.id).length > 0 && (
                  <span className="pnw-chat-badge">{friendsList.filter((f) => f.status === "pending" && f.friend_id === session?.user?.id).length}</span>
                )}
              </button>
              <button className="pnw-chat-user-card-logout" onClick={signOut} title="Déconnexion">
                <FaRightFromBracket />
              </button>
            </div>
          </div>
        )}

        {/* Channel list */}
        <div className="pnw-chat-channel-list pnw-scrollbar">
          <ChannelCategory label="Salons textuels" defaultOpen>
            {publicChannels.map((ch) => {
              const unread = unreadCounts[ch.id] || 0;
              const mentions = mentionCounts[ch.id] || 0;
              return (
                <button key={ch.id} className={`pnw-chat-ch ${activeChannel?.id === ch.id ? "pnw-chat-ch--active" : ""} ${unread > 0 ? "pnw-chat-ch--unread" : ""}`} onClick={() => selectChannel(ch)}>
                  <ChannelIcon type={ch.type} name={ch.name} />
                  <span className="pnw-chat-ch-name">{getChannelDisplayName(ch)}</span>
                  {mentions > 0 && <span className="pnw-chat-ch-badge">{mentions}</span>}
                </button>
              );
            })}
          </ChannelCategory>

          {modChannels.length > 0 && (
            <ChannelCategory label="Staff">
              {modChannels.map((ch) => {
                const unread = unreadCounts[ch.id] || 0;
                const mentions = mentionCounts[ch.id] || 0;
                return (
                  <button key={ch.id} className={`pnw-chat-ch ${activeChannel?.id === ch.id ? "pnw-chat-ch--active" : ""} ${unread > 0 ? "pnw-chat-ch--unread" : ""}`} onClick={() => selectChannel(ch)}>
                    <ChannelIcon type={ch.type} name={ch.name} />
                    <span className="pnw-chat-ch-name">{getChannelDisplayName(ch)}</span>
                    {mentions > 0 && <span className="pnw-chat-ch-badge">{mentions}</span>}
                  </button>
                );
              })}
            </ChannelCategory>
          )}

          {/* DM section — inside the scrollable list */}
          {(() => {
            const pinned = dmChannelsList.filter((ch) => pinnedDms.has(ch.id));
            const unpinned = dmChannelsList.filter((ch) => !pinnedDms.has(ch.id));

            function renderDmItem(ch: typeof dmChannelsList[0], isPinned: boolean) {
              const partner = dmPartners[ch.id];
              return (
                <div
                  key={ch.id}
                  className={`pnw-chat-dm-item ${activeChannel?.id === ch.id ? "pnw-chat-dm-item--active" : ""}`}
                  onClick={() => selectChannel(ch)}
                >
                  <div className="pnw-chat-dm-item-avatar">
                    {partner?.avatar ? (
                      <img src={partner.avatar} alt="" className="pnw-chat-dm-item-avatar-img" />
                    ) : (
                      <FaEnvelope />
                    )}
                    {(unreadCounts[ch.id] || 0) > 0 && (
                      <span className="pnw-chat-dm-unread-badge">{unreadCounts[ch.id]}</span>
                    )}
                  </div>
                  <span className="pnw-chat-dm-item-name">{getChannelDisplayName(ch)}</span>
                  <div className="pnw-chat-dm-item-actions">
                    <button
                      className={`pnw-chat-dm-item-pin${isPinned ? " pnw-chat-dm-item-pin--on" : ""}`}
                      onClick={(e) => { e.stopPropagation(); togglePinDm(ch.id); }}
                      title={isPinned ? "Désépingler" : "Épingler"}
                    >
                      <FaThumbtack />
                    </button>
                    <button
                      className="pnw-chat-dm-item-delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (session) {
                          await leaveDmChannel(ch.id, session.user.id);
                          if (activeChannel?.id === ch.id) setActiveChannel(null);
                          setChannels((prev) => prev.filter((c) => c.id !== ch.id));
                          channelsRef.current = channelsRef.current.filter((c) => c.id !== ch.id);
                        }
                      }}
                      title="Supprimer la conversation"
                    >
                      <FaXmark />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <>
                {pinned.length > 0 && (
                  <div className="pnw-chat-dm-section pnw-chat-dm-section--pinned">
                    <div className="pnw-chat-dm-section-header">
                      <FaThumbtack className="pnw-chat-dm-section-icon" />
                      <span>Épinglés</span>
                    </div>
                    <div className="pnw-chat-dm-list">
                      {pinned.map((ch) => renderDmItem(ch, true))}
                    </div>
                  </div>
                )}
                <div className="pnw-chat-dm-section">
                  <div className="pnw-chat-dm-section-header">
                    <FaEnvelope className="pnw-chat-dm-section-icon" />
                    <span>Messages privés</span>
                    <button className="pnw-chat-dm-add-btn" onClick={() => setShowNewDm(true)} title="Nouveau message">
                      <FaPlus />
                    </button>
                  </div>
                  <div className="pnw-chat-dm-list">
                    {unpinned.length === 0 && pinned.length === 0 && (
                      <div className="pnw-chat-dm-list-empty">Aucune conversation</div>
                    )}
                    {unpinned.map((ch) => renderDmItem(ch, false))}
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* New DM modal */}
        {showNewDm && (
          <div className="pnw-chat-dm-overlay" onClick={() => { setShowNewDm(false); setDmSearch(""); setDmResults([]); }}>
            <div className="pnw-chat-dm-modal" onClick={(e) => e.stopPropagation()}>
              <div className="pnw-chat-dm-modal-header">
                <span>Nouveau message</span>
                <button onClick={() => { setShowNewDm(false); setDmSearch(""); setDmResults([]); }}><FaXmark /></button>
              </div>
              <div className="pnw-chat-dm-search">
                <FaMagnifyingGlass />
                <input type="text" placeholder="Rechercher un joueur…" value={dmSearch} onChange={(e) => searchUsers(e.target.value)} autoFocus />
              </div>
              <div className="pnw-chat-dm-results pnw-scrollbar">
                {dmResults.map((u) => (
                  <button key={u.id} className="pnw-chat-dm-result" onClick={() => startDm(u)}>
                    {u.avatar_url ? <img src={u.avatar_url} alt="" className="pnw-chat-avatar" /> : <div className="pnw-chat-avatar pnw-chat-avatar--placeholder">{u.username[0]?.toUpperCase()}</div>}
                    <span>{u.username}</span>
                    <RoleBadgesCompact roles={u.roles} />
                  </button>
                ))}
                {dmSearch.length >= 2 && !dmResults.length && <div className="pnw-chat-dm-empty">Aucun joueur trouvé</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====== RIGHT: Messages area ====== */}
      <div className={`pnw-chat-main${activeChannel?.type === "dm" ? " pnw-chat-main--dm" : ""}`}>
        {activeChannel ? (
          <>
            {/* Channel header */}
            <div className={`pnw-chat-main-header${activeChannel.type === "dm" ? " pnw-chat-main-header--dm" : ""}`}>
              {activeChannel.type === "dm" ? (() => {
                const partnerId = Object.entries(dmPartners).find(([id]) => Number(id) === activeChannel.id)?.[1];
                const partnerProfile = partnerId ? allMembers.find((m) => m.username === partnerId.name || m.display_name === partnerId.displayName) : null;
                return (
                  <>
                    <div className="pnw-chat-dm-header-identity">
                      {partnerId?.avatar ? (
                        <img src={partnerId.avatar} alt="" className="pnw-chat-dm-header-avatar" />
                      ) : (
                        <div className="pnw-chat-dm-header-avatar pnw-chat-dm-header-avatar--placeholder">
                          <FaEnvelope />
                        </div>
                      )}
                      <div className="pnw-chat-dm-header-info">
                        <span className="pnw-chat-dm-header-name">{getChannelDisplayName(activeChannel)}</span>
                        <span className="pnw-chat-dm-header-status">Message privé</span>
                      </div>
                    </div>
                    <div className="pnw-chat-dm-header-actions">
                      {partnerProfile && (
                        <>
                          <button
                            className="pnw-chat-dm-header-btn"
                            onClick={() => openProfile(partnerProfile)}
                            title="Voir le profil"
                          >
                            <FaUserShield />
                          </button>
                          {!blockedUserIds.has(partnerProfile.id) ? (
                            <button
                              className="pnw-chat-dm-header-btn pnw-chat-dm-header-btn--block"
                              onClick={async () => {
                                await blockUser(partnerProfile.id);
                                getBlockedUsers(session!.user.id).then((blocks) => {
                                  setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
                                  setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
                                });
                              }}
                              title="Bloquer"
                            >
                              <FaBan />
                            </button>
                          ) : (
                            <button
                              className="pnw-chat-dm-header-btn pnw-chat-dm-header-btn--unblock"
                              onClick={async () => {
                                const blockId = blockedUsersMap.get(partnerProfile.id);
                                if (blockId) {
                                  await unblockUser(blockId);
                                  getBlockedUsers(session!.user.id).then((blocks) => {
                                    setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
                                    setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
                                  });
                                }
                              }}
                              title="Débloquer"
                            >
                              <FaBan />
                            </button>
                          )}
                        </>
                      )}
                      <button
                        className={`pnw-chat-dm-header-btn${showPinnedPanel ? " pnw-chat-dm-header-btn--active" : ""}`}
                        onClick={() => { setShowPinnedPanel((v) => { if (!v) loadPinnedMessages(); return !v; }); }}
                        title="Messages épinglés"
                      >
                        <FaThumbtack />
                      </button>
                      <button
                        className="pnw-chat-dm-header-btn"
                        onClick={() => setShowDmBgModal(true)}
                        title="Personnaliser le fond"
                      >
                        <FaImage />
                      </button>
                    </div>
                  </>
                );
              })() : (
                <>
                  <ChannelIcon type={activeChannel.type} name={activeChannel.name} />
                  <span className="pnw-chat-header-title">{getChannelDisplayName(activeChannel)}</span>
                </>
              )}
              <div className="pnw-chat-header-actions">
                {session && activeChannel.type !== "dm" && (
                  <button
                    className={`pnw-chat-header-action${showPinnedPanel ? " pnw-chat-header-action--active" : ""}`}
                    onClick={() => { setShowPinnedPanel((v) => { if (!v) loadPinnedMessages(); return !v; }); }}
                    title="Messages épinglés"
                  >
                    <FaThumbtack />
                  </button>
                )}
                {session && (
                  <button
                    className={`pnw-chat-header-action${showLeaderboard ? " pnw-chat-header-action--active" : ""}`}
                    onClick={() => setShowLeaderboard((v) => !v)}
                    title="Classement"
                  >
                    <FaTrophy />
                  </button>
                )}
                {activeChannel.type !== "dm" && (
                  <button
                    className={`pnw-chat-header-action${showMembers ? " pnw-chat-header-action--active" : ""}`}
                    onClick={() => setShowMembers((v) => !v)}
                    title="Joueurs"
                  >
                    <FaUsers />
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              onScroll={() => {
                setIsAtBottom(checkIfAtBottom());
                const el = messagesContainerRef.current;
                if (el && el.scrollTop < 50 && hasMoreMessages && !loadingOlder) loadOlderMessages();
              }}
              className="pnw-chat-messages pnw-scrollbar"
              style={activeChannel.background_url ? {
                backgroundImage: `linear-gradient(rgba(5,9,20,.82), rgba(5,9,20,.88)), url(${activeChannel.background_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundAttachment: "local",
              } : undefined}
            >
              {loadingOlder && (
                <div className="pnw-chat-loading-older">
                  <FaSpinner className="pnw-chat-spinner" /> Chargement…
                </div>
              )}
              {loadingMessages && (
                <div className="pnw-chat-skeleton">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="pnw-chat-skeleton-msg" style={{ animationDelay: `${i * 0.08}s` }}>
                      <div className="pnw-chat-skeleton-avatar" />
                      <div className="pnw-chat-skeleton-body">
                        <div className="pnw-chat-skeleton-name" style={{ width: `${60 + (i * 13) % 40}px` }} />
                        <div className="pnw-chat-skeleton-text" style={{ width: `${120 + (i * 37) % 180}px` }} />
                        {i % 3 === 0 && <div className="pnw-chat-skeleton-text" style={{ width: `${80 + (i * 23) % 120}px` }} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!messages.length && !loadingMessages && (
                <div className="pnw-chat-empty-messages">
                  <ChannelIcon type={activeChannel.type} name={activeChannel.name} />
                  <h3>Bienvenue dans #{getChannelDisplayName(activeChannel)}</h3>
                  <p>C'est le début de la conversation.</p>
                </div>
              )}
              {groups.map((g) => (
                <React.Fragment key={g.date}>
                  <div className="pnw-chat-date-divider">
                    <span>{g.date}</span>
                  </div>
                  {g.messages.map((msg, idx) => {
                    const author = msg.profiles;
                    const prev = g.messages[idx - 1];
                    // Unread separator
                    const showUnreadSep = unreadSeparatorId !== null && msg.id > unreadSeparatorId && (!prev || prev.id <= unreadSeparatorId);
                    const unreadSepEl = showUnreadSep ? (
                      <div className="pnw-chat-unread-separator" key={`unread-${msg.id}`}>
                        <span>Nouveaux messages</span>
                      </div>
                    ) : null;
                    // Hide blocked users' messages
                    if (blockedUserIds.has(msg.user_id)) {
                      const isRevealed = revealedBlockedMsgs.has(msg.id);
                      if (!isRevealed) {
                        return (
                          <div key={msg.id} className="pnw-chat-msg-blocked">
                            <FaBan className="pnw-chat-msg-blocked-icon" />
                            <span>Message d'un utilisateur bloqué</span>
                            <button className="pnw-chat-msg-blocked-show" onClick={() => {
                              setRevealedBlockedMsgs((prev) => new Set(prev).add(msg.id));
                            }}>Afficher</button>
                          </div>
                        );
                      }
                      // Revealed blocked message — show with dimmed style + hide button
                      return (
                        <div key={msg.id} className="pnw-chat-msg pnw-chat-msg--blocked-revealed">
                          <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={{ opacity: 0.3 }}>
                            {displayName(author)?.[0]?.toUpperCase() || "?"}
                          </div>
                          <div className="pnw-chat-msg-body">
                            <div className="pnw-chat-msg-meta">
                              <span className="pnw-chat-msg-author" style={{ opacity: 0.4 }}>{displayName(author)}</span>
                              <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              <button className="pnw-chat-msg-blocked-hide" onClick={() => {
                                setRevealedBlockedMsgs((prev) => { const n = new Set(prev); n.delete(msg.id); return n; });
                              }}>Masquer</button>
                            </div>
                            <div className="pnw-chat-msg-content" style={{ opacity: 0.5 }}>{renderContent(msg.content)}</div>
                          </div>
                        </div>
                      );
                    }
                    // Compute action bar early so GTS/Pokémon cards can use it
                    const isOwn = msg.user_id === session?.user?.id;
                    const canDelete = isMod || isOwn;
                    const isSpecialEmbed = msg.content.startsWith(GTS_PREFIX) || msg.content.startsWith(POKEMON_PREFIX) || msg.content.startsWith(ACTIVITY_PREFIX) || msg.content.startsWith(TRADE_PREFIX) || msg.content.startsWith(WISHLIST_PREFIX);
                    const canEdit = isOwn && !isSpecialEmbed;
                    const canPin = isMod || profile?.roles?.includes("devteam");
                    const actionBar = (
                      <div className="pnw-chat-msg-actions">
                        <button className="pnw-chat-msg-action pnw-chat-msg-action--reply" onClick={() => startReplying(msg)} title="Répondre">
                          <FaReply />
                        </button>
                        {canPin && (
                          <button
                            className={`pnw-chat-msg-action pnw-chat-msg-action--pin${msg.is_pinned ? " pnw-chat-msg-action--pinned" : ""}`}
                            onClick={() => handleTogglePin(msg)}
                            title={msg.is_pinned ? "Désépingler" : "Épingler"}
                          >
                            <FaThumbtack />
                          </button>
                        )}
                        {canEdit && (
                          <button className="pnw-chat-msg-action pnw-chat-msg-action--edit" onClick={() => startEditing(msg)} title="Modifier">
                            <FaPen />
                          </button>
                        )}
                        {canDelete && (
                          <button className="pnw-chat-msg-action pnw-chat-msg-action--danger" onClick={() => handleDeleteMessage(msg.id)} title="Supprimer">
                            <FaTrashCan />
                          </button>
                        )}
                      </div>
                    );

                    const isSystem = msg.content.startsWith("⏱️");
                    if (isSystem) {
                      const isActivate = msg.content.includes("activé");
                      return (
                        <div key={msg.id} className="pnw-chat-system-announcement">
                          <div className={`pnw-chat-system-badge ${isActivate ? "pnw-chat-system-badge--warn" : "pnw-chat-system-badge--ok"}`}>
                            {isActivate ? <FaGaugeHigh /> : <FaBolt />}
                            <span>{msg.content.replace("⏱️ ", "")}</span>
                          </div>
                        </div>
                      );
                    }
                    /* Welcome card */
                    const isWelcome = msg.content.startsWith("🌟WELCOME🌟");
                    if (isWelcome) {
                      const welcomeName = msg.content.replace("🌟WELCOME🌟", "");
                      const welcomeAvatar = author?.avatar_url;
                      return (
                        <div key={msg.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", margin: "4px 0" }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg, #4ade80, #22d3ee)", display: "grid", placeItems: "center", fontSize: 10, flexShrink: 0 }}>
                            <FaUserPlus style={{ fontSize: 9, color: "#fff" }} />
                          </div>
                          <span style={{ fontSize: ".8rem", color: "rgba(255,255,255,.45)" }}>
                            {welcomeAvatar && <img src={welcomeAvatar} alt="" style={{ width: 16, height: 16, borderRadius: "50%", marginRight: 5, verticalAlign: "middle" }} />}
                            <strong style={{ color: "#4ade80" }}>{welcomeName}</strong> a rejoint l'aventure
                          </span>
                        </div>
                      );
                    }
                    /* GTS trade card */
                    if (msg.content.startsWith(GTS_PREFIX)) {
                      let gts: any = null;
                      try { gts = JSON.parse(msg.content.slice(GTS_PREFIX.length)); } catch { /* ignore */ }
                      if (gts) {
                        const genderIcon = (g: number) => g === 0 ? "♂" : g === 1 ? "♀" : "";
                        const genderColor = (g: number) => g === 0 ? "#5b9bd5" : g === 1 ? "#e57373" : "";
                        return (
                          <div key={msg.id} className="pnw-chat-msg">
                            <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                              {author?.avatar_url ? (
                                <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                              ) : (
                                <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                                  {displayName(author)?.[0]?.toUpperCase() || "?"}
                                </div>
                              )}
                            </button>
                            <div className="pnw-chat-msg-body">
                              <div className="pnw-chat-msg-meta">
                                <button className="pnw-chat-msg-author pnw-chat-clickable" style={roleColor(author?.roles || []) ? { color: roleColor(author?.roles || []) } : undefined} onClick={() => openProfile(author)} onContextMenu={(e) => { e.preventDefault(); const name = displayName(author); setDraft((d) => d ? `${d} @${name} ` : `@${name} `); }}>
                                  {displayName(author)}
                                </button>
                                <RoleBadgesCompact roles={author?.roles || []} />
                                <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              </div>
                              <div className={`pnw-chat-gts-card${onOpenGts ? " pnw-chat-gts-card--clickable" : ""}`} onClick={() => onOpenGts?.(gts.onlineId)}>
                                <div className="pnw-chat-gts-card-tag">
                                  <FaArrowRightArrowLeft /> Échange GTS <span className="pnw-chat-gts-card-id">#{gts.onlineId}</span>
                                </div>
                                <div className="pnw-chat-gts-card-body">
                                  {/* Deposited */}
                                  <div className="pnw-chat-gts-col">
                                    <span className="pnw-chat-gts-col-label">Proposé</span>
                                    {gts.deposited?.sprite && <img src={gts.deposited.sprite} alt="" className="pnw-chat-gts-sprite" />}
                                    <span className="pnw-chat-gts-name">
                                      {gts.deposited?.name}
                                      {gts.deposited?.altShiny && <FaStar className="pnw-chat-gts-alt-shiny" />}
                                      {gts.deposited?.shiny && !gts.deposited?.altShiny && <FaStar className="pnw-chat-gts-shiny" />}
                                    </span>
                                    <div className="pnw-chat-gts-chips">
                                      <span className="pnw-chat-gts-chip">Nv.{gts.deposited?.level}</span>
                                      {gts.deposited?.nature && <span className="pnw-chat-gts-chip">{gts.deposited.nature}</span>}
                                      {genderIcon(gts.deposited?.gender) && <span className="pnw-chat-gts-chip" style={{ color: genderColor(gts.deposited?.gender) }}>{genderIcon(gts.deposited?.gender)}</span>}
                                    </div>
                                  </div>
                                  {/* Arrow */}
                                  <div className="pnw-chat-gts-arrow">
                                    <FaArrowRightArrowLeft />
                                  </div>
                                  {/* Wanted */}
                                  <div className="pnw-chat-gts-col">
                                    <span className="pnw-chat-gts-col-label">Recherché</span>
                                    {gts.wanted?.sprite && <img src={gts.wanted.sprite} alt="" className="pnw-chat-gts-sprite" />}
                                    <span className="pnw-chat-gts-name">{gts.wanted?.name || "?"}</span>
                                    {gts.wanted && (
                                      <div className="pnw-chat-gts-chips">
                                        <span className="pnw-chat-gts-chip">Nv.{gts.wanted.levelMin}–{gts.wanted.levelMax}</span>
                                        {genderIcon(gts.wanted.gender) && <span className="pnw-chat-gts-chip" style={{ color: genderColor(gts.wanted.gender) }}>{genderIcon(gts.wanted.gender)}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="pnw-chat-gts-card-footer">
                                  <FaUsers /> <span>Dresseur : {gts.trainer}</span>
                                </div>
                              </div>
                            </div>
                            {actionBar}
                          </div>
                        );
                      }
                    }

                    /* Wishlist notification card (bot DM) */
                    if (msg.content.startsWith(WISHLIST_PREFIX)) {
                      let wish: any = null;
                      try { wish = JSON.parse(msg.content.slice(WISHLIST_PREFIX.length)); } catch { /* ignore */ }
                      if (wish) {
                        const genderIcon = wish.gender === 1 ? "♂" : wish.gender === 2 ? "♀" : null;
                        const genderColor = wish.gender === 1 ? "#60a5fa" : wish.gender === 2 ? "#f472b6" : undefined;
                        return (
                          <div key={msg.id} className="pnw-chat-msg pnw-chat-msg--bot-wish">
                            <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                              {author?.avatar_url ? (
                                <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                              ) : (
                                <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                                  {displayName(author)?.[0]?.toUpperCase() || "G"}
                                </div>
                              )}
                            </button>
                            <div className="pnw-chat-msg-body">
                              <div className="pnw-chat-msg-meta">
                                <button className="pnw-chat-msg-author pnw-chat-clickable" style={{ color: "#f96854" }} onClick={() => openProfile(author)}>
                                  {displayName(author)}
                                </button>
                                <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              </div>
                              <div
                                className={`pnw-chat-wish-card${onOpenGts ? " pnw-chat-wish-card--clickable" : ""}`}
                                onClick={() => onOpenGts?.(wish.onlineId)}
                              >
                                <div className="pnw-chat-wish-card-header">
                                  <div className="pnw-chat-wish-card-bell"><FaBell /></div>
                                  <div className="pnw-chat-wish-card-header-text">
                                    <span className="pnw-chat-wish-card-title">GTS Wishlist</span>
                                    <span className="pnw-chat-wish-card-subtitle">Un Pokémon correspondant a été déposé !</span>
                                  </div>
                                </div>
                                <div className="pnw-chat-wish-card-body">
                                  {wish.sprite && <img src={wish.sprite} alt="" className="pnw-chat-wish-sprite" />}
                                  <div className="pnw-chat-wish-info">
                                    <span className="pnw-chat-wish-name">
                                      {wish.name}
                                      {wish.altShiny && <FaStar className="pnw-chat-wish-star pnw-chat-wish-star--alt" />}
                                      {wish.shiny && !wish.altShiny && <FaStar className="pnw-chat-wish-star" />}
                                    </span>
                                    <div className="pnw-chat-wish-chips">
                                      <span className="pnw-chat-wish-chip"><FaBolt className="pnw-chat-wish-chip-icon" style={{ color: "#fbbf24" }} /> Nv. {wish.level}</span>
                                      {wish.nature && <span className="pnw-chat-wish-chip"><FaLeaf className="pnw-chat-wish-chip-icon" style={{ color: "#4ade80" }} /> {wish.nature}</span>}
                                      {genderIcon && <span className="pnw-chat-wish-chip" style={{ color: genderColor }}>{genderIcon}</span>}
                                    </div>
                                    <div className="pnw-chat-wish-ivs">
                                      <FaDna className="pnw-chat-wish-chip-icon" style={{ color: "#a78bfa" }} /> IV total : <strong>{wish.ivTotal}</strong>/186
                                    </div>
                                  </div>
                                </div>
                                <div className="pnw-chat-wish-card-wanted">
                                  <FaArrowRightArrowLeft className="pnw-chat-wish-wanted-icon" />
                                  <span>Demandé : <strong>{wish.wantedName}</strong>{wish.wantedLevelRange ? ` Nv. ${wish.wantedLevelRange}` : ""}</span>
                                </div>
                                <div className="pnw-chat-wish-card-cta">
                                  <FaMagnifyingGlass /> Voir l'échange #{wish.onlineId}
                                </div>
                              </div>
                            </div>
                            {actionBar}
                          </div>
                        );
                      }
                    }

                    /* Pokémon card */
                    if (msg.content.startsWith(POKEMON_PREFIX)) {
                      let poke: PokeEntry | null = null;
                      try { poke = JSON.parse(msg.content.slice(POKEMON_PREFIX.length)); } catch { /* ignore */ }
                      if (poke) {
                        const base = siteUrl.replace(/\/$/, "");
                        const spriteUrl = poke.imageUrl ? (poke.imageUrl.startsWith("http") ? poke.imageUrl : `${base}${poke.imageUrl.startsWith("/") ? "" : "/"}${poke.imageUrl}`) : "";
                        const primaryType = poke.types?.[0] || "normal";
                        const typeStyle = getTypeStyle(primaryType);
                        return (
                          <div key={msg.id} className="pnw-chat-msg">
                            <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                              {author?.avatar_url ? (
                                <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                              ) : (
                                <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                                  {displayName(author)?.[0]?.toUpperCase() || "?"}
                                </div>
                              )}
                            </button>
                            <div className="pnw-chat-msg-body">
                              <div className="pnw-chat-msg-meta">
                                <button className="pnw-chat-msg-author pnw-chat-clickable" style={roleColor(author?.roles || []) ? { color: roleColor(author?.roles || []) } : undefined} onClick={() => openProfile(author)} onContextMenu={(e) => { e.preventDefault(); const name = displayName(author); setDraft((d) => d ? `${d} @${name} ` : `@${name} `); }}>
                                  {displayName(author)}
                                </button>
                                <RoleBadgesCompact roles={author?.roles || []} />
                                <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              </div>
                              <div className="pnw-chat-pokemon-card" style={{ borderTopColor: typeStyle.border.replace("1px solid ", ""), borderTopWidth: 2, borderTopStyle: "solid" }}>
                                {spriteUrl && <img src={spriteUrl} alt={poke.name} className="pnw-chat-pokemon-card-sprite" />}
                                <div className="pnw-chat-pokemon-card-info">
                                  <div className="pnw-chat-pokemon-card-header">
                                    <span className="pnw-chat-pokemon-card-num">#{poke.num || poke.number || "?"}</span>
                                    <span className="pnw-chat-pokemon-card-name">{poke.name}</span>
                                  </div>
                                  <div className="pnw-chat-pokemon-card-types">
                                    {(() => {
                                      // Handle types as array or slash-separated string
                                      let typeList: string[] = [];
                                      if (Array.isArray(poke.types) && poke.types.length) typeList = poke.types;
                                      else if (poke.type) typeList = poke.type.split("/").map((t: string) => t.trim());
                                      return typeList.map((t: string) => {
                                        const ts = getTypeStyle(t);
                                        return <span key={t} className="pnw-chat-pokemon-card-type" style={{ background: ts.background, border: ts.border, color: ts.color }}>{getTypeLabel(t)}</span>;
                                      });
                                    })()}
                                  </div>
                                  {(poke.rarity || poke.evolution || poke.obtention) && (
                                    <div className="pnw-chat-pokemon-card-details">
                                      {poke.rarity && (
                                        <div className="pnw-chat-pokemon-card-detail-item">
                                          <span className="pnw-chat-pokemon-card-detail-label">Rareté</span>
                                          <span className="pnw-chat-pokemon-card-detail-value">{poke.rarity}</span>
                                        </div>
                                      )}
                                      {poke.evolution && (
                                        <div className="pnw-chat-pokemon-card-detail-item">
                                          <span className="pnw-chat-pokemon-card-detail-label">Évolution</span>
                                          <span className="pnw-chat-pokemon-card-detail-value">{poke.evolution}</span>
                                        </div>
                                      )}
                                      {poke.obtention && (
                                        <div className="pnw-chat-pokemon-card-detail-item pnw-chat-pokemon-card-detail-item--full">
                                          <span className="pnw-chat-pokemon-card-detail-label">Obtention</span>
                                          <span className="pnw-chat-pokemon-card-detail-value">{poke.obtention}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {poke.total && (
                                    <div className="pnw-chat-pokemon-card-stats">
                                      <div className="pnw-chat-pokemon-card-stat"><span>PV</span><span>{poke.hp}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat"><span>ATK</span><span>{poke.atk}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat"><span>DEF</span><span>{poke.def}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat"><span>SPA</span><span>{poke.spa}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat"><span>SPD</span><span>{poke.spd}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat"><span>SPE</span><span>{poke.spe}</span></div>
                                      <div className="pnw-chat-pokemon-card-stat pnw-chat-pokemon-card-stat--total"><span>BST</span><span>{poke.total}</span></div>
                                    </div>
                                  )}
                                  {poke.talents && Array.isArray(poke.talents) && (() => {
                                    const validTalents = poke.talents.filter((t: any) => t.name?.trim());
                                    if (!validTalents.length) return null;
                                    return (
                                      <div className="pnw-chat-pokemon-card-talents">
                                        {validTalents.map((t: any, ti: number) => (
                                          <span key={ti} className={`pnw-chat-pokemon-card-talent ${t.hidden ? "pnw-chat-pokemon-card-talent--hidden" : ""}`}>
                                            {t.name.trim()}{t.hidden ? " (caché)" : ""}
                                            {t.desc?.trim() && <span className="pnw-chat-pokemon-card-talent-tooltip">{t.desc.trim()}</span>}
                                          </span>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                  {poke.attacks && (() => {
                                    const rawAtks = Array.isArray(poke.attacks) ? poke.attacks : [];
                                    const cleanName = (n: string) => n.replace(/^\d+\)\s*/, "").trim();
                                    const validAtks = rawAtks.filter((a: any) => cleanName(a.name || ""));
                                    if (!validAtks.length) return null;
                                    return (
                                      <div className="pnw-chat-pokemon-card-attacks">
                                        {validAtks.map((a: any, ai: number) => (
                                          <span key={ai} className="pnw-chat-pokemon-card-attack">
                                            {cleanName(a.name || "")}
                                            {a.desc?.trim() && <span className="pnw-chat-pokemon-card-attack-tooltip">{a.desc.trim()}</span>}
                                          </span>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                            {actionBar}
                          </div>
                        );
                      }
                    }

                    /* P2P Trade completion embed */
                    if (msg.content.startsWith(TRADE_PREFIX)) {
                      const tradeData = parseTradeMessage(msg.content);
                      if (tradeData) {
                        return (
                          <div key={msg.id} className="pnw-chat-msg" id={`msg-${msg.id}`}>
                            <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                              {author?.avatar_url ? (
                                <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                              ) : (
                                <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                                  {displayName(author)?.[0]?.toUpperCase() || "?"}
                                </div>
                              )}
                            </button>
                            <div className="pnw-chat-msg-body">
                              <div className="pnw-chat-msg-meta">
                                <button className="pnw-chat-msg-author pnw-chat-clickable" style={roleColor(author?.roles || []) ? { color: roleColor(author?.roles || []) } : undefined} onClick={() => openProfile(author)} onContextMenu={(e) => { e.preventDefault(); const name = displayName(author); setDraft((d) => d ? `${d} @${name} ` : `@${name} `); }}>
                                  {displayName(author)}
                                </button>
                                <RoleBadgesCompact roles={author?.roles || []} />
                                <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              </div>
                              <div className="pnw-trade-embed">
                                <div className="pnw-trade-embed-tag"><FaArrowRightArrowLeft /> Échange P2P</div>
                                <div className="pnw-trade-embed-body">
                                  {[tradeData.playerA, tradeData.playerB].map((player, pi) => {
                                    const pk = player.pokemon;
                                    const rawNat = pk.nature;
                                    const natIdx = Array.isArray(rawNat) ? rawNat[0] : rawNat;
                                    const natName = natIdx != null ? NATURE_FR[natIdx] : null;
                                    const itemName = pk.itemHolding != null && pk.itemHolding > 0 ? (psdkNames.items?.[pk.itemHolding] ?? `#${pk.itemHolding}`) : null;
                                    const hasIvs = pk.ivHp != null;
                                    const ivTotal = hasIvs ? (pk.ivHp! + (pk.ivAtk ?? 0) + (pk.ivDfe ?? 0) + (pk.ivSpd ?? 0) + (pk.ivAts ?? 0) + (pk.ivDfs ?? 0)) : null;
                                    return (
                                      <React.Fragment key={pi}>
                                        {pi > 0 && <div className="pnw-trade-embed-arrow"><FaArrowRightArrowLeft /></div>}
                                        <div className="pnw-trade-embed-side">
                                          <VdSprite speciesId={pk.speciesId} form={pk.form} shiny={pk.shiny} altShiny={pk.altShiny} className="pnw-trade-embed-sprite" />
                                          <span className="pnw-trade-embed-name">
                                            {pk.name}
                                            {pk.altShiny && <FaStar style={{ color: "#c084fc", fontSize: 8, marginLeft: 3 }} />}
                                            {pk.shiny && !pk.altShiny && <FaStar style={{ color: "#facc15", fontSize: 8, marginLeft: 3 }} />}
                                          </span>
                                          <span className="pnw-trade-embed-level">Nv.{pk.level}</span>
                                          <div className="pnw-trade-embed-details">
                                            {natName && <span className="pnw-trade-embed-chip"><FaLeaf style={{ fontSize: 7 }} /> {natName}</span>}
                                            {itemName && <span className="pnw-trade-embed-chip"><FaBagShopping style={{ fontSize: 7 }} /> {itemName}</span>}
                                            {ivTotal != null && <span className="pnw-trade-embed-chip"><FaDna style={{ fontSize: 7 }} /> IV {ivTotal}/186</span>}
                                          </div>
                                          {pk.moves && pk.moves.length > 0 && (
                                            <div className="pnw-trade-embed-moves">
                                              {pk.moves.map((mid, mi) => <span key={mi} className="pnw-trade-embed-move">{psdkNames.skills?.[mid] ?? `#${mid}`}</span>)}
                                            </div>
                                          )}
                                          <span className="pnw-trade-embed-trainer">{player.name}</span>
                                        </div>
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    }

                    /* Activity share embed */
                    if (msg.content.startsWith(ACTIVITY_PREFIX)) {
                      let actStored: GameActivityShareData | null = null;
                      try { actStored = JSON.parse(msg.content.slice(ACTIVITY_PREFIX.length)); } catch {}
                      if (actStored) {
                        // Live data: use gameLivePlayers if target is currently in-game
                        const livePlayer = gameLivePlayers.get(actStored.targetUserId);
                        const liveGs = livePlayer?.gameState;
                        const isLive = !!(liveGs?.active);
                        // Build live act data, fallback to stored snapshot
                        // Resolve speciesId from name via psdkNames
                        const resolveId = (name: string, sid?: number) => {
                          if (sid && sid > 0) return sid;
                          if (!psdkNames.species || !name) return 0;
                          const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                          const idx = psdkNames.species.findIndex((s) => s && s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() === n);
                          return idx > 0 ? idx : 0;
                        };
                        const act: GameActivityShareData = isLive ? {
                          ...actStored,
                          mapName: liveGs!.map_name || actStored.mapName,
                          inBattle: !!liveGs!.in_battle,
                          party: liveGs!.party?.map((pk) => ({
                            species: pk.species,
                            speciesId: resolveId(pk.species, pk.species_id),
                            level: pk.level,
                            form: pk.form ?? 0,
                            shiny: pk.shiny,
                            altShiny: pk.alt_shiny ?? false,
                            nickname: pk.name !== pk.species ? pk.name : null,
                            gender: pk.gender,
                            nature: pk.nature,
                            ability: pk.ability,
                            itemHolding: pk.item,
                            exp: pk.exp,
                            moves: pk.moves,
                            ivHp: pk.iv_hp,
                            ivAtk: pk.iv_atk,
                            ivDfe: pk.iv_dfe,
                            ivSpd: pk.iv_spd,
                            ivAts: pk.iv_ats,
                            ivDfs: pk.iv_dfs,
                          })) || actStored.party,
                          battleAlly: liveGs!.battle_ally ? (() => {
                            const a = liveGs!.battle_ally!;
                            const allyPk = liveGs!.party?.find((p) => p.species === a.species);
                            return { species: a.species, speciesId: resolveId(a.species, a.species_id), level: a.level, shiny: !!a.shiny, altShiny: !!a.alt_shiny, hp: a.hp ?? allyPk?.hp, max_hp: a.max_hp ?? allyPk?.max_hp };
                          })() : actStored.battleAlly,
                          battleFoes: liveGs!.battle_foes?.map((f) => ({ species: f.species, speciesId: resolveId(f.species, f.species_id), level: f.level, shiny: !!f.shiny, altShiny: !!f.alt_shiny, hp: f.hp, max_hp: f.max_hp })) || actStored.battleFoes,
                        } : actStored;
                        // Croiser altShiny avec gameProfile.team si c'est notre propre profil
                        if (session?.user?.id && actStored.targetUserId === session.user.id && gameProfile?.team) {
                          for (let pi = 0; pi < act.party.length && pi < gameProfile.team.length; pi++) {
                            if (gameProfile.team[pi]?.isAltShiny && !act.party[pi].altShiny) {
                              act.party[pi] = { ...act.party[pi], altShiny: true };
                            }
                          }
                        }
                        // Request full gameState if player is online but we only have liveStatus
                        if (livePlayer && !liveGs && livePlayer.liveStatus?.gameActive && gameLiveRef.current && session?.user?.id && actStored.targetUserId !== session.user.id) {
                          gameLiveRef.current.send({
                            type: "broadcast",
                            event: "game_state_request",
                            payload: { requesterId: session.user.id, targetId: actStored.targetUserId },
                          });
                        }
                        return (
                          <div key={msg.id} className="pnw-chat-msg" id={`msg-${msg.id}`}>
                            <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                              {author?.avatar_url ? (
                                <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                              ) : (
                                <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                                  {displayName(author)?.[0]?.toUpperCase() || "?"}
                                </div>
                              )}
                            </button>
                            <div className="pnw-chat-msg-body">
                              <div className="pnw-chat-msg-meta">
                                <button className="pnw-chat-msg-author pnw-chat-clickable" style={roleColor(author?.roles || []) ? { color: roleColor(author?.roles || []) } : undefined} onClick={() => openProfile(author)} onContextMenu={(e) => { e.preventDefault(); const name = displayName(author); setDraft((d) => d ? `${d} @${name} ` : `@${name} `); }}>
                                  {displayName(author)}
                                </button>
                                <RoleBadgesCompact roles={author?.roles || []} />
                                <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                              </div>
                            <div className="pnw-chat-activity-embed">
                              <div className="pnw-chat-activity-embed-header">
                                {act.targetAvatar && <img src={act.targetAvatar} alt="" className="pnw-chat-activity-embed-avatar" />}
                                <div className="pnw-chat-activity-embed-player">
                                  <span className="pnw-chat-activity-embed-name">{act.targetName}</span>
                                  <span className={`pnw-chat-activity-embed-status${act.inBattle ? " pnw-chat-activity-embed-status--battle" : ""}`}>
                                    <FaGamepad /> {act.inBattle ? "En combat" : act.mapName || "En jeu"}
                                    {isLive && <span className="pnw-chat-activity-embed-live">LIVE</span>}
                                  </span>
                                </div>
                              </div>
                              {act.party.length > 0 && (
                                <ActivityEmbedParty party={act.party} psdkNames={psdkNames} />
                              )}
                              {act.inBattle && act.battleAlly && act.battleFoes && act.battleFoes.length > 0 && (
                                <div className="pnw-chat-activity-embed-battle">
                                  <div className="pnw-chat-activity-embed-battle-label"><FaBolt /> <span>Combat sauvage</span></div>
                                  <div className="pnw-chat-activity-embed-battle-arena">
                                    <div className="pnw-chat-activity-embed-battle-side">
                                      <VdSprite speciesId={act.battleAlly.speciesId || 0} form={0} shiny={act.battleAlly.shiny} altShiny={act.battleAlly.altShiny} className="pnw-chat-activity-embed-battle-sprite pnw-chat-activity-embed-battle-sprite--ally" />
                                      <span className="pnw-chat-activity-embed-battle-name" style={{ color: "rgba(74,222,128,.75)" }}>{act.battleAlly.species}</span>
                                      <span className="pnw-chat-activity-embed-battle-lvl">Nv.{act.battleAlly.level}</span>
                                      {act.battleAlly.hp != null && act.battleAlly.max_hp ? (
                                        <div className="pnw-chat-activity-embed-battle-hp">
                                          <div className="pnw-chat-activity-embed-battle-hpbar"><div className="pnw-chat-activity-embed-battle-hpfill" style={{ width: `${Math.round((act.battleAlly.hp / act.battleAlly.max_hp) * 100)}%`, background: act.battleAlly.hp / act.battleAlly.max_hp > 0.5 ? "#4ade80" : act.battleAlly.hp / act.battleAlly.max_hp > 0.2 ? "#facc15" : "#ef4444" }} /></div>
                                          <span className="pnw-chat-activity-embed-battle-hptxt">{act.battleAlly.hp}/{act.battleAlly.max_hp}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="pnw-chat-activity-embed-battle-vsicon">VS</div>
                                    {act.battleFoes.map((f, fi) => (
                                      <div key={fi} className="pnw-chat-activity-embed-battle-side">
                                        <VdSprite speciesId={f.speciesId || 0} form={0} shiny={f.shiny} altShiny={f.altShiny} className="pnw-chat-activity-embed-battle-sprite pnw-chat-activity-embed-battle-sprite--foe" />
                                        <span className="pnw-chat-activity-embed-battle-name" style={{ color: "rgba(239,68,68,.75)" }}>{f.species}</span>
                                        <span className="pnw-chat-activity-embed-battle-lvl">Nv.{f.level}</span>
                                        <div className="pnw-chat-activity-embed-battle-hp">
                                          <div className="pnw-chat-activity-embed-battle-hpbar"><div className="pnw-chat-activity-embed-battle-hpfill" style={{ width: `${Math.round((f.hp / f.max_hp) * 100)}%`, background: f.hp / f.max_hp > 0.5 ? "#4ade80" : f.hp / f.max_hp > 0.2 ? "#facc15" : "#ef4444" }} /></div>
                                          <span className="pnw-chat-activity-embed-battle-hptxt">{f.hp}/{f.max_hp}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <span className="pnw-chat-activity-embed-time">{new Date(act.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            </div>
                            {actionBar}
                          </div>
                        );
                      }
                    }

                    /* Log message (moderation channel) */
                    if (msg.content.startsWith(LOG_PREFIX)) {
                      let log: LogEntry | null = null;
                      try { log = JSON.parse(msg.content.slice(LOG_PREFIX.length)); } catch { /* ignore */ }
                      if (log) {
                        const logColors: Record<string, { accent: string; bg: string; icon: React.ReactNode; label: string }> = {
                          edit:   { accent: "#f39c12", bg: "rgba(243,156,18,.08)",  icon: <FaPen />,            label: "Message modifié" },
                          delete: { accent: "#e74c3c", bg: "rgba(231,76,60,.08)",   icon: <FaTrashCan />,       label: "Message supprimé" },
                          mute:   { accent: "#e67e22", bg: "rgba(230,126,34,.08)",  icon: <FaVolumeXmark />,    label: "Joueur muté" },
                          unmute: { accent: "#2ecc71", bg: "rgba(46,204,113,.08)",  icon: <FaBolt />,           label: "Joueur démuté" },
                          ban:    { accent: "#e74c3c", bg: "rgba(231,76,60,.08)",   icon: <FaBan />,            label: "Joueur banni" },
                          unban:  { accent: "#2ecc71", bg: "rgba(46,204,113,.08)",  icon: <FaShieldHalved />,   label: "Joueur débanni" },
                        };
                        const style = logColors[log.type] || logColors.edit;
                        return (
                          <div key={msg.id} className="pnw-chat-log-entry" style={{ borderLeftColor: style.accent, background: style.bg }}>
                            <div className="pnw-chat-log-entry-icon" style={{ color: style.accent }}>{style.icon}</div>
                            <div className="pnw-chat-log-entry-body">
                              <div className="pnw-chat-log-entry-header">
                                <span className="pnw-chat-log-entry-label" style={{ color: style.accent }}>{style.label}</span>
                                <span className="pnw-chat-log-entry-time">{formatTime(msg.created_at)}</span>
                              </div>
                              <div className="pnw-chat-log-entry-actors">
                                {/* Moderator */}
                                {log.modName && (
                                  <span className="pnw-chat-log-entry-actor">
                                    {log.modAvatar ? (
                                      <img src={log.modAvatar} alt="" className="pnw-chat-log-entry-avatar" />
                                    ) : (
                                      <div className="pnw-chat-log-entry-avatar pnw-chat-log-entry-avatar--placeholder">{log.modName[0]?.toUpperCase()}</div>
                                    )}
                                    <button className="pnw-chat-log-entry-name pnw-chat-clickable" onClick={() => {
                                      const p = allMembers.find((m) => m.id === log!.modId);
                                      if (p) openProfile(p);
                                    }}>{log.modName}</button>
                                  </span>
                                )}
                                <span className="pnw-chat-log-entry-arrow">→</span>
                                {/* Target */}
                                <span className="pnw-chat-log-entry-actor">
                                  {log.targetAvatar ? (
                                    <img src={log.targetAvatar} alt="" className="pnw-chat-log-entry-avatar" />
                                  ) : (
                                    <div className="pnw-chat-log-entry-avatar pnw-chat-log-entry-avatar--placeholder">{log.targetName[0]?.toUpperCase()}</div>
                                  )}
                                  <button className="pnw-chat-log-entry-name pnw-chat-clickable" onClick={() => {
                                    const p = allMembers.find((m) => m.id === log!.targetId);
                                    if (p) openProfile(p);
                                  }}>{log.targetName}</button>
                                </span>
                              </div>
                              {log.detail && <div className="pnw-chat-log-entry-detail">{log.detail}</div>}
                            </div>
                          </div>
                        );
                      }
                    }

                    const isFollowUp = prev?.user_id === msg.user_id &&
                      (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000;
                    const nameColor = roleColor(author?.roles || []);

                    // Reply reference
                    const replyRef = msg.reply_to ? messages.find((m) => m.id === msg.reply_to) : null;

                    // Reply preview block
                    const replyBlock = replyRef ? (
                      <div className="pnw-chat-reply-ref">
                        <FaReply className="pnw-chat-reply-ref-icon" />
                        <button className="pnw-chat-reply-ref-profile pnw-chat-clickable" onClick={() => openProfile(replyRef.profiles!)}>
                          {replyRef.profiles?.avatar_url ? (
                            <img src={replyRef.profiles.avatar_url} alt="" className="pnw-chat-reply-ref-avatar" />
                          ) : (
                            <div className="pnw-chat-reply-ref-avatar pnw-chat-reply-ref-avatar--placeholder">
                              {displayName(replyRef.profiles)?.[0]?.toUpperCase() || "?"}
                            </div>
                          )}
                          <span className="pnw-chat-reply-ref-author">{displayName(replyRef.profiles)}</span>
                        </button>
                        <span className="pnw-chat-reply-ref-text">{
                          replyRef.content.startsWith(GTS_PREFIX)
                            ? (() => { try { const g = JSON.parse(replyRef.content.slice(GTS_PREFIX.length)); return `🔄 Échange GTS #${g.onlineId ?? ""} — ${g.deposited?.name ?? "?"}`; } catch { return "🔄 Échange GTS"; } })()
                            : replyRef.content.startsWith(POKEMON_PREFIX)
                              ? (() => { try { const p = JSON.parse(replyRef.content.slice(POKEMON_PREFIX.length)); return `🎴 ${p.speciesName ?? p.nickname ?? "Pokémon"} Nv.${p.level ?? "?"}`; } catch { return "🎴 Carte Pokémon"; } })()
                              : replyRef.content.startsWith(ACTIVITY_PREFIX)
                                ? (() => { try { const a = JSON.parse(replyRef.content.slice(ACTIVITY_PREFIX.length)); return `🎮 ${a.targetName} — ${a.inBattle ? "En combat" : a.mapName || "En jeu"}`; } catch { return "🎮 Activité"; } })()
                                : replyRef.content.length > 80 ? replyRef.content.slice(0, 80) + "…" : replyRef.content
                        }</span>
                      </div>
                    ) : null;

                    return isFollowUp && !replyRef ? (
                      <React.Fragment key={msg.id}>
                      {unreadSepEl}
                      <div id={`msg-${msg.id}`} className={`pnw-chat-msg pnw-chat-msg--compact${deletingMsgIds.has(msg.id) ? " pnw-chat-msg--deleting" : ""}`}>
                        <span className="pnw-chat-msg-compact-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                        <div className="pnw-chat-msg-content">
                          {renderContent(msg.content)}
                          {msg.edited_at && <span className="pnw-chat-msg-edited">(modifié)</span>}
                        </div>
                        {actionBar}
                      </div>
                      </React.Fragment>
                    ) : (
                      <React.Fragment key={msg.id}>
                      {unreadSepEl}
                      <div id={`msg-${msg.id}`} className={`pnw-chat-msg${deletingMsgIds.has(msg.id) ? " pnw-chat-msg--deleting" : ""}`}>
                        <button className="pnw-chat-avatar-wrap pnw-chat-avatar-wrap--msg pnw-chat-clickable" onClick={() => openProfile(author)}>
                          {author?.avatar_url ? (
                            <img src={author.avatar_url} alt="" className="pnw-chat-msg-avatar" style={roleGlow(author?.roles || [])} />
                          ) : (
                            <div className="pnw-chat-msg-avatar pnw-chat-avatar--placeholder" style={roleGlow(author?.roles || [])}>
                              {displayName(author)?.[0]?.toUpperCase() || "?"}
                            </div>
                          )}
                        </button>
                        <div className="pnw-chat-msg-body">
                          {replyBlock}
                          <div className="pnw-chat-msg-meta">
                            <button className={`pnw-chat-msg-author pnw-chat-clickable${mutedUsersMap.has(msg.user_id) ? " pnw-chat-member-name--muted" : ""}`} style={nameColor ? { color: nameColor } : undefined} onClick={() => openProfile(author)} onContextMenu={(e) => { e.preventDefault(); const name = displayName(author); setDraft((d) => d ? `${d} @${name} ` : `@${name} `); }}>
                              {displayName(author)}
                            </button>
                            <RoleBadgesCompact roles={author?.roles || []} />
                            <span className="pnw-chat-msg-time" title={formatFullTimestamp(msg.created_at)}>{formatTime(msg.created_at)}</span>
                          </div>
                          <div className="pnw-chat-msg-content">
                            {renderContent(msg.content)}
                            {msg.edited_at && <span className="pnw-chat-msg-edited">(modifié)</span>}
                          </div>
                        </div>
                        {actionBar}
                      </div>
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Jump to bottom button */}
            {hasNewMessages && !isAtBottom && (
              <button className="pnw-chat-jump-bottom" onClick={() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setIsAtBottom(true);
                setHasNewMessages(false);
              }}>
                <FaChevronRight style={{ transform: "rotate(90deg)" }} />
                Nouveaux messages
              </button>
            )}

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="pnw-chat-typing">
                <div className="pnw-chat-typing-avatars">
                  {typingUsers.slice(0, 3).map((u) => (
                    u.avatar ? <img key={u.name} src={u.avatar} alt="" className="pnw-chat-typing-avatar" /> : <div key={u.name} className="pnw-chat-typing-avatar pnw-chat-typing-avatar--placeholder">{u.name[0]?.toUpperCase()}</div>
                  ))}
                </div>
                <span className="pnw-chat-typing-dots"><span /><span /><span /></span>
                <span>{typingUsers.length === 1 ? `${typingUsers[0].name} est en train d'écrire` : typingUsers.length <= 3 ? `${typingUsers.map((u) => u.name).join(", ")} sont en train d'écrire` : "Plusieurs personnes sont en train d'écrire"}…</span>
              </div>
            )}

            {/* Input — hidden for log channels */}
            {activeChannel.type === "moderation" && activeChannel.name?.toLowerCase().includes("log") ? (
              <div className="pnw-chat-log-notice">
                <FaScroll />
                <span>Channel de logs — lecture seule</span>
              </div>
            ) : (
            <div className="pnw-chat-input-bar">
              {activeMute && (
                <div className="pnw-chat-muted-notice">
                  <FaVolumeXmark />
                  <span>
                    Tu es muté{activeMute.expires_at
                      ? ` jusqu'au ${new Date(activeMute.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                      : " définitivement"}.
                    {activeMute.reason ? ` Raison : ${activeMute.reason}` : ""}
                  </span>
                </div>
              )}

              {/* Slash command picker */}
              {showSlashPicker && (
                <SlashCommandPicker
                  filter={slashFilter}
                  userRoles={profile?.roles || []}
                  selectedIndex={slashSelectedIndex}
                  onSelect={(cmd) => executeSlashCommand(cmd)}
                />
              )}

              {/* Mention picker */}
              {showMentionPicker && (
                <MentionPicker
                  members={allMembers}
                  filter={mentionFilter}
                  selectedIndex={mentionSelectedIndex}
                  onSelect={selectMention}
                />
              )}

              {/* Reply / Edit banner */}
              {replyingTo && (
                <div className="pnw-chat-input-banner">
                  <FaReply className="pnw-chat-input-banner-icon" />
                  <span className="pnw-chat-input-banner-label">Réponse à</span>
                  <span className="pnw-chat-input-banner-name">{displayName(replyingTo.profiles)}</span>
                  <span className="pnw-chat-input-banner-preview">{replyingTo.content.length > 60 ? replyingTo.content.slice(0, 60) + "…" : replyingTo.content}</span>
                  <button className="pnw-chat-input-banner-close" onClick={cancelReply}><FaXmark /></button>
                </div>
              )}
              {editingMsg && (
                <div className="pnw-chat-input-banner pnw-chat-input-banner--edit">
                  <FaPen className="pnw-chat-input-banner-icon" />
                  <span className="pnw-chat-input-banner-label">Modification du message</span>
                  <button className="pnw-chat-input-banner-close" onClick={cancelEditing}><FaXmark /></button>
                </div>
              )}
              {imagePreview && (
                <div className="pnw-chat-input-banner pnw-chat-input-banner--image">
                  <img src={imagePreview.url} alt="" className="pnw-chat-input-image-thumb" />
                  <span className="pnw-chat-input-banner-label">{imagePreview.file.name}</span>
                  <span className="pnw-chat-input-banner-preview">{(imagePreview.file.size / 1024).toFixed(0)} Ko</span>
                  <button className="pnw-chat-input-banner-close" onClick={() => { URL.revokeObjectURL(imagePreview.url); setImagePreview(null); }}><FaXmark /></button>
                </div>
              )}

              <div className="pnw-chat-input-wrap" style={activeMute ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
                <textarea
                  ref={inputRef}
                  className="pnw-chat-input"
                  placeholder={
                    activeMute ? "Tu es muté…"
                    : slowmodeCooldown > 0 ? `Mode lent — attends ${slowmodeCooldown}s…`
                    : `Envoyer un message dans #${getChannelDisplayName(activeChannel)}`
                  }
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={handleKeyDown}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const item of items) {
                      if (item.type.startsWith("image/")) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            alert("Image trop lourde (max 5 Mo)");
                          } else {
                            setImagePreview({ file, url: URL.createObjectURL(file) });
                          }
                        }
                        return;
                      }
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  disabled={!!activeMute || (slowmodeCooldown > 0 && !isMod)}
                />
                <div className="pnw-chat-input-actions">
                  {/* Slowmode cooldown timer */}
                  {slowmodeCooldown > 0 && !isMod && (
                    <span className="pnw-slowmode-timer">
                      <FaClock />
                      <span>{slowmodeCooldown}s</span>
                    </span>
                  )}
                  {/* Slowmode indicator (when active but not on cooldown) */}
                  {slowmodeActive && slowmodeCooldown === 0 && (
                    <span className="pnw-slowmode-indicator" title="Mode lent actif">
                      <FaGaugeHigh />
                    </span>
                  )}
                  {draft.length > 0 && (
                    <span className={`pnw-chat-char-count ${draft.length > 1800 ? "pnw-chat-char-count--danger" : draft.length > 1500 ? "pnw-chat-char-count--warn" : ""}`}>
                      {2000 - draft.length}
                    </span>
                  )}
                  <button
                    className="pnw-chat-image-upload-btn"
                    onClick={() => { loadPokedexData(); setShowPokemonPicker(true); }}
                    title="Envoyer une carte Pokémon"
                  >
                    <img src="/Poké_Ball_icon.png" alt="Pokédex" style={{ width: 18, height: 18, objectFit: "contain" }} />
                  </button>
                  <button
                    className="pnw-chat-image-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Envoyer une image"
                  >
                    <img src="/picture.png" alt="Image" style={{ width: 18, height: 18, objectFit: "contain", opacity: 0.6 }} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 5 * 1024 * 1024) {
                          alert("Image trop lourde (max 5 Mo)");
                        } else {
                          setImagePreview({ file, url: URL.createObjectURL(file) });
                        }
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="pnw-chat-send-btn"
                    onClick={handleSend}
                    disabled={(!draft.trim() && !imagePreview) || sending || (slowmodeCooldown > 0 && !isMod)}
                  >
                    {sending ? <FaSpinner className="pnw-chat-spinner" /> : <FaPaperPlane />}
                  </button>
                </div>
              </div>
              <span className="pnw-chat-input-hint">
                Entrée pour envoyer, Maj+Entrée pour un retour à la ligne
                {isMod && <span> · Tape <strong>/</strong> pour les commandes</span>}
              </span>
            </div>
            )}
          </>
        ) : (
          <div className="pnw-chat-empty-messages">
            <FaCommentDots style={{ fontSize: 48 }} />
            <h3>Bienvenue sur le Chat PNW</h3>
            <p>Sélectionne un salon pour commencer à discuter.</p>
          </div>
        )}
      </div>

      {/* ====== RIGHT: Members sidebar ====== */}
      {showMembers && activeChannel && activeChannel.type !== "dm" && (
        <div className="pnw-chat-members">
          <div className="pnw-chat-members-header">
            <FaUsers />
            <span>Joueurs — {activeChannel?.type === "moderation" ? allMembers.filter((m) => m.roles?.some((r) => ["admin", "devteam"].includes(r))).length : allMembers.length}</span>
          </div>
          <div className="pnw-chat-members-list pnw-scrollbar">
            {(() => {
              const channelMembers = (activeChannel?.type === "moderation"
                ? allMembers.filter((m) => m.roles?.some((r) => ["admin", "devteam"].includes(r)))
                : allMembers
              ).filter((m) => !bannedUsersSet.has(m.id));

              const online = channelMembers.filter((m) => onlineUserIds.has(m.id));
              const offline = channelMembers.filter((m) => !onlineUserIds.has(m.id));

              // Group by highest role
              const roleOrder = ["admin", "devteam", "patreon", "vip"];
              function groupByRole(members: ChatProfile[]) {
                const groups: { role: string; label: string; color: string; members: ChatProfile[] }[] = [];
                const assigned = new Set<string>();
                for (const r of roleOrder) {
                  const badge = ROLE_BADGE[r];
                  if (!badge) continue;
                  const inRole = members.filter((m) => m.roles?.includes(r) && !assigned.has(m.id));
                  if (inRole.length) {
                    inRole.forEach((m) => assigned.add(m.id));
                    groups.push({ role: r, label: badge.label, color: badge.bg, members: inRole });
                  }
                }
                const noRole = members.filter((m) => !assigned.has(m.id));
                if (noRole.length) groups.push({ role: "member", label: "Membres", color: "rgba(255,255,255,.4)", members: noRole });
                return groups;
              }

              function renderMember(m: ChatProfile, isOnline: boolean) {
                const isMuted = mutedUsersMap.has(m.id);
                const glow = roleGlow(m.roles);
                const bio = (m as any).bio || "";
                const statusText = bio.length > 28 ? bio.slice(0, 28) + "…" : bio;
                const live = gameLivePlayers.get(m.id);
                const ls = live?.liveStatus;
                const isPlaying = !!(ls?.gameActive || live?.gameState?.active);
                const inBattle = !!(ls?.inBattle || live?.gameState?.in_battle);
                const mapName = ls?.mapName || live?.gameState?.map_name || "";
                return (
                  <button
                    key={m.id}
                    className={`pnw-chat-member${!isOnline ? " pnw-chat-member--offline" : ""}${isMuted ? " pnw-chat-member--muted" : ""}`}
                    onClick={() => openProfile(m)}
                  >
                    <div className="pnw-chat-member-avatar-wrap">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt="" className="pnw-chat-member-avatar" style={glow} />
                      ) : (
                        <div className="pnw-chat-member-avatar pnw-chat-avatar--placeholder" style={glow}>
                          {displayName(m)[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className={`pnw-chat-member-status pnw-chat-member-status--${isOnline ? "online" : "offline"}`} />
                    </div>
                    <div className="pnw-chat-member-info">
                      <span className={`pnw-chat-member-name${isMuted ? " pnw-chat-member-name--muted" : ""}`} style={roleColor(m.roles) ? { color: roleColor(m.roles) } : undefined}>
                        {displayName(m)}
                        {isMuted && isMod && <FaVolumeXmark style={{ fontSize: 9, opacity: 0.4, marginLeft: 4 }} />}
                      </span>
                      {statusText && !isPlaying && (
                        <span className="pnw-chat-member-status-text">{statusText}</span>
                      )}
                      {isPlaying && (
                        <div className={`pnw-chat-member-activity${inBattle ? " pnw-chat-member-activity--battle" : ""}`}>
                          <FaGamepad className="pnw-chat-member-activity-ico" />
                          <span className="pnw-chat-member-activity-txt">
                            {inBattle ? "En combat" : mapName || "En jeu"}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              }

              const onlineGroups = groupByRole(online);
              const offlineGroups = groupByRole(offline);

              return (
                <>
                  {online.length > 0 && (
                    <>
                      <div className="pnw-chat-members-section-label">
                        <FaCircle style={{ color: "#2ecc71", fontSize: 8 }} />
                        En ligne — {online.length}
                      </div>
                      {onlineGroups.map((g) => (
                        <div key={`on-${g.role}`} className="pnw-chat-members-group">
                          <div className="pnw-chat-members-group-label" style={{ color: g.color }}>
                            {ROLE_BADGE[g.role]?.icon}
                            <span>{g.label} — {g.members.length}</span>
                          </div>
                          {g.members.map((m) => renderMember(m, true))}
                        </div>
                      ))}
                    </>
                  )}
                  {offline.length > 0 && (
                    <>
                      <div className="pnw-chat-members-section-label pnw-chat-members-section-label--offline">
                        <FaCircle style={{ color: "rgba(255,255,255,.25)", fontSize: 8 }} />
                        Hors ligne — {offline.length}
                      </div>
                      {offlineGroups.map((g) => (
                        <div key={`off-${g.role}`} className="pnw-chat-members-group">
                          <div className="pnw-chat-members-group-label" style={{ color: g.color, opacity: 0.5 }}>
                            {ROLE_BADGE[g.role]?.icon}
                            <span>{g.label} — {g.members.length}</span>
                          </div>
                          {g.members.map((m) => renderMember(m, false))}
                        </div>
                      ))}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ====== Pinned messages popup ====== */}
      {showPinnedPanel && (
        <div className="pnw-chat-profile-overlay" onClick={() => setShowPinnedPanel(false)}>
          <div className="pnw-pinned-panel" onClick={(e) => e.stopPropagation()}>
            <div className="pnw-pinned-header">
              <FaThumbtack className="pnw-pinned-header-icon" />
              <span>Messages épinglés</span>
              <span className="pnw-pinned-count">{pinnedMessages.length}</span>
              <button className="pnw-chat-profile-close" onClick={() => setShowPinnedPanel(false)}>
                <FaXmark />
              </button>
            </div>
            <div className="pnw-pinned-list pnw-scrollbar">
              {pinnedLoading ? (
                <div className="pnw-pinned-loading"><FaSpinner className="pnw-spin" /> Chargement…</div>
              ) : pinnedMessages.length === 0 ? (
                <div className="pnw-pinned-empty">
                  <FaThumbtack />
                  <p>Aucun message épinglé</p>
                  <span>Les messages épinglés apparaîtront ici</span>
                </div>
              ) : (
                pinnedMessages.map((msg) => {
                  const author = msg.profiles;
                  const nameCol = roleColor(author?.roles || []);
                  // Detect special content types
                  const isGts = msg.content.startsWith(GTS_PREFIX);
                  const isPoke = msg.content.startsWith(POKEMON_PREFIX);
                  const isActivity = msg.content.startsWith(ACTIVITY_PREFIX);
                  const isTrade = msg.content.startsWith(TRADE_PREFIX);
                  // Extract image URLs from content
                  const imageRe = /https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/gi;
                  const images = (!isGts && !isPoke && !isActivity && !isTrade) ? (msg.content.match(imageRe) || []) : [];
                  // Build display text
                  let displayText = msg.content;
                  if (isGts) {
                    try { const g = JSON.parse(msg.content.slice(GTS_PREFIX.length)); displayText = `🔄 Échange GTS #${g.onlineId ?? ""} — ${g.deposited?.name ?? "?"} ↔ ${g.wanted?.name ?? "?"}`; } catch { displayText = "🔄 Échange GTS"; }
                  } else if (isPoke) {
                    try { const p = JSON.parse(msg.content.slice(POKEMON_PREFIX.length)); displayText = `🎴 ${p.speciesName ?? p.nickname ?? "Pokémon"} Nv.${p.level ?? "?"}${p.isShiny ? " ✨" : ""}`; } catch { displayText = "🎴 Carte Pokémon"; }
                  } else if (isActivity) {
                    try { const a = JSON.parse(msg.content.slice(ACTIVITY_PREFIX.length)); displayText = `🎮 ${a.targetName} — ${a.inBattle ? "En combat" : a.mapName || "En jeu"}`; } catch { displayText = "🎮 Activité"; }
                  } else if (isTrade) {
                    try { const t = JSON.parse(msg.content.slice(TRADE_PREFIX.length)); displayText = `🔁 Échange — ${t.playerA?.pokemon?.name ?? "?"} ↔ ${t.playerB?.pokemon?.name ?? "?"}`; } catch { displayText = "🔁 Échange P2P"; }
                  } else {
                    // Strip image URLs from text display (they show as thumbnails)
                    displayText = images.reduce((t, url) => t.replace(url, "").trim(), displayText).trim();
                  }
                  return (
                    <button
                      key={msg.id}
                      className="pnw-pinned-msg"
                      onClick={() => {
                        setShowPinnedPanel(false);
                        const el = document.getElementById(`msg-${msg.id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          el.classList.add("pnw-chat-msg--highlight");
                          setTimeout(() => el.classList.remove("pnw-chat-msg--highlight"), 2000);
                        }
                      }}
                    >
                      <div className="pnw-pinned-msg-header">
                        {author?.avatar_url ? (
                          <img src={author.avatar_url} alt="" className="pnw-pinned-msg-avatar" />
                        ) : (
                          <div className="pnw-pinned-msg-avatar pnw-chat-avatar--placeholder">
                            {displayName(author)?.[0]?.toUpperCase() || "?"}
                          </div>
                        )}
                        <span className="pnw-pinned-msg-author" style={nameCol ? { color: nameCol } : undefined}>
                          {displayName(author)}
                        </span>
                        <span className="pnw-pinned-msg-time">{new Date(msg.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à {new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {displayText && <div className="pnw-pinned-msg-content">{displayText}</div>}
                      {images.length > 0 && (
                        <div className="pnw-pinned-msg-images">
                          {images.slice(0, 3).map((url, i) => (
                            <img key={i} src={url} alt="" className="pnw-pinned-msg-thumb" loading="lazy" />
                          ))}
                          {images.length > 3 && <span className="pnw-pinned-msg-more">+{images.length - 3}</span>}
                        </div>
                      )}
                      {(isGts || isPoke) && <div className="pnw-pinned-msg-badge">{isGts ? "GTS" : "Pokémon"}</div>}
                      {(isMod || profile?.roles?.includes("devteam")) && (
                        <span
                          className="pnw-pinned-msg-unpin"
                          role="button"
                          onClick={(e) => { e.stopPropagation(); handleTogglePin(msg); }}
                          title="Désépingler"
                        >
                          <FaXmark />
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== Leaderboard popup ====== */}
      {showLeaderboard && (() => {
        const sorted = [...leaderboardData].sort((a, b) =>
          lbTab === "pokedex" ? b.pokedex_count - a.pokedex_count : b.shinydex_count - a.shinydex_count,
        );
        const getScore = (e: LeaderboardEntry) => lbTab === "pokedex" ? e.pokedex_count : e.shinydex_count;
        const podium = sorted.slice(0, 3);
        const rest = sorted.slice(3);

        function renderPodiumSlot(idx: number) {
          const e = podium[idx];
          if (!e) return null;
          const p = e.profiles;
          const name = p.display_name?.trim() || p.username || "?";
          const nc = roleColor(p.roles ?? []);
          const heights = [100, 72, 52];
          return (
            <div key={e.user_id} className={`pnw-lb-pod pnw-lb-pod--${idx + 1}`}>
              <div className="pnw-lb-pod-avi-wrap">
                <div className={`pnw-lb-pod-ring pnw-lb-pod-ring--${idx + 1}`}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="pnw-lb-pod-avi" />
                    : <div className="pnw-lb-pod-avi pnw-chat-avatar--placeholder">{name[0]?.toUpperCase()}</div>}
                </div>
                <span className={`pnw-lb-pod-badge pnw-lb-pod-badge--${idx + 1}`}>{idx === 0 ? <FaCrown size={9} /> : idx + 1}</span>
              </div>
              <span className="pnw-lb-pod-name" style={nc ? { color: nc } : undefined}>{name}</span>
              <span className="pnw-lb-pod-val">{getScore(e)}</span>
              {lbTab === "shiny" && (e.shiny_total ?? 0) > 0 && <span className="pnw-lb-pod-sub">{e.shiny_total} total</span>}
              <div className="pnw-lb-pod-bar" style={{ height: heights[idx] }} />
            </div>
          );
        }

        return (
          <div className="pnw-lb-overlay" onClick={() => setShowLeaderboard(false)}>
            <div className="pnw-lb" onClick={(e) => e.stopPropagation()}>
              {/* Banner */}
              <div className="pnw-lb-banner">
                <div className="pnw-lb-banner-bg" />
                <button className="pnw-lb-close" onClick={() => setShowLeaderboard(false)}><FaXmark /></button>
                <FaTrophy className="pnw-lb-trophy" />
                <h2 className="pnw-lb-title">Classement</h2>
              </div>

              {/* Tabs */}
              <div className="pnw-lb-tabs">
                <button className={`pnw-lb-tab${lbTab === "pokedex" ? " on" : ""}`} onClick={() => setLbTab("pokedex")}>
                  <FaBookOpen size={11} /> Pokédex
                </button>
                <button className={`pnw-lb-tab${lbTab === "shiny" ? " on" : ""}`} onClick={() => setLbTab("shiny")}>
                  <FaStar size={11} /> ShinyDex
                </button>
              </div>

              {lbLoading ? (
                <div className="pnw-lb-loading"><FaSpinner className="fa-spin" size={18} /></div>
              ) : (
                <>
                  {/* Podium */}
                  {podium.length > 0 && (
                    <div className="pnw-lb-podium">
                      {renderPodiumSlot(1)}
                      {renderPodiumSlot(0)}
                      {renderPodiumSlot(2)}
                    </div>
                  )}

                  {/* Rest */}
                  {rest.length > 0 && (
                    <div className="pnw-lb-list pnw-scrollbar">
                      {rest.map((entry, i) => {
                        const rank = i + 4;
                        const p = entry.profiles;
                        const name = p.display_name?.trim() || p.username || "Joueur";
                        const sec = entry.play_time_sec ?? 0;
                        const h = Math.floor(sec / 3600);
                        const timeStr = h > 0 ? `${h}h` : `${Math.floor(sec / 60)}min`;
                        const nc = roleColor(p.roles ?? []);
                        const gl = roleGlow(p.roles ?? []);
                        const isSelf = session?.user?.id === entry.user_id;
                        return (
                          <div key={entry.user_id} className={`pnw-lb-row${isSelf ? " pnw-lb-row--me" : ""}`}>
                            <span className="pnw-lb-row-rank">{rank}</span>
                            <div className="pnw-lb-row-avi">
                              {p.avatar_url
                                ? <img src={p.avatar_url} alt="" style={gl} />
                                : <div className="pnw-chat-avatar--placeholder" style={{ width: 30, height: 30, fontSize: 12, ...gl }}>{name[0]?.toUpperCase()}</div>}
                            </div>
                            <div className="pnw-lb-row-info">
                              <span className="pnw-lb-row-name" style={nc ? { color: nc } : undefined}>{name}</span>
                              <span className="pnw-lb-row-sub">{timeStr} · {(entry.money ?? 0).toLocaleString("fr-FR")}₽{lbTab === "shiny" && (entry.shiny_total ?? 0) > 0 ? ` · ${entry.shiny_total} total` : ""}</span>
                            </div>
                            <span className="pnw-lb-row-val">{getScore(entry)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Admin panel */}
      {showAdmin && (
        <AdminPanel
          onClose={() => setShowAdmin(false)}
          onLog={sendLog}
          onMemberUpdate={(userId, fields) => {
            // Update allMembers (sidebar, mentions, etc.)
            setAllMembers((prev) => prev.map((m) => m.id === userId ? { ...m, ...fields } : m));
            // Update messages that reference this user
            setMessages((prev) => prev.map((m) => m.user_id === userId && m.profiles ? { ...m, profiles: { ...m.profiles, ...fields } } : m));
            // Update DM partners
            if (fields.display_name !== undefined || fields.avatar_url !== undefined) {
              setDmPartners((prev) => {
                const next = { ...prev };
                for (const [chId, p] of Object.entries(next)) {
                  // We can't know which partner matches by userId from dmPartners alone,
                  // so update all partners whose name might match — safer: update via allMembers lookup
                }
                return next;
              });
              // Simpler: re-fetch DM partners
              const dmChannelsList = channels.filter((c) => c.type === "dm");
              if (dmChannelsList.length && session) {
                Promise.all(
                  dmChannelsList.map(async (ch) => {
                    const { data: members } = await supabase
                      .from("channel_members")
                      .select("user_id, profiles(username, display_name, avatar_url)")
                      .eq("channel_id", ch.id)
                      .neq("user_id", session.user.id)
                      .limit(1);
                    const prof = (members?.[0] as any)?.profiles;
                    return { id: ch.id, name: prof?.username || "DM", displayName: prof?.display_name || null, avatar: prof?.avatar_url || null };
                  })
                ).then((results) => {
                  const map: Record<number, { name: string; avatar: string | null; displayName: string | null }> = {};
                  results.forEach((r) => (map[r.id] = { name: r.name, avatar: r.avatar, displayName: r.displayName }));
                  setDmPartners(map);
                });
              }
            }
            // Update friends list profiles
            setFriendsList((prev) => prev.map((f) =>
              f.profiles && f.profiles.id === userId ? { ...f, profiles: { ...f.profiles, ...fields } } : f
            ));
          }}
        />
      )}

      {/* Friends & Blocked panel */}
      {showFriendsPanel && session && (() => {
        const FriendsPanel = () => {
          const [tab, setTab] = useState<"friends" | "blocked">("friends");
          const pendingIn = friendsList.filter((f) => f.status === "pending" && f.friend_id === session!.user.id);
          const pendingOut = friendsList.filter((f) => f.status === "pending" && f.user_id === session!.user.id);
          const accepted = friendsList.filter((f) => f.status === "accepted");
          const blockedList = Array.from(blockedUsersMap.entries()).map(([userId, blockId]) => {
            const p = allMembers.find((m) => m.id === userId);
            return { blockId, profile: p, userId };
          });

          return (
            <div className="pnw-chat-profile-overlay" onClick={() => setShowFriendsPanel(false)}>
              <div className="pnw-chat-friends-panel" onClick={(e) => e.stopPropagation()}>
                <div className="pnw-chat-friends-header">
                  <FaUserGroup /> <span>Relations</span>
                  <button className="pnw-chat-profile-close" onClick={() => setShowFriendsPanel(false)}><FaXmark /></button>
                </div>
                {/* Tabs */}
                <div className="pnw-chat-friends-tabs">
                  <button className={`pnw-chat-friends-tab ${tab === "friends" ? "pnw-chat-friends-tab--active" : ""}`} onClick={() => setTab("friends")}>
                    <FaUserGroup /> Amis {accepted.length > 0 && <span className="pnw-chat-friends-tab-count">{accepted.length}</span>}
                    {pendingIn.length > 0 && <span className="pnw-chat-friends-tab-badge">{pendingIn.length}</span>}
                  </button>
                  <button className={`pnw-chat-friends-tab ${tab === "blocked" ? "pnw-chat-friends-tab--active" : ""}`} onClick={() => setTab("blocked")}>
                    <FaBan /> Bloqués {blockedList.length > 0 && <span className="pnw-chat-friends-tab-count">{blockedList.length}</span>}
                  </button>
                </div>
                <div className="pnw-chat-friends-content pnw-scrollbar">
                  {tab === "friends" && (
                    <>
                      {/* Pending received */}
                      {pendingIn.length > 0 && (
                        <div className="pnw-chat-friends-section">
                          <div className="pnw-chat-friends-section-label"><FaBell /> Demandes reçues — {pendingIn.length}</div>
                          {pendingIn.map((f) => (
                            <div key={f.id} className="pnw-chat-friend-item">
                              <div className="pnw-chat-friend-avatar">
                                {f.profiles?.avatar_url ? <img src={f.profiles.avatar_url} alt="" /> : <div className="pnw-chat-avatar--placeholder">{(f.profiles?.display_name || f.profiles?.username || "?")[0].toUpperCase()}</div>}
                              </div>
                              <span className="pnw-chat-friend-name" style={roleColor(f.profiles?.roles || []) ? { color: roleColor(f.profiles?.roles || []) } : undefined}>
                                {f.profiles?.display_name || f.profiles?.username || "Joueur"}
                              </span>
                              <div className="pnw-chat-friend-actions">
                                <button className="pnw-chat-friend-accept" onClick={async () => { await acceptFriendRequest(f.id); getFriends(session!.user.id).then(setFriendsList); }} title="Accepter"><FaUserCheck /></button>
                                <button className="pnw-chat-friend-decline" onClick={async () => { await removeFriend(f.id); getFriends(session!.user.id).then(setFriendsList); }} title="Refuser"><FaXmark /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Pending sent */}
                      {pendingOut.length > 0 && (
                        <div className="pnw-chat-friends-section">
                          <div className="pnw-chat-friends-section-label"><FaClock /> Demandes envoyées — {pendingOut.length}</div>
                          {pendingOut.map((f) => (
                            <div key={f.id} className="pnw-chat-friend-item">
                              <div className="pnw-chat-friend-avatar">
                                {f.profiles?.avatar_url ? <img src={f.profiles.avatar_url} alt="" /> : <div className="pnw-chat-avatar--placeholder">{(f.profiles?.display_name || f.profiles?.username || "?")[0].toUpperCase()}</div>}
                              </div>
                              <span className="pnw-chat-friend-name">{f.profiles?.display_name || f.profiles?.username || "Joueur"}</span>
                              <button className="pnw-chat-friend-decline" onClick={async () => { await removeFriend(f.id); getFriends(session!.user.id).then(setFriendsList); }} title="Annuler"><FaXmark /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Accepted */}
                      <div className="pnw-chat-friends-section">
                        <div className="pnw-chat-friends-section-label"><FaHeart /> Amis — {accepted.length}</div>
                        {accepted.length === 0 && <div className="pnw-chat-friends-empty">Aucun ami pour le moment</div>}
                        {accepted.map((f) => {
                          const fp = f.profiles;
                          const isOnline = fp ? onlineUserIds.has(fp.id) : false;
                          return (
                            <div key={f.id} className="pnw-chat-friend-item">
                              <div className="pnw-chat-friend-avatar">
                                {fp?.avatar_url ? <img src={fp.avatar_url} alt="" style={roleGlow(fp?.roles || [])} /> : <div className="pnw-chat-avatar--placeholder">{(fp?.display_name || "?")[0].toUpperCase()}</div>}
                                <span className={`pnw-chat-member-status pnw-chat-member-status--${isOnline ? "online" : "offline"}`} />
                              </div>
                              <span className="pnw-chat-friend-name" style={roleColor(fp?.roles || []) ? { color: roleColor(fp?.roles || []) } : undefined}>
                                {fp?.display_name || fp?.username || "Joueur"}
                              </span>
                              <div className="pnw-chat-friend-actions">
                                <button className="pnw-chat-friend-dm" onClick={() => { if (fp) { setShowFriendsPanel(false); handleDmFromProfile(fp as ChatProfile); } }} title="Message"><FaEnvelope /></button>
                                <button className="pnw-chat-friend-decline" onClick={async () => { await removeFriend(f.id); getFriends(session!.user.id).then(setFriendsList); }} title="Supprimer"><FaTrash /></button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {tab === "blocked" && (
                    <div className="pnw-chat-friends-section">
                      <div className="pnw-chat-friends-section-label"><FaBan /> Utilisateurs bloqués — {blockedList.length}</div>
                      {blockedList.length === 0 && <div className="pnw-chat-friends-empty">Aucun utilisateur bloqué</div>}
                      {blockedList.map(({ blockId, profile: bp, userId }) => (
                        <div key={blockId} className="pnw-chat-friend-item">
                          <div className="pnw-chat-friend-avatar">
                            {bp?.avatar_url ? <img src={bp.avatar_url} alt="" /> : <div className="pnw-chat-avatar--placeholder">{(bp?.display_name || bp?.username || "?")[0].toUpperCase()}</div>}
                          </div>
                          <span className="pnw-chat-friend-name" style={{ color: "rgba(255,255,255,.5)" }}>
                            {bp?.display_name || bp?.username || "Utilisateur"}
                          </span>
                          <button
                            className="pnw-chat-friend-accept"
                            onClick={async () => {
                              await unblockUser(blockId);
                              getBlockedUsers(session!.user.id).then((blocks) => {
                                setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
                                setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
                              });
                            }}
                            title="Débloquer"
                          >
                            <FaUserCheck />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        };
        return <FriendsPanel />;
      })()}

      {/* Profile popup */}
      {profilePopup && !editingProfile && !showMuteModal && !showBanModal && (
        <ProfileCard
          target={profilePopup}
          isOwn={profilePopup.id === session?.user?.id}
          isMod={isMod}
          myRoles={profile?.roles || []}
          targetMute={mutedUsersMap.get(profilePopup.id) || null}
          friendship={profileFriendship}
          isBlocked={blockedUserIds.has(profilePopup.id)}
          gameState={gameLivePlayers.get(profilePopup.id)?.gameState || null}
          liveStatus={gameLivePlayers.get(profilePopup.id)?.liveStatus || null}
          dexEntries={[...pokedexEntries, ...extradexEntries]}
          siteUrl={siteUrl}
          psdkNames={psdkNames}
          installDir={installDir}
          lastSavePath={lastSavePath}
          gameProfile={gameProfile}
          onShareActivity={(data) => setActivityShareData(data)}
          canTrade={
            profilePopup.id !== session?.user?.id &&
            tradeState.phase === "idle" &&
            !!lastSavePath &&
            onlineUserIds.has(profilePopup.id) &&
            friendsList.some((f) => f.status === "accepted" && (f.user_id === profilePopup.id || f.friend_id === profilePopup.id))
          }
          onProposeTrade={async () => {
            if (!session?.user?.id || !profile) return;
            // Vérifier que le jeu n'est pas en cours
            try {
              const running = await invoke<boolean>("cmd_is_game_running");
              if (running) {
                setTradeState({ phase: "error", tradeId: "", partnerId: "", partnerName: "", message: "Fermez le jeu avant de proposer un échange." });
                return;
              }
            } catch {}
            const tradeId = generateTradeId();
            const targetId = profilePopup.id;
            // Find existing DM with this specific user
            let dmChannelId = 0;
            for (const c of channels) {
              if (c.type !== "dm") continue;
              const partner = dmPartners[c.id];
              if (!partner) continue;
              // Check if this DM's partner is the target user
              const { data: members } = await supabase.from("channel_members").select("user_id").eq("channel_id", c.id);
              if (members?.some((m: any) => m.user_id === targetId)) {
                dmChannelId = c.id;
                break;
              }
            }
            // Create DM if it doesn't exist
            if (!dmChannelId) {
              try {
                const { data } = await supabase.rpc("create_dm_channel", { target_user_id: targetId });
                if (data) {
                  dmChannelId = data;
                  // Reload channels to include the new DM
                  const { data: chs } = await supabase.from("channels").select("*").order("created_at", { ascending: true });
                  if (chs) setChannels(chs);
                }
              } catch {}
            }
            if (!dmChannelId) return;
            // Navigate to the DM channel
            const dmCh = channels.find((c) => c.id === dmChannelId) || { id: dmChannelId, name: null, type: "dm" as const, background_url: null, slowmode_seconds: 0, created_at: "" };
            setActiveChannel(dmCh);
            // Send trade request via broadcast
            gameLiveRef2.current?.send({
              type: "broadcast",
              event: "trade_request",
              payload: {
                tradeId,
                fromId: session.user.id,
                fromName: profile.display_name || profile.username,
                fromAvatar: profile.avatar_url,
                toId: targetId,
                dmChannelId,
                saveId: gameProfile?.rawTrainerId ?? 0,
              },
            });
            setTradeState({
              phase: "pending",
              role: "initiator",
              tradeId,
              partnerId: profilePopup.id,
              partnerName: profilePopup.display_name || profilePopup.username,
              partnerAvatar: profilePopup.avatar_url,
              dmChannelId,
              startedAt: Date.now(),
            });
          }}
          canBattle={
            profilePopup.id !== session?.user?.id &&
            battleState.phase === "idle" &&
            tradeState.phase === "idle" &&
            onlineUserIds.has(profilePopup.id) &&
            friendsList.some((f) => f.status === "accepted" && (f.user_id === profilePopup.id || f.friend_id === profilePopup.id))
          }
          onProposeBattle={async () => {
            if (!session?.user?.id || !profile) return;
            const roomCode = generateRoomCode();
            const targetId = profilePopup.id;
            // Find or create DM
            let dmChannelId = 0;
            for (const c of channels) {
              if (c.type !== "dm") continue;
              const { data: members } = await supabase.from("channel_members").select("user_id").eq("channel_id", c.id);
              if (members?.some((m: any) => m.user_id === targetId)) { dmChannelId = c.id; break; }
            }
            if (!dmChannelId) {
              try {
                const { data } = await supabase.rpc("create_dm_channel", { target_user_id: targetId });
                if (data) { dmChannelId = data; const { data: chs } = await supabase.from("channels").select("*").order("created_at", { ascending: true }); if (chs) setChannels(chs); }
              } catch {}
            }
            if (!dmChannelId) return;
            const dmCh = channels.find((c) => c.id === dmChannelId) || { id: dmChannelId, name: null, type: "dm" as const, background_url: null, slowmode_seconds: 0, created_at: "" };
            setActiveChannel(dmCh);
            // ─── Send invite via Railway Socket.io lobby ───
            const sent = sendBattleInvite({ roomCode, fromId: session.user.id, fromName: profile.display_name || profile.username, fromAvatar: profile.avatar_url, toId: targetId, dmChannelId });
            if (!sent) return;

            setBattleState({
              phase: "inviting",
              roomCode,
              partnerId: profilePopup.id,
              partnerName: profilePopup.display_name || profilePopup.username,
              partnerAvatar: profilePopup.avatar_url,
              dmChannelId,
              startedAt: Date.now(),
            });
            battleTimeoutRef.current = setTimeout(() => {
              setBattleState((prev) => prev.phase === "inviting" ? { phase: "idle" } : prev);
            }, BATTLE_INVITE_TIMEOUT);
          }}
          onClose={() => setProfilePopup(null)}
          onEdit={() => setEditingProfile(true)}
          onSendDm={() => handleDmFromProfile(profilePopup)}
          onMute={() => { setShowMuteModal(profilePopup); setProfilePopup(null); }}
          onUnmute={async () => {
            const mute = mutedUsersMap.get(profilePopup.id);
            if (mute) {
              await unmuteUser(mute.id);
              sendLog({ type: "unmute", modName: displayName(profile), modAvatar: profile?.avatar_url, modId: session!.user.id, targetName: displayName(profilePopup), targetAvatar: profilePopup.avatar_url, targetId: profilePopup.id });
              getMutedUserIds().then((m) => setMutedUsersMap(m));
              setProfilePopup(null);
            }
          }}
          onBan={() => { setShowBanModal(profilePopup); setProfilePopup(null); }}
          onBlock={async () => {
            await blockUser(profilePopup.id);
            getBlockedUsers(session!.user.id).then((blocks) => {
              setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
              setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
            });
            setProfilePopup(null);
          }}
          onUnblock={async () => {
            const blockId = blockedUsersMap.get(profilePopup.id);
            if (blockId) {
              await unblockUser(blockId);
              getBlockedUsers(session!.user.id).then((blocks) => {
                setBlockedUserIds(new Set(blocks.map((b) => b.blocked_id)));
                setBlockedUsersMap(new Map(blocks.map((b) => [b.blocked_id, b.id])));
              });
            }
            setProfilePopup(null);
          }}
          onAddFriend={async () => {
            await sendFriendRequest(profilePopup.id);
            getFriendship(session!.user.id, profilePopup.id).then(setProfileFriendship);
            getFriends(session!.user.id).then(setFriendsList);
          }}
          onAcceptFriend={async () => {
            if (profileFriendship) {
              await acceptFriendRequest(profileFriendship.id);
              getFriendship(session!.user.id, profilePopup.id).then(setProfileFriendship);
              getFriends(session!.user.id).then(setFriendsList);
            }
          }}
          onRemoveFriend={async () => {
            if (profileFriendship) {
              await removeFriend(profileFriendship.id);
              setProfileFriendship(null);
              getFriends(session!.user.id).then(setFriendsList);
            }
          }}
        />
      )}

      {/* Edit profile modal */}
      {editingProfile && profile && (
        <EditProfile
          profile={profile}
          onClose={() => { setEditingProfile(false); setProfilePopup(null); }}
          onSaved={handleProfileSaved}
        />
      )}

      {/* Mute modal */}
      {showMuteModal && session && (
        <MuteModal
          target={showMuteModal}
          moderatorId={session.user.id}
          onClose={() => setShowMuteModal(null)}
          onDone={() => { setShowMuteModal(null); getMutedUserIds().then((m) => setMutedUsersMap(m)); }}
          onLog={(entry) => sendLog({ ...entry, modName: displayName(profile), modAvatar: profile?.avatar_url })}
        />
      )}

      {/* Ban modal */}
      {showBanModal && session && (
        <BanModal
          target={showBanModal}
          moderatorId={session.user.id}
          onClose={() => setShowBanModal(null)}
          onLog={(entry) => sendLog({ ...entry, modName: displayName(profile), modAvatar: profile?.avatar_url })}
          onDone={() => {
            setShowBanModal(null);
            getBannedUserIds().then((s) => setBannedUsersSet(s));
            // Recharger les messages (les messages du banni ont été supprimés)
            if (activeChannel) {
              setMessages([]);
              setActiveChannel({ ...activeChannel });
            }
          }}
        />
      )}

      {/* GTS Share modal — choose channel */}
      {showGtsShareModal && gtsSharePending && session && (
        <div className="pnw-chat-profile-overlay" onClick={() => { setShowGtsShareModal(false); onGtsShareDone?.(); }}>
          <div className="pnw-chat-gts-share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pnw-chat-gts-share-modal-header">
              <FaShareNodes /> <span>Partager l'échange GTS</span>
              <button className="pnw-chat-profile-close" onClick={() => { setShowGtsShareModal(false); onGtsShareDone?.(); }}><FaXmark /></button>
            </div>
            {/* Preview */}
            <div className="pnw-chat-gts-share-preview">
              <div className="pnw-chat-gts-share-preview-poke">
                {gtsSharePending.deposited.sprite && <img src={gtsSharePending.deposited.sprite} alt="" />}
                <span>{gtsSharePending.deposited.name}</span>
              </div>
              <FaArrowRightFromBracket style={{ transform: "rotate(180deg)", opacity: 0.3 }} />
              <div className="pnw-chat-gts-share-preview-poke">
                {gtsSharePending.wanted?.sprite && <img src={gtsSharePending.wanted.sprite} alt="" />}
                <span>{gtsSharePending.wanted?.name || "?"}</span>
              </div>
            </div>
            {/* Channel list */}
            <div className="pnw-chat-gts-share-label">Envoyer dans :</div>
            <div className="pnw-chat-gts-share-channels pnw-scrollbar">
              {channels.filter((c) => c.type === "public").map((ch) => (
                <button key={ch.id} className="pnw-chat-gts-share-ch" onClick={async () => {
                  await supabase.from("messages").insert({ channel_id: ch.id, user_id: session.user.id, content: GTS_PREFIX + JSON.stringify(gtsSharePending) });
                  setShowGtsShareModal(false); onGtsShareDone?.();
                }}>
                  <FaMessage /> <span>#{ch.name}</span>
                </button>
              ))}
              {channels.filter((c) => c.type === "dm").length > 0 && (
                <div className="pnw-chat-gts-share-divider">Messages privés</div>
              )}
              {channels.filter((c) => c.type === "dm").map((ch) => {
                const partner = dmPartners[ch.id];
                return (
                  <button key={ch.id} className="pnw-chat-gts-share-ch" onClick={async () => {
                    await supabase.from("messages").insert({ channel_id: ch.id, user_id: session.user.id, content: GTS_PREFIX + JSON.stringify(gtsSharePending) });
                    setShowGtsShareModal(false); onGtsShareDone?.();
                  }}>
                    <FaEnvelope /> <span>{partner?.displayName || partner?.name || "DM"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Activity share modal */}
      {activityShareData && session && (
        <div className="pnw-chat-profile-overlay" onClick={() => setActivityShareData(null)}>
          <div className="pnw-chat-gts-share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pnw-chat-gts-share-modal-header">
              <FaGamepad /> <span>Partager l'activité</span>
              <button className="pnw-chat-profile-close" onClick={() => setActivityShareData(null)}><FaXmark /></button>
            </div>
            <div className="pnw-chat-activity-share-preview">
              <div className="pnw-chat-activity-share-player">
                {activityShareData.targetAvatar && <img src={activityShareData.targetAvatar} alt="" className="pnw-chat-activity-share-avatar" />}
                <div>
                  <div className="pnw-chat-activity-share-name">{activityShareData.targetName}</div>
                  <div className={`pnw-chat-activity-share-status${activityShareData.inBattle ? " pnw-chat-activity-share-status--battle" : ""}`}>
                    <FaGamepad /> {activityShareData.inBattle ? "En combat" : activityShareData.mapName || "En jeu"}
                  </div>
                </div>
              </div>
              {activityShareData.party.length > 0 && (
                <div className="pnw-chat-activity-share-party">
                  {activityShareData.party.map((pk, i) => (
                    <span key={i} className="pnw-chat-activity-share-poke">
                      {pk.altShiny && <FaStar style={{ fontSize: 6, color: "#c084fc" }} />}
                      {pk.shiny && !pk.altShiny && <FaStar style={{ fontSize: 6, color: "#f1c40f" }} />}
                      {pk.species} Nv.{pk.level}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="pnw-chat-gts-share-label">Envoyer dans :</div>
            <div className="pnw-chat-gts-share-channels pnw-scrollbar">
              {channels.filter((c) => c.type === "public").map((ch) => (
                <button key={ch.id} className="pnw-chat-gts-share-ch" onClick={async () => {
                  await supabase.from("messages").insert({ channel_id: ch.id, user_id: session.user.id, content: ACTIVITY_PREFIX + JSON.stringify(activityShareData) });
                  setActivityShareData(null);
                }}>
                  <FaMessage /> <span>#{ch.name}</span>
                </button>
              ))}
              {channels.filter((c) => c.type === "dm").length > 0 && (
                <div className="pnw-chat-gts-share-divider">Messages privés</div>
              )}
              {channels.filter((c) => c.type === "dm").map((ch) => {
                const partner = dmPartners[ch.id];
                return (
                  <button key={ch.id} className="pnw-chat-gts-share-ch" onClick={async () => {
                    await supabase.from("messages").insert({ channel_id: ch.id, user_id: session.user.id, content: ACTIVITY_PREFIX + JSON.stringify(activityShareData) });
                    setActivityShareData(null);
                  }}>
                    <FaEnvelope /> <span>{partner?.displayName || partner?.name || "DM"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Clear modal */}
      {showClearModal && activeChannel && session && isMod && (() => {
        const ClearModal = () => {
          const [clearMode, setClearMode] = useState<"count" | "all" | "user">("count");
          const [clearCount, setClearCount] = useState(10);
          const [clearing, setClearing] = useState(false);
          const [confirmed, setConfirmed] = useState(false);
          const [targetUser, setTargetUser] = useState<ChatProfile | null>(null);
          const [userSearch, setUserSearch] = useState("");
          const [userClearMode, setUserClearMode] = useState<"all" | "count">("all");
          const [userClearCount, setUserClearCount] = useState(10);

          // Unique authors in current channel messages
          const channelAuthors = Array.from(new Set(messages.map((m) => m.user_id)))
            .map((uid) => allMembers.find((m) => m.id === uid))
            .filter(Boolean) as ChatProfile[];

          const filteredAuthors = channelAuthors.filter((a) =>
            !userSearch || (displayName(a)).toLowerCase().includes(userSearch.toLowerCase())
          );

          const handleClear = async () => {
            if (!confirmed) { setConfirmed(true); return; }
            setClearing(true);

            let logDetail = "";

            if (clearMode === "all") {
              const { error } = await supabase.from("messages").delete().eq("channel_id", activeChannel.id);
              if (error) console.error("[PNW Chat] Clear all error:", error);
              setMessages([]);
              logDetail = "Tous les messages supprimés";
            } else if (clearMode === "count") {
              const { data: toDelete } = await supabase.from("messages").select("id")
                .eq("channel_id", activeChannel.id).order("created_at", { ascending: false }).limit(clearCount);
              if (toDelete?.length) {
                const ids = toDelete.map((m: any) => m.id);
                await supabase.from("messages").delete().in("id", ids);
                setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
              }
              logDetail = `${clearCount} derniers messages supprimés`;
            } else if (clearMode === "user" && targetUser) {
              if (userClearMode === "all") {
                const { data: toDelete } = await supabase.from("messages").select("id")
                  .eq("channel_id", activeChannel.id).eq("user_id", targetUser.id);
                if (toDelete?.length) {
                  const ids = toDelete.map((m: any) => m.id);
                  await supabase.from("messages").delete().in("id", ids);
                  setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
                }
                logDetail = `Tous les messages de ${displayName(targetUser)} supprimés`;
              } else {
                const { data: toDelete } = await supabase.from("messages").select("id")
                  .eq("channel_id", activeChannel.id).eq("user_id", targetUser.id)
                  .order("created_at", { ascending: false }).limit(userClearCount);
                if (toDelete?.length) {
                  const ids = toDelete.map((m: any) => m.id);
                  await supabase.from("messages").delete().in("id", ids);
                  setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
                }
                logDetail = `${userClearCount} derniers messages de ${displayName(targetUser)} supprimés`;
              }
            }

            sendLog({
              type: "delete", modName: displayName(profile), modAvatar: profile?.avatar_url,
              modId: session.user.id,
              targetName: targetUser ? displayName(targetUser) : `#${activeChannel.name || "channel"}`,
              targetAvatar: targetUser?.avatar_url || null, targetId: targetUser?.id || "",
              detail: logDetail,
            });

            setClearing(false);
            setShowClearModal(false);
          };

          const confirmLabel = clearMode === "all" ? "tous les messages"
            : clearMode === "count" ? `${clearCount} messages`
            : targetUser ? (userClearMode === "all" ? `tous les messages de ${displayName(targetUser)}` : `${userClearCount} messages de ${displayName(targetUser)}`)
            : "";

          return (
            <div className="pnw-chat-profile-overlay" onClick={() => setShowClearModal(false)}>
              <div className="pnw-chat-clear-modal" onClick={(e) => e.stopPropagation()}>
                <div className="pnw-chat-clear-modal-header">
                  <FaTrashCan /> <span>Supprimer des messages</span>
                  <button className="pnw-chat-profile-close" onClick={() => setShowClearModal(false)}><FaXmark /></button>
                </div>
                <div className="pnw-chat-clear-modal-body">
                  <div className="pnw-chat-clear-channel-info">
                    <ChannelIcon type={activeChannel.type} name={activeChannel.name} />
                    <span>{activeChannel.name || "Channel"}</span>
                  </div>

                  <div className="pnw-chat-clear-options">
                    <button className={`pnw-chat-clear-option ${clearMode === "count" ? "pnw-chat-clear-option--active" : ""}`}
                      onClick={() => { setClearMode("count"); setConfirmed(false); }}>
                      <FaClock />
                      <div><strong>Derniers messages</strong><span>Nombre défini</span></div>
                    </button>
                    <button className={`pnw-chat-clear-option ${clearMode === "user" ? "pnw-chat-clear-option--active" : ""}`}
                      onClick={() => { setClearMode("user"); setConfirmed(false); }}>
                      <FaUserShield />
                      <div><strong>Par utilisateur</strong><span>Cibler un joueur</span></div>
                    </button>
                    <button className={`pnw-chat-clear-option ${clearMode === "all" ? "pnw-chat-clear-option--active" : ""}`}
                      onClick={() => { setClearMode("all"); setConfirmed(false); }}>
                      <FaTrash />
                      <div><strong>Tout</strong><span>Vider le channel</span></div>
                    </button>
                  </div>

                  {clearMode === "count" && (
                    <div className="pnw-chat-clear-count">
                      <label>Nombre de messages :</label>
                      <div className="pnw-chat-clear-count-row">
                        {[10, 25, 50, 100].map((n) => (
                          <button key={n} className={`pnw-chat-clear-count-btn ${clearCount === n ? "pnw-chat-clear-count-btn--active" : ""}`}
                            onClick={() => { setClearCount(n); setConfirmed(false); }}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {clearMode === "user" && (
                    <div className="pnw-chat-clear-user">
                      {!targetUser ? (
                        <>
                          <div className="pnw-chat-clear-user-search">
                            <FaMagnifyingGlass />
                            <input type="text" placeholder="Rechercher un joueur…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} autoFocus />
                          </div>
                          <div className="pnw-chat-clear-user-list pnw-scrollbar">
                            {filteredAuthors.map((a) => (
                              <button key={a.id} className="pnw-chat-clear-user-item" onClick={() => { setTargetUser(a); setConfirmed(false); }}>
                                {a.avatar_url ? <img src={a.avatar_url} alt="" className="pnw-chat-clear-user-avatar" /> : <div className="pnw-chat-clear-user-avatar pnw-chat-avatar--placeholder">{displayName(a)[0]?.toUpperCase()}</div>}
                                <span style={roleColor(a.roles || []) ? { color: roleColor(a.roles || []) } : undefined}>{displayName(a)}</span>
                                <span className="pnw-chat-clear-user-count">{messages.filter((m) => m.user_id === a.id).length} msg</span>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="pnw-chat-clear-user-selected">
                            {targetUser.avatar_url ? <img src={targetUser.avatar_url} alt="" className="pnw-chat-clear-user-avatar" /> : <div className="pnw-chat-clear-user-avatar pnw-chat-avatar--placeholder">{displayName(targetUser)[0]?.toUpperCase()}</div>}
                            <span style={roleColor(targetUser.roles || []) ? { color: roleColor(targetUser.roles || []) } : undefined}>{displayName(targetUser)}</span>
                            <button className="pnw-chat-clear-user-change" onClick={() => { setTargetUser(null); setConfirmed(false); }}><FaXmark /></button>
                          </div>
                          <div className="pnw-chat-clear-count">
                            <div className="pnw-chat-clear-count-row">
                              <button className={`pnw-chat-clear-count-btn ${userClearMode === "all" ? "pnw-chat-clear-count-btn--active" : ""}`}
                                onClick={() => { setUserClearMode("all"); setConfirmed(false); }}>Tout</button>
                              {[10, 25, 50].map((n) => (
                                <button key={n} className={`pnw-chat-clear-count-btn ${userClearMode === "count" && userClearCount === n ? "pnw-chat-clear-count-btn--active" : ""}`}
                                  onClick={() => { setUserClearMode("count"); setUserClearCount(n); setConfirmed(false); }}>{n}</button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    className={`pnw-chat-clear-confirm ${confirmed ? "pnw-chat-clear-confirm--danger" : ""}`}
                    onClick={handleClear}
                    disabled={clearing || (clearMode === "user" && !targetUser)}
                  >
                    {clearing ? (
                      <><FaSpinner className="pnw-chat-spinner" /> Suppression...</>
                    ) : confirmed ? (
                      <><FaTrashCan /> Confirmer — {confirmLabel}</>
                    ) : (
                      <><FaTrashCan /> Supprimer {confirmLabel}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        };
        return <ClearModal />;
      })()}

      {/* Pokémon picker */}
      {showPokemonPicker && activeChannel && session && (() => {
        const base = siteUrl.replace(/\/$/, "");
        const resolveSprite = (url?: string) => url ? (url.startsWith("http") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`) : "";

        // For BST entries: resolve sprite from pokedex entries if missing
        const normForMatch = (s: string) => s.toLowerCase().replace(/[-\s]+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const allDexEntries = [...pokedexEntries, ...extradexEntries];
        const findBstSprite = (poke: any) => {
          if (poke.imageUrl) return resolveSprite(poke.imageUrl);
          const name = normForMatch(poke.name || "");
          // Exact match
          const exact = allDexEntries.find((p) => normForMatch(p.name) === name);
          if (exact?.imageUrl) return resolveSprite(exact.imageUrl);
          // "Méga X" vs "Méga-X" / "Mega X" vs "Mega-X"
          const variants = [
            name,
            name.replace("mega ", "mega-"),
            name.replace("mega-", "mega "),
          ];
          for (const v of variants) {
            const m = allDexEntries.find((p) => normForMatch(p.name) === v);
            if (m?.imageUrl) return resolveSprite(m.imageUrl);
          }
          // Partial match (contains)
          const partial = allDexEntries.find((p) => normForMatch(p.name).includes(name) || name.includes(normForMatch(p.name)));
          if (partial?.imageUrl) return resolveSprite(partial.imageUrl);
          return "";
        };

        const currentEntries = pokemonTab === "pokedex" ? pokedexEntries
          : pokemonTab === "extradex" ? [...extradexEntries].sort((a, b) => {
              const na = parseInt(a.num || a.number || "999", 10);
              const nb = parseInt(b.num || b.number || "999", 10);
              return na - nb;
            })
          : bstEntries;

        const filtered = currentEntries.filter((p: any) =>
          !pokemonSearch || (p.name || "").toLowerCase().includes(pokemonSearch.toLowerCase()) || (p.num || p.number || "").includes(pokemonSearch)
        );

        const sendCard = async (poke: any) => {
          const types = Array.isArray(poke.types) && poke.types.length ? poke.types : (poke.type ? poke.type.split("/").map((t: string) => t.trim()) : []);
          const imgUrl = pokemonTab === "bst" ? (findBstSprite(poke) || poke.imageUrl) : poke.imageUrl;
          const payload: any = { num: poke.num || poke.number, name: poke.name, types, imageUrl: imgUrl, rarity: poke.rarity, evolution: poke.evolution, obtention: poke.obtention };
          if (pokemonTab === "bst" || poke.total) {
            payload.hp = poke.hp; payload.atk = poke.atk; payload.def = poke.def;
            payload.spa = poke.spa; payload.spd = poke.spd; payload.spe = poke.spe;
            payload.total = poke.total;
            // Normalize talents: support both talents[] and abilities[]/abilityDescs[]
            let talents = poke.talents;
            if (!talents?.length && poke.abilities?.length) {
              talents = poke.abilities.map((name: string, i: number) => ({
                name, desc: poke.abilityDescs?.[i] || "", hidden: false,
              }));
            }
            if (!talents?.length && poke.ability) {
              talents = [{ name: poke.ability, desc: poke.abilityDesc || "", hidden: false }];
            }
            if (talents?.length) payload.talents = talents;
            // Normalize attacks: support string or array
            let atks: any[] = [];
            if (Array.isArray(poke.attacks)) {
              atks = poke.attacks;
            } else if (typeof poke.attacks === "string" && poke.attacks.trim()) {
              // Parse string attacks (line-separated, "Name: Desc" format)
              atks = poke.attacks.split("\n").filter((l: string) => l.trim()).map((line: string) => {
                const parts = line.split(":");
                return parts.length > 1
                  ? { name: parts[0].trim(), desc: parts.slice(1).join(":").trim() }
                  : { name: line.trim(), desc: "" };
              });
            }
            if (atks.length) payload.attacks = atks;
          }
          await supabase.from("messages").insert({ channel_id: activeChannel.id, user_id: session.user.id, content: POKEMON_PREFIX + JSON.stringify(payload) });
          setShowPokemonPicker(false); setPokemonSearch("");
        };

        return (
          <div className="pnw-chat-profile-overlay" onClick={() => { setShowPokemonPicker(false); setPokemonSearch(""); }}>
            <div className="pnw-chat-pokemon-picker" onClick={(e) => e.stopPropagation()}>
              <div className="pnw-chat-pokemon-picker-header">
                <img src="/Poké_Ball_icon.png" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
                <span>Pokédex — Envoyer une carte</span>
                <button className="pnw-chat-profile-close" onClick={() => { setShowPokemonPicker(false); setPokemonSearch(""); }}><FaXmark /></button>
              </div>
              {/* Tabs */}
              <div className="pnw-chat-friends-tabs">
                <button className={`pnw-chat-friends-tab ${pokemonTab === "pokedex" ? "pnw-chat-friends-tab--active" : ""}`} onClick={() => setPokemonTab("pokedex")}>
                  Pokédex <span className="pnw-chat-friends-tab-count">{pokedexEntries.length}</span>
                </button>
                <button className={`pnw-chat-friends-tab ${pokemonTab === "extradex" ? "pnw-chat-friends-tab--active" : ""}`} onClick={() => setPokemonTab("extradex")}>
                  Extradex <span className="pnw-chat-friends-tab-count">{extradexEntries.length}</span>
                </button>
                <button className={`pnw-chat-friends-tab ${pokemonTab === "bst" ? "pnw-chat-friends-tab--active" : ""}`} onClick={() => setPokemonTab("bst")}>
                  Fakemon <span className="pnw-chat-friends-tab-count">{bstEntries.length}</span>
                </button>
              </div>
              <div className="pnw-chat-pokemon-picker-search">
                <FaMagnifyingGlass />
                <input type="text" placeholder="Rechercher un Pokémon…" value={pokemonSearch} onChange={(e) => setPokemonSearch(e.target.value)} autoFocus />
              </div>
              <div className="pnw-chat-pokemon-picker-grid pnw-scrollbar">
                {filtered.map((poke: any, i: number) => {
                  const spriteUrl = pokemonTab === "bst" ? findBstSprite(poke) : resolveSprite(poke.imageUrl);
                  const types = Array.isArray(poke.types) && poke.types.length ? poke.types : (poke.type ? poke.type.split("/").map((t: string) => t.trim()) : []);
                  const primaryType = (types[0] || "normal").toLowerCase();
                  const ts = getTypeStyle(primaryType);
                  const talentNames = poke.talents?.map((t: any) => `${t.name}${t.hidden ? " (caché)" : ""}${t.desc ? ` — ${t.desc}` : ""}`).join("\n");
                  return (
                    <button
                      key={`${pokemonTab}-${i}-${poke.name}`}
                      className="pnw-chat-pokemon-picker-item"
                      style={{ borderColor: ts.border.replace("1px solid ", "") }}
                      onClick={() => sendCard(poke)}
                      title={pokemonTab === "bst" && talentNames ? `Talents :\n${talentNames}` : undefined}
                    >
                      {spriteUrl && <img src={spriteUrl} alt="" className="pnw-chat-pokemon-picker-sprite" />}
                      <span className="pnw-chat-pokemon-picker-name">{poke.name}</span>
                      {(poke.num || poke.number) && <span className="pnw-chat-pokemon-picker-num">#{poke.num || poke.number}</span>}
                      {pokemonTab === "bst" && poke.total && <span className="pnw-chat-pokemon-picker-num">BST {poke.total}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* DM background modal */}
      {showDmBgModal && activeChannel?.type === "dm" && (() => {
        const DmBgModal = () => {
          const [bgUrl, setBgUrl] = useState(activeChannel.background_url || "");
          const [bgPreview, setBgPreview] = useState<string | null>(activeChannel.background_url || null);
          const [bgFile, setBgFile] = useState<File | null>(null);
          const [saving, setSaving] = useState(false);
          const bgFileRef = useRef<HTMLInputElement>(null);

          const handleSave = async () => {
            setSaving(true);
            let finalUrl: string | null = null;
            if (bgFile) {
              finalUrl = await uploadDmBackground(activeChannel.id, bgFile);
            } else if (bgUrl.trim()) {
              finalUrl = bgUrl.trim();
            }
            if (finalUrl !== null) {
              await updateChannelBackground(activeChannel.id, finalUrl);
              setActiveChannel({ ...activeChannel, background_url: finalUrl });
              setChannels((prev) => prev.map((c) => c.id === activeChannel.id ? { ...c, background_url: finalUrl } : c));
            }
            setSaving(false);
            setShowDmBgModal(false);
          };

          const handleRemove = async () => {
            setSaving(true);
            await updateChannelBackground(activeChannel.id, null);
            setActiveChannel({ ...activeChannel, background_url: null });
            setChannels((prev) => prev.map((c) => c.id === activeChannel.id ? { ...c, background_url: null } : c));
            setSaving(false);
            setShowDmBgModal(false);
          };

          return (
            <div className="pnw-chat-profile-overlay" onClick={() => setShowDmBgModal(false)}>
              <div className="pnw-chat-dm-bg-modal" onClick={(e) => e.stopPropagation()}>
                <div className="pnw-chat-dm-bg-modal-header">
                  <FaImage /> <span>Fond de conversation</span>
                  <button className="pnw-chat-profile-close" onClick={() => setShowDmBgModal(false)}><FaXmark /></button>
                </div>
                {/* Preview */}
                <div className="pnw-chat-dm-bg-preview" style={bgPreview ? { backgroundImage: `linear-gradient(rgba(5,9,20,.6), rgba(5,9,20,.7)), url(${bgPreview})` } : undefined}>
                  {bgPreview ? <span className="pnw-chat-dm-bg-preview-label">Aperçu</span> : <span className="pnw-chat-dm-bg-preview-empty"><FaImage /> Aucun fond</span>}
                </div>
                <div className="pnw-chat-dm-bg-modal-body">
                  <div className="pnw-chat-dm-bg-option">
                    <span>URL de l'image</span>
                    <input
                      type="text"
                      className="pnw-chat-dm-bg-url-input"
                      placeholder="https://exemple.com/image.png"
                      value={bgUrl}
                      onChange={(e) => { setBgUrl(e.target.value); setBgFile(null); setBgPreview(e.target.value || null); }}
                    />
                  </div>
                  <div className="pnw-chat-dm-bg-separator"><span>ou</span></div>
                  <button className="pnw-chat-dm-bg-upload-btn" onClick={() => bgFileRef.current?.click()}>
                    <FaUpload /> {bgFile ? bgFile.name : "Choisir un fichier"}
                  </button>
                  <input ref={bgFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setBgFile(f); setBgUrl(""); setBgPreview(URL.createObjectURL(f)); }
                  }} />
                  <div className="pnw-chat-dm-bg-actions">
                    {activeChannel.background_url && (
                      <button className="pnw-chat-dm-bg-remove" onClick={handleRemove} disabled={saving}>
                        <FaTrash /> Supprimer
                      </button>
                    )}
                    <button className="pnw-chat-dm-bg-save" onClick={handleSave} disabled={saving || (!bgUrl.trim() && !bgFile)}>
                      {saving ? <FaSpinner className="pnw-chat-spinner" /> : <FaFloppyDisk />} Sauvegarder
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        };
        return <DmBgModal />;
      })()}

      {/* ═══════ P2P Trade Modal (fullscreen overlay) ═══════ */}
      {tradeState.phase !== "idle" && tradeState.phase !== "complete" && createPortal(
        <div className="pnw-trade-modal-overlay">
          <div className="pnw-trade-modal">
            {/* Header */}
            <div className="pnw-trade-modal-header">
              <FaArrowRightArrowLeft />
              <span>Échange avec {(tradeState as any).partnerName}</span>
              <span className="pnw-trade-modal-phase">
                {tradeState.phase === "pending" ? "En attente..." : tradeState.phase === "selecting" ? "Sélection" : tradeState.phase === "confirming" ? "Confirmation" : tradeState.phase === "executing" ? "Échange..." : tradeState.phase === "error" ? "Erreur" : ""}
              </span>
              <button className="pnw-trade-modal-close" onClick={() => cancelTrade()}>
                <FaXmark />
              </button>
            </div>

            {/* Pending — waiting for response */}
            {tradeState.phase === "pending" && tradeState.role === "initiator" && (
              <div className="pnw-trade-modal-body pnw-trade-modal-center">
                <FaSpinner className="pnw-trade-spinner" style={{ fontSize: "2rem", color: "#4ade80" }} />
                <p>En attente de la réponse de <strong>{tradeState.partnerName}</strong>...</p>
              </div>
            )}
            {tradeState.phase === "pending" && tradeState.role === "responder" && (
              <div className="pnw-trade-modal-body pnw-trade-modal-center">
                <p><strong>{tradeState.partnerName}</strong> souhaite échanger un Pokémon avec vous !</p>
                <div className="pnw-trade-modal-actions">
                  <button className="pnw-trade-btn pnw-trade-btn--accept" onClick={async () => {
                    try {
                      const running = await invoke<boolean>("cmd_is_game_running");
                      if (running) {
                        gameLiveRef2.current?.send({ type: "broadcast", event: "trade_decline", payload: { tradeId: tradeState.tradeId, fromId: session?.user?.id, toId: tradeState.partnerId, reason: "game_running" } });
                        setTradeState({ phase: "error", tradeId: tradeState.tradeId, partnerId: tradeState.partnerId, partnerName: tradeState.partnerName, message: "Fermez le jeu avant d'accepter un échange." });
                        return;
                      }
                    } catch {}
                    gameLiveRef2.current?.send({ type: "broadcast", event: "trade_accept", payload: { tradeId: tradeState.tradeId, fromId: session?.user?.id, toId: tradeState.partnerId } });
                    setTradeState({ phase: "selecting", role: "responder", tradeId: tradeState.tradeId, partnerId: tradeState.partnerId, partnerName: tradeState.partnerName, partnerAvatar: tradeState.partnerAvatar, dmChannelId: tradeState.dmChannelId, mySelection: null, theirPreview: null });
                  }}>
                    <FaUserCheck /> Accepter
                  </button>
                  <button className="pnw-trade-btn pnw-trade-btn--decline" onClick={() => {
                    gameLiveRef2.current?.send({ type: "broadcast", event: "trade_decline", payload: { tradeId: tradeState.tradeId, fromId: session?.user?.id, toId: tradeState.partnerId } });
                    setTradeState({ phase: "idle" });
                  }}>
                    <FaXmark /> Refuser
                  </button>
                </div>
              </div>
            )}

            {/* Selecting — two columns: my pick + their pick */}
            {tradeState.phase === "selecting" && (
              <div className="pnw-trade-modal-body">
                <div className="pnw-trade-modal-columns">
                  {/* My side */}
                  <div className="pnw-trade-modal-col">
                    <div className="pnw-trade-modal-col-label">Votre Pokémon</div>
                    {tradeState.mySelection ? (
                      <div className="pnw-trade-modal-poke-card">
                        <VdSprite speciesId={tradeState.mySelection.speciesId} form={tradeState.mySelection.form} shiny={tradeState.mySelection.shiny} altShiny={tradeState.mySelection.altShiny} className="pnw-trade-modal-poke-sprite" />
                        <div className="pnw-trade-modal-poke-name">{tradeState.mySelection.name}</div>
                        <div className="pnw-trade-modal-poke-level">Nv. {tradeState.mySelection.level}</div>
                        {tradeState.mySelection.altShiny && <FaStar style={{ color: "#c084fc", fontSize: 12 }} />}
                        {tradeState.mySelection.shiny && !tradeState.mySelection.altShiny && <FaStar style={{ color: "#facc15", fontSize: 12 }} />}
                        <TradePokeOverlay pk={tradeState.mySelection} psdkNames={psdkNames} />
                        <button className="pnw-trade-modal-change" onClick={() => setShowTradeBoxes(true)}>Changer</button>
                      </div>
                    ) : (
                      <button className="pnw-trade-modal-poke-empty" onClick={() => setShowTradeBoxes(true)}>
                        <FaPlus style={{ fontSize: "1.5rem" }} />
                        <span>Choisir un Pokémon</span>
                      </button>
                    )}
                  </div>
                  {/* Arrow */}
                  <div className="pnw-trade-modal-arrow"><FaArrowRightArrowLeft /></div>
                  {/* Their side */}
                  <div className="pnw-trade-modal-col">
                    <div className="pnw-trade-modal-col-label">{tradeState.partnerName}</div>
                    {tradeState.theirPreview ? (
                      <div className="pnw-trade-modal-poke-card">
                        <VdSprite speciesId={tradeState.theirPreview.speciesId} form={tradeState.theirPreview.form} shiny={tradeState.theirPreview.shiny} altShiny={tradeState.theirPreview.altShiny} className="pnw-trade-modal-poke-sprite" />
                        <div className="pnw-trade-modal-poke-name">{tradeState.theirPreview.name}</div>
                        <div className="pnw-trade-modal-poke-level">Nv. {tradeState.theirPreview.level}</div>
                        {tradeState.theirPreview.altShiny && <FaStar style={{ color: "#c084fc", fontSize: 12 }} />}
                        {tradeState.theirPreview.shiny && !tradeState.theirPreview.altShiny && <FaStar style={{ color: "#facc15", fontSize: 12 }} />}
                        <TradePokeOverlay pk={tradeState.theirPreview} psdkNames={psdkNames} />
                      </div>
                    ) : (
                      <div className="pnw-trade-modal-poke-waiting">
                        <FaSpinner className="pnw-trade-spinner" />
                        <span>En attente...</span>
                      </div>
                    )}
                  </div>
                </div>
                {tradeState.mySelection && tradeState.theirPreview && (
                  <button className="pnw-trade-btn pnw-trade-btn--confirm pnw-trade-modal-main-btn" onClick={() => {
                    // Broadcast confirm directly — skip separate confirming phase
                    gameLiveRef2.current?.send({ type: "broadcast", event: "trade_confirm", payload: { tradeId: tradeState.tradeId, userId: session?.user?.id } });
                    setTradeState({ phase: "confirming", role: tradeState.role, tradeId: tradeState.tradeId, partnerId: tradeState.partnerId, partnerName: tradeState.partnerName, partnerAvatar: tradeState.partnerAvatar, dmChannelId: tradeState.dmChannelId, mySelection: tradeState.mySelection!, theirPreview: tradeState.theirPreview!, myConfirmed: true, theirConfirmed: false });
                  }}>
                    <FaUserCheck /> Confirmer l'échange
                  </button>
                )}
              </div>
            )}

            {/* Confirming */}
            {tradeState.phase === "confirming" && (
              <div className="pnw-trade-modal-body">
                <div className="pnw-trade-modal-columns">
                  <div className="pnw-trade-modal-col">
                    <div className="pnw-trade-modal-col-label">Vous envoyez</div>
                    <div className="pnw-trade-modal-poke-card">
                      <VdSprite speciesId={tradeState.mySelection.speciesId} form={tradeState.mySelection.form} shiny={tradeState.mySelection.shiny} altShiny={tradeState.mySelection.altShiny} className="pnw-trade-modal-poke-sprite" />
                      <div className="pnw-trade-modal-poke-name">{tradeState.mySelection.name}</div>
                      <div className="pnw-trade-modal-poke-level">Nv. {tradeState.mySelection.level}</div>
                      <TradePokeOverlay pk={tradeState.mySelection} psdkNames={psdkNames} />
                    </div>
                    <div className="pnw-trade-modal-check">{tradeState.myConfirmed ? "✅" : "⏳"} Vous</div>
                  </div>
                  <div className="pnw-trade-modal-arrow"><FaArrowRightArrowLeft /></div>
                  <div className="pnw-trade-modal-col">
                    <div className="pnw-trade-modal-col-label">Vous recevez</div>
                    <div className="pnw-trade-modal-poke-card">
                      <VdSprite speciesId={tradeState.theirPreview.speciesId} form={tradeState.theirPreview.form} shiny={tradeState.theirPreview.shiny} altShiny={tradeState.theirPreview.altShiny} className="pnw-trade-modal-poke-sprite" />
                      <div className="pnw-trade-modal-poke-name">{tradeState.theirPreview.name}</div>
                      <div className="pnw-trade-modal-poke-level">Nv. {tradeState.theirPreview.level}</div>
                      <TradePokeOverlay pk={tradeState.theirPreview} psdkNames={psdkNames} />
                    </div>
                    <div className="pnw-trade-modal-check">{tradeState.theirConfirmed ? "✅" : "⏳"} {tradeState.partnerName}</div>
                  </div>
                </div>
                {!tradeState.myConfirmed ? (
                  <button className="pnw-trade-btn pnw-trade-btn--confirm pnw-trade-modal-main-btn" onClick={() => {
                    gameLiveRef2.current?.send({ type: "broadcast", event: "trade_confirm", payload: { tradeId: tradeState.tradeId, userId: session?.user?.id } });
                    setTradeState({ ...tradeState, myConfirmed: true });
                  }}>
                    <FaUserCheck /> Confirmer l'échange
                  </button>
                ) : (
                  <div className="pnw-trade-modal-waiting">En attente de {tradeState.partnerName}...</div>
                )}
              </div>
            )}

            {/* Executing */}
            {tradeState.phase === "executing" && (
              <div className="pnw-trade-modal-body pnw-trade-modal-center">
                <FaSpinner className="pnw-trade-spinner" style={{ fontSize: "2rem", color: "#60a5fa" }} />
                <p>Échange en cours...</p>
              </div>
            )}

            {/* Error */}
            {tradeState.phase === "error" && (
              <div className="pnw-trade-modal-body pnw-trade-modal-center">
                <FaXmark style={{ fontSize: "2rem", color: "#ef4444" }} />
                <p>{tradeState.message}</p>
                <button className="pnw-trade-btn pnw-trade-btn--decline" onClick={() => setTradeState({ phase: "idle" })}>
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* P2P Trade — PCBox selection (sub-modal) */}
      {showTradeBoxes && tradeState.phase === "selecting" && gameProfile && lastSavePath && createPortal(
        <div className="pnw-trade-pcbox-overlay" onClick={() => setShowTradeBoxes(false)}>
          <div className="pnw-trade-pcbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pnw-trade-pcbox-header">
              <span>Choisir un Pokémon à échanger</span>
              <button onClick={() => setShowTradeBoxes(false)}><FaXmark /></button>
            </div>
            <PCBoxView
              profile={gameProfile}
              embedded
              savePath={lastSavePath}
              p2pTradeMode
              onTradeSelect={(poke, boxIdx) => {
                (async () => {
                  try {
                    const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath: lastSavePath });
                    if (!blob) return;
                    const rawBytes = Uint8Array.from(atob(blob.bytes_b64), (c) => c.charCodeAt(0));
                    const { pokemonB64 } = extractAndEncode(rawBytes, boxIdx, poke.slot);
                    const speciesId = typeof poke.code === "string" ? parseInt(poke.code, 10) : (poke.code ?? 0);
                    const formN = typeof poke.form === "string" ? parseInt(poke.form, 10) : (poke.form ?? 0);
                    // Resolve names from game_state cache or psdkNames
                    const resolvedItemName = poke.itemHolding != null && poke.itemHolding > 0 ? (psdkNames.items?.[poke.itemHolding] ?? null) : null;
                    const resolvedMoveNames = poke.moves?.map((mid) => psdkNames.skills?.[mid] ?? `#${mid}`) ?? [];
                    const selection: TradeSelection = {
                      boxIdx, slotIdx: poke.slot, speciesId,
                      name: poke.speciesName || (psdkNames.species && speciesId > 0 ? psdkNames.species[speciesId] : null) || poke.nickname || `#${speciesId}`,
                      nickname: poke.nickname, level: poke.level ?? 0,
                      shiny: poke.isShiny ?? false, altShiny: poke.isAltShiny ?? false,
                      gender: poke.gender, nature: poke.nature,
                      form: formN,
                      ability: poke.ability, abilityName: null,
                      itemHolding: poke.itemHolding, itemName: resolvedItemName,
                      moves: poke.moves, moveNames: resolvedMoveNames,
                      ivHp: poke.ivHp, ivAtk: poke.ivAtk, ivDfe: poke.ivDfe,
                      ivSpd: poke.ivSpd, ivAts: poke.ivAts, ivDfs: poke.ivDfs,
                      pokemonB64,
                    };
                    setTradeState((prev) => prev.phase === "selecting" ? { ...prev, mySelection: selection } : prev);
                    const { pokemonB64: _, ...preview } = selection;
                    gameLiveRef2.current?.send({ type: "broadcast", event: "trade_select", payload: { tradeId: (tradeState as any).tradeId, userId: session?.user?.id, preview } });
                    setShowTradeBoxes(false);
                  } catch (err: any) {
                    console.error("[Trade] Error encoding Pokémon:", err);
                  }
                })();
              }}
            />
          </div>
        </div>,
        document.body
      )}

      {/* P2P Trade — Swap animation */}
      {showTradeSwapAnim && tradeSwapInfo && (
        <GtsSwapAnim
          mySpriteUrl={tradeSwapInfo.mySpriteUrl}
          myName={tradeSwapInfo.myName}
          myShiny={tradeSwapInfo.myShiny}
          myAltShiny={tradeSwapInfo.myAltShiny}
          theirSpriteUrl={tradeSwapInfo.theirSpriteUrl}
          theirName={tradeSwapInfo.theirName}
          theirShiny={tradeSwapInfo.theirShiny}
          theirAltShiny={tradeSwapInfo.theirAltShiny}
          boxName={tradeSwapInfo.boxName}
          onComplete={() => {
            setShowTradeSwapAnim(false);
            setTradeSwapInfo(null);
            setTradeState({ phase: "idle" });
          }}
        />
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <div className="pnw-chat-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="" className="pnw-chat-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button className="pnw-chat-lightbox-close" onClick={() => setLightboxUrl(null)}><FaXmark /></button>
        </div>
      )}
    </div>
  );
}
