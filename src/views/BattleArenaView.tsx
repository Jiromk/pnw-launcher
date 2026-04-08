/**
 * BattleArenaView.tsx — Tour de Combat (redesign)
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  FaShieldHalved, FaGamepad, FaUserCheck, FaXmark, FaSpinner,
  FaTrophy, FaSkull, FaChartLine, FaClock,
  FaArrowLeft, FaTriangleExclamation, FaBolt, FaUsers,
} from "react-icons/fa6";
import type { Session } from "@supabase/supabase-js";
import type { ChatProfile, ChatFriend, ChatChannel, GameLivePlayer, BattleRoomState } from "../types";
import {
  generateRoomCode, writeBattleTrigger, writeStopTrigger, startRelay,
  cleanupBattleFiles, fullCleanup, isGameRunning,
  BATTLE_INVITE_TIMEOUT,
  sendBattleInvite, sendBattleAccept, sendBattleDecline, sendBattleCancel, playTurnSound, saveBattleLog,
} from "../battleRelay";
import { supabase } from "../supabaseClient"; // kept for DM channel lookup only
import { fetchPvpStats, fetchBattleHistory, recordBattleResult, type PvpStats, type BattleResultEntry } from "../leaderboard";

/* ==================== History (localStorage) ==================== */

type BattleHistoryEntry = {
  date: string;
  opponentName: string;
  opponentId: string;
  result: "win" | "loss" | "draw";
};

const HISTORY_KEY = "pnw_battle_history";
const MAX_HISTORY = 50;

