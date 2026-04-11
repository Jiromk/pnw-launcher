// src/views/battleTower/BattleTowerView.tsx
// Wrapper de la Tour de Combat : navigation 3 sous-pages (Accueil / Combat Lead / Combat Amical)
// + bannière d'état de combat active (invitation / waiting / relaying / complete / error)
// qui persiste quelle que soit la sous-page.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  FaArrowLeft,
  FaBolt,
  FaGamepad,
  FaShieldHalved,
  FaSpinner,
  FaSkull,
  FaTriangleExclamation,
  FaTrophy,
  FaUserCheck,
  FaUsers,
  FaXmark,
} from "react-icons/fa6";
import type {
  BattleRoomState,
  ChatChannel,
  ChatProfile,
  GameLivePlayer,
} from "../../types";
import {
  BATTLE_INVITE_TIMEOUT,
  cleanupBattleFiles,
  fullCleanup,
  generateRoomCode,
  isGameRunning,
  saveBattleLog,
  sendBattleAccept,
  sendBattleCancel,
  sendBattleDecline,
  sendBattleInvite,
  startRelay,
  writeBattleTrigger,
  writeOpponentLeft,
  writeStopTrigger,
  _currentBattleEventLog,
  _currentBattleTurnLog,
} from "../../battleRelay";
import { supabase } from "../../supabaseClient";
import { recordBattleResult } from "../../leaderboard";
import { getLauncherUi, uiLangFromGameLang, type UiLang } from "../../launcherUiLocale";
import { BattleTowerHome } from "./BattleTowerHome";
import { CombatLeadView } from "./CombatLeadView";
import { CombatAmicalView } from "./CombatAmicalView";

type Page = "home" | "lead" | "amical";

interface Props {
  session: Session;
  profile: ChatProfile;
  allMembers: ChatProfile[];
  onlineUserIds: Set<string>;
  gameLivePlayers: Map<string, GameLivePlayer>;
  channels: ChatChannel[];
  battleState: BattleRoomState;
  setBattleState: React.Dispatch<React.SetStateAction<BattleRoomState>>;
  battleRelayCleanupRef: React.MutableRefObject<(() => void) | null>;
  battleTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  uiLang?: UiLang;
  onBack: () => void;
}

export default function BattleTowerView({
  session,
  profile,
  allMembers,
  onlineUserIds,
  gameLivePlayers,
  channels,
  battleState,
  setBattleState,
  battleRelayCleanupRef,
  battleTimeoutRef,
  uiLang,
  onBack,
}: Props) {
  const ui = useMemo(
    () => getLauncherUi(uiLang ?? uiLangFromGameLang("fr")).battleTower,
    [uiLang],
  );

  const [page, setPage] = useState<Page>("home");
  const [errorPopup, setErrorPopup] = useState<string | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [inviteTimer, setInviteTimer] = useState(0);
  const battleStartedAtRef = useRef<string>("");
  const turnCountRef = useRef(0);
  const battleResultRef = useRef<string>("");
  const lastRecordedRoomRef = useRef<string>("");

  // Record battle result when a match completes (stats fetch/display is out of scope; we still persist to Supabase).
  useEffect(() => {
    if (battleState.phase !== "complete") return;
    const st = battleState as any;
    const endReason = st.endReason;
    let result: string = "draw";
    if (endReason === "opponent_forfeit") result = "win";
    else if (endReason === "opponent_crash") result = "draw";
    else if (endReason === "crash") result = "draw"; // Notre propre crash technique → nul
    else if (endReason === "forfeit") result = "loss"; // Abandon volontaire → defaite
    else if (endReason === "game_end") result = st.battleResult || battleResultRef.current || "draw";

    const validResult = result === "win" || result === "loss" || result === "draw";
    if (
      endReason &&
      st.partnerId &&
      st.roomCode !== lastRecordedRoomRef.current &&
      validResult
    ) {
      lastRecordedRoomRef.current = st.roomCode;
      recordBattleResult(
        session.user.id,
        st.partnerId,
        st.roomCode,
        st.partnerName,
        result as "win" | "loss" | "draw",
        endReason,
      ).catch(() => {});
    }
  }, [battleState, session.user.id]);

  // Countdown timer for sent invite
  useEffect(() => {
    if (battleState.phase !== "inviting" || !(battleState as any).startedAt) {
      setInviteTimer(0);
      return;
    }
    const start = (battleState as any).startedAt as number;
    const iv = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((BATTLE_INVITE_TIMEOUT - (Date.now() - start)) / 1000),
      );
      setInviteTimer(remaining);
      if (remaining <= 0) clearInterval(iv);
    }, 500);
    return () => clearInterval(iv);
  }, [battleState.phase, (battleState as any).startedAt]);

  // ── Actions ──

  const challengePlayer = useCallback(
    async (target: ChatProfile) => {
      // Autoriser le defi si idle OU complete (la banniere de fin sera ecrasee par le nouveau defi)
      // Bloquer dans tous les autres etats actifs (inviting/waiting_game/relaying/error)
      if (battleState.phase !== "idle" && battleState.phase !== "complete" && battleState.phase !== "error") return;
      const running = await isGameRunning();
      if (!running) {
        setErrorPopup(ui.errors.gameNotRunning);
        return;
      }
      // Reset l'etat avant de lancer le nouveau defi (efface la banniere de fin)
      if (battleState.phase === "complete" || battleState.phase === "error") {
        setBattleState({ phase: "idle" });
      }
      await fullCleanup(battleRelayCleanupRef);
      const roomCode = generateRoomCode();
      let dmChannelId = 0;
      for (const c of channels) {
        if (c.type !== "dm") continue;
        const { data: members } = await supabase
          .from("channel_members")
          .select("user_id")
          .eq("channel_id", c.id);
        if (members?.some((m: any) => m.user_id === target.id)) {
          dmChannelId = c.id;
          break;
        }
      }
      if (!dmChannelId) {
        try {
          const { data } = await supabase.rpc("create_dm_channel", {
            target_user_id: target.id,
          });
          if (data) dmChannelId = data;
        } catch {}
      }
      const sent = sendBattleInvite({
        roomCode,
        fromId: session.user.id,
        fromName: profile.display_name || profile.username,
        fromAvatar: profile.avatar_url,
        toId: target.id,
        dmChannelId,
      });
      if (!sent) {
        setErrorPopup(ui.errors.serverUnavailable);
        return;
      }
      setBattleState({
        phase: "inviting",
        roomCode,
        partnerId: target.id,
        partnerName: target.display_name || target.username,
        partnerAvatar: target.avatar_url,
        dmChannelId,
        startedAt: Date.now(),
      });
      battleTimeoutRef.current = setTimeout(() => {
        setBattleState((prev) => {
          if (prev.phase !== "inviting") return prev;
          cleanupBattleFiles();
          return { phase: "idle" };
        });
      }, BATTLE_INVITE_TIMEOUT);
    },
    [
      battleState.phase,
      channels,
      session,
      profile,
      setBattleState,
      battleTimeoutRef,
      battleRelayCleanupRef,
      ui.errors.gameNotRunning,
      ui.errors.serverUnavailable,
    ],
  );

  const acceptBattle = useCallback(async () => {
    const st = battleState as any;
    const running = await isGameRunning();
    if (!running) {
      setErrorPopup(ui.errors.gameNotRunningAccept);
      sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
      setBattleState({ phase: "idle" });
      return;
    }
    await fullCleanup(battleRelayCleanupRef);
    sendBattleAccept(st.roomCode, st.partnerId, session.user.id, profile.display_name || profile.username);
    setBattleState({ ...st, phase: "waiting_game" });
    try {
      await writeBattleTrigger(Number(st.roomCode), st.partnerName, "client");
    } catch (e) {
      console.error("[Battle] writeBattleTrigger FAILED:", e);
    }
    battleStartedAtRef.current = new Date().toISOString();
    turnCountRef.current = 0;
    battleResultRef.current = "";
    const cleanup = startRelay(
      st.roomCode,
      session.user.id,
      () =>
        setBattleState((prev) =>
          (prev as any).roomCode === st.roomCode
            ? ({ ...prev, phase: "relaying" } as any)
            : prev,
        ),
      (reason) => {
        const result =
          reason === "opponent_forfeit"
            ? "win"
            : reason === "opponent_crash"
              ? "draw" // Crash adverse → match nul
              : reason === "crash"
                ? "draw" // Notre propre crash technique → match nul
                : reason === "forfeit"
                  ? "loss" // Notre abandon volontaire (bouton) → defaite
                  : reason === "game_end"
                    ? battleResultRef.current || "unknown" // Alt-F4 : VMS a ecrit loss via outbox
                    : "unknown";
        saveBattleLog({
          roomCode: st.roomCode,
          myUserId: session.user.id,
          partnerId: st.partnerId,
          partnerName: st.partnerName,
          result,
          reason: reason || "unknown",
          turns: turnCountRef.current,
          startedAt: battleStartedAtRef.current,
          endedAt: new Date().toISOString(),
          turnLog: [..._currentBattleTurnLog],
          eventLog: [..._currentBattleEventLog],
        });
        setSpectatorCount(0);
        // Ecrire opponent_left dans l'inbox + delai pour que le jeu le lise avant cleanup
        writeOpponentLeft(reason || "unknown")
          .then(() => new Promise(r => setTimeout(r, 2500))) // 2.5s pour que le jeu traite le signal
          .then(() => writeStopTrigger())
          .then(() => cleanupBattleFiles());
        setBattleState({
          phase: "complete",
          roomCode: st.roomCode,
          partnerId: st.partnerId,
          partnerName: st.partnerName,
          endReason: reason,
          battleResult: result,
        } as any);
      },
      () => {
        turnCountRef.current++;
      },
      (count) => {
        setSpectatorCount(count);
      },
      (result) => {
        battleResultRef.current = result;
      },
    );
    battleRelayCleanupRef.current = cleanup;
  }, [battleState, session, profile, setBattleState, battleRelayCleanupRef, ui.errors.gameNotRunningAccept]);

  const cancelBattle = useCallback(async () => {
    const st = battleState as any;
    if (battleTimeoutRef.current) {
      clearTimeout(battleTimeoutRef.current);
      battleTimeoutRef.current = null;
    }
    if (st.phase !== "idle" && st.phase !== "complete" && st.phase !== "error") {
      sendBattleCancel(st.roomCode, st.partnerId || "", session.user.id);
    }
    await fullCleanup(battleRelayCleanupRef);
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState, battleRelayCleanupRef, battleTimeoutRef]);

  const closeBattle = useCallback(async () => {
    await cleanupBattleFiles();
    setBattleState({ phase: "idle" });
  }, [setBattleState]);

  const declineBattle = useCallback(async () => {
    const st = battleState as any;
    sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
    cleanupBattleFiles();
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState]);

  // ── Derived flags ──
  const isActive = battleState.phase !== "idle";
  const isIncoming =
    battleState.phase === "inviting" && (battleState as any).startedAt == null;
  const isSent =
    battleState.phase === "inviting" && (battleState as any).startedAt != null;

  const stAny = battleState as any;

  return (
    <div className="relative min-h-full overflow-y-auto bg-gradient-to-b from-[#0a1020] via-[#0d1224] to-[#080c18]">
      {/* Animated background orbs (pointer-events none) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-40 h-[540px] w-[540px] rounded-full bg-emerald-500/[0.06] blur-[110px]"
          style={{ animation: "update-orb-1 18s ease-in-out infinite" }}
        />
        <div
          className="absolute -bottom-48 -right-48 h-[500px] w-[500px] rounded-full bg-amber-500/[0.07] blur-[110px]"
          style={{ animation: "update-orb-2 20s ease-in-out infinite" }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-sky-500/[0.04] blur-[100px]"
          style={{ animation: "update-orb-1 22s ease-in-out infinite reverse" }}
        />
      </div>

      {/* Error popup */}
      {errorPopup && (
        <div
          className="fixed inset-0 z-[30000] flex items-center justify-center bg-black/80 backdrop-blur-md"
          onClick={() => setErrorPopup(null)}
        >
          <div
            className="mx-6 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-amber-400/25 bg-gradient-to-b from-[#1a1226] to-[#0d0918] p-6 text-center ring-1 ring-inset ring-amber-400/10 shadow-[0_20px_60px_-20px_rgba(245,158,11,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <FaTriangleExclamation className="text-3xl text-amber-300" />
            <p className="text-sm text-white/85">{errorPopup}</p>
            <button
              type="button"
              onClick={() => setErrorPopup(null)}
              className="rounded-xl bg-amber-500/20 px-5 py-2 text-sm font-semibold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-500/30"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Topbar : Back + Nav pills */}
      <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0a1020]/75 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
            aria-label="Retour"
          >
            <FaArrowLeft className="text-sm" />
          </button>

          <div className="flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-sm">
            <NavPill
              active={page === "home"}
              onClick={() => setPage("home")}
              label={ui.nav.home}
              icon={<FaShieldHalved className="text-xs" />}
            />
            <NavPill
              active={page === "lead"}
              onClick={() => setPage("lead")}
              label={ui.nav.lead}
              icon={<FaTrophy className="text-xs" />}
            />
            <NavPill
              active={page === "amical"}
              onClick={() => setPage("amical")}
              label={ui.nav.amical}
              icon={<FaUsers className="text-xs" />}
            />
          </div>
        </div>
      </div>

      {/* Active battle banner (persists across sub-pages) */}
      {isActive && (
        <div
          className={
            "relative z-10 border-b border-white/[0.06] px-6 py-4 backdrop-blur-md " +
            (battleState.phase === "relaying"
              ? "bg-gradient-to-r from-rose-500/[0.12] via-amber-500/[0.08] to-rose-500/[0.12]"
              : "bg-gradient-to-r from-sky-500/[0.08] via-emerald-500/[0.06] to-sky-500/[0.08]")
          }
          style={{ animation: "update-page-in 0.3s ease-out both" }}
        >
          <div className="mx-auto flex max-w-7xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* ── Incoming ── */}
            {isIncoming && (
              <>
                <div className="flex items-center gap-3">
                  {stAny.partnerAvatar && (
                    <img
                      src={stAny.partnerAvatar}
                      alt=""
                      className="h-11 w-11 rounded-full ring-2 ring-amber-400/40"
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
                      <FaBolt className="text-xs" /> {ui.banner.incomingTitle}
                    </div>
                    <div className="text-xs text-white/65">
                      {ui.banner.incomingDesc(stAny.partnerName ?? "?")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptBattle}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/25 px-4 py-2 text-sm font-bold text-emerald-100 ring-1 ring-emerald-400/35 transition hover:bg-emerald-500/35"
                  >
                    <FaUserCheck className="text-xs" /> {ui.banner.accept}
                  </button>
                  <button
                    type="button"
                    onClick={declineBattle}
                    className="inline-flex items-center gap-2 rounded-xl bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    <FaXmark className="text-xs" /> {ui.banner.decline}
                  </button>
                </div>
              </>
            )}

            {/* ── Sent ── */}
            {isSent && (
              <>
                <div className="flex items-center gap-3">
                  <FaSpinner className="animate-spin text-base text-sky-300" />
                  <div>
                    <div className="text-sm font-bold text-white/90">
                      {ui.banner.sentTitle}
                    </div>
                    <div className="text-xs text-white/65">
                      {ui.banner.sentDesc(stAny.partnerName ?? "?")}
                      {inviteTimer > 0 && (
                        <span className="ml-2 rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-white/80">
                          {inviteTimer}s
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelBattle}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <FaXmark className="text-xs" /> {ui.banner.cancel}
                </button>
              </>
            )}

            {/* ── Waiting game ── */}
            {battleState.phase === "waiting_game" && (
              <>
                <div className="flex items-center gap-3">
                  <FaSpinner className="animate-spin text-base text-sky-300" />
                  <div>
                    <div className="text-sm font-bold text-white/90">
                      {ui.banner.waitingTitle}
                    </div>
                    <div className="text-xs text-white/65">{ui.banner.waitingDesc}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelBattle}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <FaXmark className="text-xs" /> {ui.banner.cancel}
                </button>
              </>
            )}

            {/* ── Relaying / Live ── */}
            {battleState.phase === "relaying" && (
              <>
                <div className="flex items-center gap-3">
                  <FaGamepad
                    className="text-xl text-rose-300"
                    style={{ animation: "update-glow-pulse 1.5s ease-in-out infinite" }}
                  />
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-rose-100">
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-rose-400"
                        style={{ animation: "update-glow-pulse 1.2s ease-in-out infinite" }}
                      />
                      {ui.banner.liveTitle}
                      {spectatorCount > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium opacity-75">
                          <FaUsers className="text-[9px]" />
                          {ui.banner.spectators(spectatorCount)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/65">
                      {ui.banner.liveDesc(stAny.partnerName ?? "?")}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelBattle}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-500/[0.12] px-4 py-2 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/25 transition hover:bg-rose-500/20"
                >
                  <FaXmark className="text-xs" /> {ui.banner.forfeit}
                </button>
              </>
            )}

            {/* ── Complete ── */}
            {battleState.phase === "complete" && (
              <>
                <div className="flex items-center gap-3">
                  {(stAny.endReason === "opponent_crash" || stAny.endReason === "crash") ? (
                    <FaTriangleExclamation className="text-2xl text-amber-300" />
                  ) : stAny.endReason === "forfeit" ? (
                    <FaSkull className="text-2xl text-rose-300" />
                  ) : stAny.endReason === "game_end" && stAny.battleResult === "loss" ? (
                    <FaSkull className="text-2xl text-rose-300" />
                  ) : (
                    <FaTrophy className="text-2xl text-amber-300" />
                  )}
                  <div>
                    <div className="text-sm font-bold text-white/90">
                      {stAny.endReason === "opponent_forfeit"
                        ? ui.banner.completeWin
                        : (stAny.endReason === "opponent_crash" || stAny.endReason === "crash")
                          ? ui.banner.completeDraw
                          : stAny.endReason === "forfeit"
                            ? ui.banner.completeLoss
                            : stAny.endReason === "game_end" && stAny.battleResult === "win"
                              ? ui.banner.completeWin
                              : stAny.endReason === "game_end" && stAny.battleResult === "loss"
                                ? ui.banner.completeLoss
                                : ui.banner.completeGeneric}
                    </div>
                    <div className="text-xs text-white/65">
                      {stAny.endReason === "opponent_forfeit"
                        ? ui.banner.forfeitReason(stAny.partnerName ?? "?")
                        : stAny.endReason === "opponent_crash"
                          ? ui.banner.crashReason(stAny.partnerName ?? "?")
                          : stAny.endReason === "crash"
                            ? `Problème technique (match nul) vs ${stAny.partnerName ?? "?"}`
                            : stAny.endReason === "forfeit"
                              ? `Abandon vs ${stAny.partnerName ?? "?"}`
                              : `vs ${stAny.partnerName ?? "?"}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeBattle}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 ring-1 ring-emerald-400/30 transition hover:bg-emerald-500/30"
                >
                  {ui.banner.close}
                </button>
              </>
            )}

            {/* ── Error ── */}
            {battleState.phase === "error" && (
              <>
                <div className="flex items-center gap-3">
                  <FaTriangleExclamation className="text-2xl text-rose-300" />
                  <div>
                    <div className="text-sm font-bold text-rose-200">
                      {ui.banner.errorTitle}
                    </div>
                    <div className="text-xs text-white/65">
                      {(battleState as any).message}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeBattle}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/75 ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  {ui.banner.close}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sub-page content */}
      <div className="relative z-0">
        {page === "home" && (
          <BattleTowerHome
            labels={ui.home}
            onNavigate={(p) => setPage(p)}
          />
        )}
        {page === "lead" && <CombatLeadView labels={ui.lead} />}
        {page === "amical" && (
          <CombatAmicalView
            labels={{
              ...ui.amical,
              statLabels: ui.home.statLabels,
              statsPlaceholder: ui.home.statsPlaceholder,
            }}
            allMembers={allMembers}
            onlineUserIds={onlineUserIds}
            gameLivePlayers={gameLivePlayers}
            currentUserId={session.user.id}
            onChallenge={challengePlayer}
            battleStateIsIdle={battleState.phase === "idle"}
          />
        )}
      </div>
    </div>
  );
}

function NavPill({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition " +
        (active
          ? "bg-gradient-to-br from-white/[0.12] to-white/[0.04] text-white ring-1 ring-white/15 shadow-[0_4px_20px_-8px_rgba(255,255,255,0.2)]"
          : "text-white/55 hover:bg-white/[0.04] hover:text-white/80")
      }
    >
      {icon}
      {label}
    </button>
  );
}