function loadHistory(): BattleHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(entries: BattleHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

export function appendBattleHistory(entry: BattleHistoryEntry) {
  const h = loadHistory();
  h.unshift(entry);
  saveHistory(h);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "A l'instant";
  if (mins < 60) return `Il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR");
}

/* ==================== Props ==================== */

interface BattleArenaViewProps {
  session: Session;
  profile: ChatProfile;
  friendsList: ChatFriend[];
  onlineUserIds: Set<string>;
  gameLivePlayers: Map<string, GameLivePlayer>;
  dmPartners: Record<number, { name: string; avatar: string | null; displayName: string | null }>;
  channels: ChatChannel[];
  battleState: BattleRoomState;
  setBattleState: React.Dispatch<React.SetStateAction<BattleRoomState>>;
  battleRelayCleanupRef: React.MutableRefObject<(() => void) | null>;
  battleTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onBack: () => void;
}

/* ==================== Component ==================== */

export default function BattleArenaView({
  session, profile, friendsList, onlineUserIds, gameLivePlayers,
  dmPartners, channels, battleState, setBattleState,
  battleRelayCleanupRef, battleTimeoutRef, onBack,
}: BattleArenaViewProps) {
  const [history, setHistory] = useState<BattleHistoryEntry[]>([]);
  const [pvpStats, setPvpStats] = useState<PvpStats>({ pvp_wins: 0, pvp_losses: 0, pvp_draws: 0 });
  const [serverHistory, setServerHistory] = useState<BattleResultEntry[]>([]);
  const [errorPopup, setErrorPopup] = useState<string | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [inviteTimer, setInviteTimer] = useState(0);
  const battleStartedAtRef = useRef<string>("");
  const turnCountRef = useRef(0);

  // Fetch stats from Supabase on mount
  useEffect(() => {
    setHistory(loadHistory());
    fetchPvpStats(session.user.id).then(setPvpStats).catch(() => {});
    fetchBattleHistory(session.user.id).then(setServerHistory).catch(() => {});
  }, [session.user.id]);

  // Refresh stats when battle completes + record result
  useEffect(() => {
    if (battleState.phase !== "complete") return;
    setHistory(loadHistory());
    const st = battleState as any;
    const endReason = st.endReason;
    let result: string = "draw";
    if (endReason === "opponent_forfeit") result = "win";
    else if (endReason === "opponent_crash") result = "draw";

    if (endReason && st.partnerId) {
      // Mise à jour optimiste immédiate (pas d'attente réseau)
      setPvpStats((prev) => ({
        pvp_wins: prev.pvp_wins + (result === "win" ? 1 : 0),
        pvp_losses: prev.pvp_losses + (result === "loss" ? 1 : 0),
        pvp_draws: prev.pvp_draws + (result === "draw" ? 1 : 0),
      }));
      const typedResult = result as "win" | "loss" | "draw";
      setServerHistory((prev) => [{ id: Date.now(), room_code: st.roomCode, opponent_id: st.partnerId, opponent_name: st.partnerName, result: typedResult, reason: endReason, created_at: new Date().toISOString() }, ...prev]);
      appendBattleHistory({ date: new Date().toISOString(), opponentName: st.partnerName, opponentId: st.partnerId, result: typedResult });

      // Écrire en base puis refresh pour confirmer
      recordBattleResult(session.user.id, st.partnerId, st.roomCode, st.partnerName, typedResult, endReason)
        .then(() => Promise.all([
          fetchPvpStats(session.user.id).then(setPvpStats),
          fetchBattleHistory(session.user.id).then(setServerHistory),
        ]))
        .catch(() => {});
    }
  }, [battleState.phase]);

  // Countdown timer for invite
  useEffect(() => {
    if (battleState.phase !== "inviting" || !(battleState as any).startedAt) { setInviteTimer(0); return; }
    const start = (battleState as any).startedAt as number;
    const iv = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((BATTLE_INVITE_TIMEOUT - (Date.now() - start)) / 1000));
      setInviteTimer(remaining);
      if (remaining <= 0) clearInterval(iv);
    }, 500);
    return () => clearInterval(iv);
  }, [battleState.phase, (battleState as any).startedAt]);

  // --- Challenge ---
  const challengePlayer = useCallback(async (targetId: string, targetName: string, targetAvatar: string | null) => {
    if (battleState.phase !== "idle") return;
    const running = await isGameRunning();
    if (!running) { setErrorPopup("Lancez le jeu avant de defier un joueur !"); return; }
    await fullCleanup(battleRelayCleanupRef);
    const roomCode = generateRoomCode();
    let dmChannelId = 0;
    for (const c of channels) {
      if (c.type !== "dm") continue;
      const { data: members } = await supabase.from("channel_members").select("user_id").eq("channel_id", c.id);
      if (members?.some((m: any) => m.user_id === targetId)) { dmChannelId = c.id; break; }
    }
    if (!dmChannelId) { try { const { data } = await supabase.rpc("create_dm_channel", { target_user_id: targetId }); if (data) dmChannelId = data; } catch {} }
    const sent = sendBattleInvite({ roomCode, fromId: session.user.id, fromName: profile.display_name || profile.username, fromAvatar: profile.avatar_url, toId: targetId, dmChannelId });
    if (!sent) { setErrorPopup("Connexion au serveur de combat non disponible. Reessayez."); return; }
    setBattleState({ phase: "inviting", roomCode, partnerId: targetId, partnerName: targetName, partnerAvatar: targetAvatar, dmChannelId, startedAt: Date.now() });
    battleTimeoutRef.current = setTimeout(() => {
      setBattleState((prev) => { if (prev.phase !== "inviting") return prev; cleanupBattleFiles(); return { phase: "idle" }; });
    }, BATTLE_INVITE_TIMEOUT);
  }, [battleState.phase, channels, session, profile, setBattleState, battleTimeoutRef]);

  // --- Accept ---
  const acceptBattle = useCallback(async () => {
    const st = battleState as any;
    const running = await isGameRunning();
    if (!running) {
      setErrorPopup("Lancez le jeu avant d'accepter un combat !");
      sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
      setBattleState({ phase: "idle" }); return;
    }
    await fullCleanup(battleRelayCleanupRef);
    sendBattleAccept(st.roomCode, st.partnerId, session.user.id, profile.display_name || profile.username);
    setBattleState({ ...st, phase: "waiting_game" });
    try { await writeBattleTrigger(Number(st.roomCode), st.partnerName, "client"); console.log("[Battle] Trigger written OK (client)"); } catch (e) { console.error("[Battle] writeBattleTrigger FAILED:", e); }
    battleStartedAtRef.current = new Date().toISOString();
    turnCountRef.current = 0;
    const cleanup = startRelay(st.roomCode, session.user.id,
      () => setBattleState((prev) => (prev as any).roomCode === st.roomCode ? { ...prev, phase: "relaying" } as any : prev),
      (reason) => {
        const result = reason === "opponent_forfeit" ? "win" : reason === "opponent_crash" ? "draw" : "unknown";
        saveBattleLog({ roomCode: st.roomCode, myUserId: session.user.id, partnerId: st.partnerId, partnerName: st.partnerName, result, reason: reason || "unknown", turns: turnCountRef.current, startedAt: battleStartedAtRef.current, endedAt: new Date().toISOString() });
        setSpectatorCount(0); writeStopTrigger().then(() => cleanupBattleFiles());
        setBattleState({ phase: "complete", roomCode: st.roomCode, partnerId: st.partnerId, partnerName: st.partnerName, endReason: reason } as any);
      },
      () => { turnCountRef.current++; playTurnSound(); },
      (count) => { setSpectatorCount(count); },
    );
    battleRelayCleanupRef.current = cleanup;
  }, [battleState, session, profile, setBattleState, battleRelayCleanupRef]);

  // --- Cancel ---
  const cancelBattle = useCallback(async () => {
    const st = battleState as any;
    if (battleTimeoutRef.current) { clearTimeout(battleTimeoutRef.current); battleTimeoutRef.current = null; }
    if (st.phase !== "idle" && st.phase !== "complete" && st.phase !== "error") {
      sendBattleCancel(st.roomCode, st.partnerId || "", session.user.id);
    }
    await fullCleanup(battleRelayCleanupRef);
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState, battleRelayCleanupRef, battleTimeoutRef]);

  // --- Close ---
  const closeBattle = useCallback(async () => {
    await cleanupBattleFiles();
    setBattleState({ phase: "idle" });
  }, [setBattleState]);

  // --- Decline ---
  const declineBattle = useCallback(async () => {
    const st = battleState as any;
    sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
    cleanupBattleFiles();
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState]);

  // --- Friends list ---
  const friendProfiles = useMemo(() => {
    const accepted = friendsList.filter((f) => f.status === "accepted");
    return accepted.map((f) => {
      const friendUserId = f.user_id === session.user.id ? f.friend_id : f.user_id;
      let fp: { id: string; name: string; avatar: string | null } | null = null;
      for (const [, p] of Object.entries(dmPartners)) {
        if (p.displayName === friendUserId || p.name === friendUserId) { fp = { id: friendUserId, name: p.displayName || p.name, avatar: p.avatar }; break; }
      }
      if (!fp) { const glp = gameLivePlayers.get(friendUserId); if (glp) fp = { id: friendUserId, name: glp.displayName, avatar: glp.avatarUrl }; }
      if (!fp && f.profiles) fp = { id: friendUserId, name: f.profiles.display_name || f.profiles.username, avatar: f.profiles.avatar_url };
      if (!fp) fp = { id: friendUserId, name: "Joueur", avatar: null };
      const online = onlineUserIds.has(friendUserId);
      const glp = gameLivePlayers.get(friendUserId);
      const inGame = !!glp?.liveStatus?.gameActive || !!glp?.gameState?.active;
      return { ...fp, online, inGame, friendUserId };
    }).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.inGame !== b.inGame) return a.inGame ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [friendsList, session.user.id, dmPartners, gameLivePlayers, onlineUserIds]);

  const onlineFriends = friendProfiles.filter((f) => f.online);

  // --- Stats (Supabase) ---
  const wins = pvpStats.pvp_wins;
  const losses = pvpStats.pvp_losses;
  const draws = pvpStats.pvp_draws;
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  const isActive = battleState.phase !== "idle";
  const isIncoming = battleState.phase === "inviting" && (battleState as any).startedAt == null;
  const isSent = battleState.phase === "inviting" && (battleState as any).startedAt != null;

  return (
    <div className="ba">
      {/* Error popup */}
      {errorPopup && (
        <div className="ba-overlay" onClick={() => setErrorPopup(null)}>
          <div className="ba-popup" onClick={(e) => e.stopPropagation()}>
            <FaTriangleExclamation className="ba-popup-icon" />
            <p>{errorPopup}</p>
            <button className="ba-btn ba-btn--primary" onClick={() => setErrorPopup(null)}>OK</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="ba-header">
        <button className="ba-back" onClick={onBack}><FaArrowLeft /></button>
        <div className="ba-header-emblem">
          <FaShieldHalved />
        </div>
        <div className="ba-header-text">
          <h1>Tour de Combat</h1>
          <p>Affrontez vos amis en temps reel</p>
        </div>
        {/* Stats in header */}
        {total > 0 && (
          <div className="ba-header-stats">
            <div className="ba-header-stat ba-header-stat--win"><FaTrophy /><span>{wins}V</span></div>
            <div className="ba-header-stat ba-header-stat--loss"><FaSkull /><span>{losses}D</span></div>
            <div className="ba-header-stat ba-header-stat--rate"><FaChartLine /><span>{winRate}%</span></div>
          </div>
        )}
      </div>

      {/* Active battle banner (full width) */}
      {isActive && (
        <div className={`ba-active ${battleState.phase === "relaying" ? "ba-active--live" : ""} ${isIncoming ? "ba-active--incoming" : ""}`}>
          {/* Incoming invite */}
          {isIncoming && (
            <>
              <div className="ba-active-left">
                {(battleState as any).partnerAvatar && <img className="ba-active-avatar" src={(battleState as any).partnerAvatar} alt="" />}
                <div>
                  <div className="ba-active-title"><FaBolt /> Defi recu !</div>
                  <div className="ba-active-desc"><strong>{(battleState as any).partnerName}</strong> vous defie en combat</div>
                </div>
              </div>
              <div className="ba-active-actions">
                <button className="ba-btn ba-btn--accept" onClick={acceptBattle}><FaUserCheck /> Accepter</button>
                <button className="ba-btn ba-btn--ghost" onClick={declineBattle}><FaXmark /> Refuser</button>
              </div>
            </>
          )}
          {/* Sent invite */}
          {isSent && (
            <>
              <div className="ba-active-left">
                <FaSpinner className="ba-spin" />
                <div>
                  <div className="ba-active-title">Defi envoye</div>
                  <div className="ba-active-desc">En attente de <strong>{battleState.partnerName}</strong>... {inviteTimer > 0 && <span className="ba-timer">{inviteTimer}s</span>}</div>
                </div>
              </div>
              <button className="ba-btn ba-btn--ghost" onClick={cancelBattle}><FaXmark /> Annuler</button>
            </>
          )}
          {/* Waiting game */}
          {battleState.phase === "waiting_game" && (
            <>
              <div className="ba-active-left">
                <FaSpinner className="ba-spin" />
                <div>
                  <div className="ba-active-title">Lancement...</div>
                  <div className="ba-active-desc">Preparation du combat dans le jeu</div>
                </div>
              </div>
              <button className="ba-btn ba-btn--ghost" onClick={cancelBattle}><FaXmark /> Annuler</button>
            </>
          )}
          {/* Relaying (live battle) */}
          {battleState.phase === "relaying" && (
            <>
              <div className="ba-active-left">
                <FaGamepad className="ba-pulse" />
                <div>
                  <div className="ba-active-title"><span className="ba-live-dot" /> EN DIRECT {spectatorCount > 0 && <span style={{ fontSize: "0.7rem", opacity: 0.7, marginLeft: 8 }}><FaUsers style={{ fontSize: "0.6rem", marginRight: 3 }} />{spectatorCount} spectateur{spectatorCount > 1 ? "s" : ""}</span>}</div>
                  <div className="ba-active-desc">Combat contre <strong>{battleState.partnerName}</strong></div>
                </div>
              </div>
              <button className="ba-btn ba-btn--ghost" onClick={cancelBattle}><FaXmark /> Abandonner</button>
            </>
          )}
          {/* Complete */}
          {battleState.phase === "complete" && (
            <>
              <div className="ba-active-left">
                {(battleState as any).endReason === "opponent_crash"
                  ? <FaTriangleExclamation style={{ color: "#facc15", fontSize: "1.4rem" }} />
                  : <FaTrophy className="ba-trophy-anim" />}
                <div>
                  <div className="ba-active-title">
                    {(battleState as any).endReason === "opponent_forfeit" ? "Victoire !" :
                     (battleState as any).endReason === "opponent_crash" ? "Match nul" :
                     "Combat termine !"}
                  </div>
                  <div className="ba-active-desc">
                    {(battleState as any).endReason === "opponent_forfeit"
                      ? <>{battleState.partnerName} a abandonne le combat</>
                      : (battleState as any).endReason === "opponent_crash"
                      ? <>Probleme technique de {battleState.partnerName}</>
                      : <>vs <strong>{battleState.partnerName}</strong></>}
                  </div>
                </div>
              </div>
              <button className="ba-btn ba-btn--primary" onClick={closeBattle}>Fermer</button>
            </>
          )}
          {/* Error */}
          {battleState.phase === "error" && (
            <>
              <div className="ba-active-left">
                <FaTriangleExclamation style={{ color: "#f87171", fontSize: "1.4rem" }} />
                <div>
                  <div className="ba-active-title" style={{ color: "#f87171" }}>Erreur</div>
                  <div className="ba-active-desc">{battleState.message}</div>
                </div>
              </div>
              <button className="ba-btn ba-btn--ghost" onClick={closeBattle}>Fermer</button>
            </>
          )}
        </div>
      )}

      {/* Two-column layout */}
      <div className="ba-columns">
        {/* LEFT — History / Room info */}
        <div className="ba-col ba-col--left">
          {/* Quick stats card */}
          <div className="ba-panel">
            <div className="ba-panel-head"><FaChartLine /> Statistiques</div>
            <div className="ba-stats-grid">
              <div className="ba-stat-box ba-stat-box--win">
                <span className="ba-stat-num">{wins}</span>
                <span className="ba-stat-lbl">Victoires</span>
              </div>
              <div className="ba-stat-box ba-stat-box--loss">
                <span className="ba-stat-num">{losses}</span>
                <span className="ba-stat-lbl">Defaites</span>
              </div>
              <div className="ba-stat-box ba-stat-box--rate">
                <span className="ba-stat-num">{total > 0 ? `${winRate}%` : "—"}</span>
                <span className="ba-stat-lbl">Ratio</span>
              </div>
              <div className="ba-stat-box ba-stat-box--total">
                <span className="ba-stat-num">{total}</span>
                <span className="ba-stat-lbl">Combats</span>
              </div>
            </div>
            {total > 0 && (
              <div className="ba-winbar">
                <div className="ba-winbar-fill" style={{ width: `${winRate}%` }} />
              </div>
            )}
          </div>

          {/* History */}
          <div className="ba-panel ba-panel--grow">
            <div className="ba-panel-head"><FaClock /> Historique recent</div>
            <div className="ba-history-list">
              {serverHistory.length === 0 && history.length === 0 && (
                <div className="ba-empty">Aucun combat pour l'instant</div>
              )}
              {(serverHistory.length > 0 ? serverHistory : history).slice(0, 15).map((h, i) => (
                <div key={i} className={`ba-history-row ba-history-row--${h.result}`}>
                  <div className={`ba-history-badge ba-history-badge--${h.result}`}>
                    {h.result === "win" ? <FaTrophy /> : h.result === "draw" ? <FaTriangleExclamation /> : <FaSkull />}
                  </div>
                  <div className="ba-history-info">
                    <span className="ba-history-name">
                      {h.result === "win"
                        ? ((h as any).reason === "opponent_forfeit" ? "Victoire (abandon)" : "Victoire")
                        : h.result === "draw"
                        ? "Match nul (bug technique)"
                        : "Defaite"} vs <strong>{(h as any).opponentName || (h as any).opponent_name || "?"}</strong>
                    </span>
                    <span className="ba-history-time">{timeAgo((h as any).date || (h as any).created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Friends */}
        <div className="ba-col ba-col--right">
          <div className="ba-panel ba-panel--grow">
            <div className="ba-panel-head">
              <FaUsers /> Amis
              <span className="ba-panel-badge">{onlineFriends.length} en ligne</span>
            </div>
            <div className="ba-friends-list">
              {friendProfiles.length === 0 && (
                <div className="ba-empty">Ajoutez des amis depuis le chat pour les defier !</div>
              )}
              {friendProfiles.map((f) => (
                <div key={f.friendUserId} className={`ba-friend ${f.online ? "" : "ba-friend--off"}`}>
                  <div className="ba-friend-av">
                    {f.avatar ? <img src={f.avatar} alt="" /> : <div className="ba-friend-ph">{f.name[0].toUpperCase()}</div>}
                    <span className={`ba-friend-dot ${f.online ? "ba-friend-dot--on" : ""}`} />
                  </div>
                  <div className="ba-friend-meta">
                    <span className="ba-friend-name">{f.name}</span>
                    {f.inGame && <span className="ba-friend-tag"><FaGamepad /> En jeu</span>}
                    {!f.online && <span className="ba-friend-tag ba-friend-tag--off">Hors ligne</span>}
                  </div>
                  {f.online && battleState.phase === "idle" && (
                    <button className="ba-challenge-btn" onClick={() => challengePlayer(f.friendUserId, f.name, f.avatar)}>
                      <FaShieldHalved /> Defier
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
