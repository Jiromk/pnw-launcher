// src/views/battleTower/BattleTowerView.tsx
// Wrapper de la Tour de Combat : navigation 3 sous-pages (Accueil / Combat Lead / Combat Amical)
// + bannière d'état de combat active (invitation / waiting / relaying / complete / error)
// qui persiste quelle que soit la sous-page.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  PlayerProfile,
  TeamMember,
} from "../../types";
import { validateTeamForBattle } from "../../banlist";
import { validateTeamStats, reportCheatToServer } from "../../statsValidator";
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
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../../supabaseClient";
import { recordBattleResult, snapshotTeam } from "../../leaderboard";
import { getLauncherUi, uiLangFromGameLang, type UiLang } from "../../launcherUiLocale";
import { BattleTowerHome } from "./BattleTowerHome";
import { CombatLeadView } from "./CombatLeadView";
import { CombatAmicalView } from "./CombatAmicalView";
import { BattleTowerProfile } from "./BattleTowerProfile";

type Page = "home" | "lead" | "amical" | "profile";

interface Props {
  session: Session;
  profile: ChatProfile;
  gameProfile?: PlayerProfile | null;
  siteUrl: string;
  /** Tableau PSDK (index = ID interne, valeur = nom FR espèce). Utilisé pour le matching banlist par nom. */
  speciesNames?: string[] | null;
  /** Recharge la save la plus récente du jeu et retourne le profil frais. */
  onProfileReload?: () => Promise<PlayerProfile | null>;
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
  gameProfile,
  siteUrl,
  speciesNames,
  onProfileReload,
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
  /** Profil actuellement consulté sur la page "profile". null = profil du joueur courant. */
  const [viewedProfile, setViewedProfile] = useState<ChatProfile | null>(null);
  const battleStartedAtRef = useRef<string>("");
  const turnCountRef = useRef(0);
  const battleResultRef = useRef<string>("");
  const lastRecordedRoomRef = useRef<string>("");
  /** Snapshot de l'équipe capturée au moment du défi/acceptation (= la vraie team utilisée en combat). */
  const battleTeamSnapshotRef = useRef<TeamMember[] | null>(null);

  // Recharger la save du jeu dès l'ouverture de la Tour de Combat
  // pour avoir l'équipe actuelle (pas celle d'une ancienne session).
  useEffect(() => {
    onProfileReload?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        {
          startedAt: battleStartedAtRef.current || null,
          endedAt: new Date().toISOString(),
          matchType: "amical", // Combat Lead pas encore lancé → tous les matchs sont amical pour l'instant
          lpDelta: null,
          myTeam: snapshotTeam(battleTeamSnapshotRef.current),
        },
      ).catch((err) => console.warn("[Battle] recordBattleResult failed:", err));
    }
  }, [battleState, session.user.id, gameProfile?.team]);

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

  /**
   * Demande au jeu d'écrire sa party live ($actors) puis la lit.
   * Pattern request/response via fichiers :
   *   1. Launcher crée vms_party_request (supprime l'ancienne réponse)
   *   2. Jeu détecte la requête (~160ms max) → écrit vms_live_party.json → supprime la requête
   *   3. Launcher poll le fichier réponse (toutes les 100ms, timeout 2s)
   * Si le jeu n'est pas lancé → timeout → fallback sur gameProfile?.team (save sur disque).
   */
  const getFreshTeam = useCallback(async (): Promise<TeamMember[] | null> => {
    try {
      // 1. Envoyer la requête (supprime aussi l'ancienne réponse)
      await invoke("cmd_battle_request_live_party");

      // 2. Attendre la réponse du jeu (poll toutes les 100ms, max 2s)
      const maxWait = 2000;
      const interval = 100;
      let elapsed = 0;
      while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, interval));
        elapsed += interval;
        const raw = await invoke<string | null>("cmd_battle_read_live_party");
        if (raw) {
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.length > 0) {
            const team: TeamMember[] = data.map((p: any): TeamMember => ({
              code: p.id ?? 0,
              form: p.form ?? null,
              level: p.level ?? null,
              nickname: p.given_name ?? null,
              speciesName: p.name ?? null,
              isShiny: p.shiny ?? null,
              ivHp: p.iv_hp ?? 0, ivAtk: p.iv_atk ?? 0, ivDfe: p.iv_dfe ?? 0,
              ivSpd: p.iv_spd ?? 0, ivAts: p.iv_ats ?? 0, ivDfs: p.iv_dfs ?? 0,
              evHp: p.ev_hp ?? 0, evAtk: p.ev_atk ?? 0, evDfe: p.ev_dfe ?? 0,
              evSpd: p.ev_spd ?? 0, evAts: p.ev_ats ?? 0, evDfs: p.ev_dfs ?? 0,
            }));
            console.log("[BattleCheck] Live party from game memory:", team.length, "Pokémon (response in", elapsed, "ms)");
            return team;
          }
        }
      }
      console.log("[BattleCheck] Game did not respond in 2s — using save fallback");
    } catch (err) {
      console.warn("[BattleCheck] Failed to request live party:", err);
    }
    // Fallback : profil chargé depuis la save (si le jeu n'est pas lancé)
    return gameProfile?.team ?? null;
  }, [gameProfile?.team]);

  /**
   * Récupère la team live et la stocke dans battleTeamSnapshotRef.
   * Appelé une seule fois au début du flow (avant banlist + stats checks).
   * Les checks suivants réutilisent cette même team.
   */
  const refreshBattleTeam = useCallback(async (): Promise<TeamMember[] | null> => {
    const team = await getFreshTeam();
    battleTeamSnapshotRef.current = team;
    return team;
  }, [getFreshTeam]);

  /** Vérifie l'équipe contre la banlist. Retourne true si OK, false si bloqué (popup affiché). */
  const checkBanlistOrShowError = useCallback(async (team: TeamMember[] | null): Promise<boolean> => {
    if (!team || team.length === 0) return true; // pas de team lue → fail-open
    const matches = await validateTeamForBattle(siteUrl, team, speciesNames ?? null);
    if (matches.length === 0) return true;
    setErrorPopup(ui.errors.bannedInTeam(matches));
    return false;
  }, [siteUrl, speciesNames, ui.errors]);

  /** Vérifie les IV/EV de l'équipe (anti-triche). Retourne true si OK, false si bloqué (popup affiché). */
  const checkStatsOrShowError = useCallback(async (team: TeamMember[] | null): Promise<boolean> => {
    if (!team || team.length === 0) return true; // pas de team lue → fail-open
    const invalid = validateTeamStats(team, speciesNames ?? null);
    if (invalid.length === 0) return true;
    setErrorPopup(ui.errors.invalidStatsInTeam(invalid));
    // Envoyer un rapport au serveur (Discord webhook) — fire-and-forget
    reportCheatToServer(siteUrl, profile, invalid);
    return false;
  }, [siteUrl, speciesNames, profile, ui.errors]);

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
      // Capturer l'équipe live + vérifs banlist + stats
      const freshTeam = await refreshBattleTeam();
      if (!(await checkBanlistOrShowError(freshTeam))) return;
      if (!(await checkStatsOrShowError(freshTeam))) return;
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
      refreshBattleTeam,
      checkBanlistOrShowError,
      checkStatsOrShowError,
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
    // Capturer l'équipe live + vérifs banlist + stats
    const freshTeam = await refreshBattleTeam();
    if (!(await checkBanlistOrShowError(freshTeam))) {
      sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
      setBattleState({ phase: "idle" });
      return;
    }
    if (!(await checkStatsOrShowError(freshTeam))) {
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
  }, [battleState, session, profile, setBattleState, battleRelayCleanupRef, ui.errors.gameNotRunningAccept, refreshBattleTeam, checkBanlistOrShowError, checkStatsOrShowError]);

  const cancelBattle = useCallback(async () => {
    const st = battleState as any;
    if (battleTimeoutRef.current) {
      clearTimeout(battleTimeoutRef.current);
      battleTimeoutRef.current = null;
    }
    if (st.phase !== "idle" && st.phase !== "complete" && st.phase !== "error") {
      sendBattleCancel(st.roomCode, st.partnerId || "", session.user.id);
    }
    // Enregistrer le résultat si le combat était en cours (relaying = battle active)
    if (
      st.phase === "relaying" &&
      st.partnerId &&
      st.roomCode &&
      st.roomCode !== lastRecordedRoomRef.current
    ) {
      lastRecordedRoomRef.current = st.roomCode;
      recordBattleResult(
        session.user.id,
        st.partnerId,
        st.roomCode,
        st.partnerName || "",
        "loss",
        "forfeit",
        {
          startedAt: battleStartedAtRef.current || null,
          endedAt: new Date().toISOString(),
          matchType: "amical",
          lpDelta: null,
          myTeam: snapshotTeam(battleTeamSnapshotRef.current),
        },
      ).catch((err) => console.warn("[Battle] recordBattleResult (forfeit) failed:", err));
    }
    await fullCleanup(battleRelayCleanupRef);
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState, battleRelayCleanupRef, battleTimeoutRef, gameProfile?.team]);

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
    <div
      className="relative h-full overflow-y-auto overscroll-contain bg-gradient-to-b from-[#0a1020] via-[#0d1224] to-[#080c18]"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(245,158,11,0.35) transparent",
        scrollbarGutter: "stable",
      }}
    >
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

      {/* Error popup — rendu via portal dans document.body pour couvrir toute la fenêtre */}
      {errorPopup && createPortal(
        <div
          className="fixed inset-0 z-[30000] flex items-center justify-center"
          onClick={() => setErrorPopup(null)}
          style={{
            background: "radial-gradient(ellipse at center, rgba(180,60,30,0.12) 0%, rgba(0,0,0,0.85) 70%)",
            backdropFilter: "blur(12px) saturate(0.6)",
            WebkitBackdropFilter: "blur(12px) saturate(0.6)",
            animation: "bt-popup-overlay-in 0.25s ease-out both",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 440,
              margin: "0 1.5rem",
              padding: 0,
              borderRadius: 24,
              overflow: "hidden",
              border: "1px solid rgba(220,50,80,0.3)",
              boxShadow: "0 0 0 1px rgba(220,50,80,0.08) inset, 0 32px 80px -24px rgba(220,50,80,0.45), 0 12px 40px rgba(0,0,0,0.65)",
              animation: "bt-popup-card-in 0.35s cubic-bezier(0.16,1,0.3,1) both",
            }}
          >
            {/* Top accent bar */}
            <div style={{
              height: 4,
              background: "linear-gradient(90deg, rgba(220,50,80,0.7), rgba(245,158,11,0.7), rgba(220,50,80,0.7))",
            }} />

            <div style={{
              background: "linear-gradient(165deg, rgba(35,15,30,0.98), rgba(18,10,28,0.99))",
              padding: "2rem 2.25rem 1.75rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
              position: "relative",
            }}>
              {/* Corner glows */}
              <div style={{
                position: "absolute", top: -40, right: -40,
                width: 200, height: 200, borderRadius: "50%",
                background: "rgba(220,50,80,0.12)", filter: "blur(60px)",
                pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", bottom: -30, left: -30,
                width: 160, height: 160, borderRadius: "50%",
                background: "rgba(245,158,11,0.08)", filter: "blur(50px)",
                pointerEvents: "none",
              }} />

              {/* Icon */}
              <div style={{
                position: "relative",
                width: 64, height: 64, borderRadius: 18,
                display: "grid", placeItems: "center",
                background: "linear-gradient(135deg, rgba(220,50,80,0.2), rgba(245,158,11,0.12))",
                border: "1px solid rgba(220,50,80,0.25)",
                boxShadow: "0 0 32px rgba(220,50,80,0.3), 0 0 0 1px rgba(220,50,80,0.1) inset",
              }}>
                <FaTriangleExclamation style={{ fontSize: "1.7rem", color: "rgba(252,211,77,0.95)", filter: "drop-shadow(0 0 12px rgba(252,211,77,0.5))" }} />
              </div>

              {/* Title + subtitle */}
              <div style={{ position: "relative", textAlign: "center" }}>
                <div style={{
                  fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.02em",
                  color: "#fff",
                }}>
                  Combat impossible
                </div>
                <div style={{
                  fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", marginTop: 4,
                }}>
                  Vérification pré-combat échouée
                </div>
              </div>

              {/* Body text — alignement gauche pour les violations multi-lignes */}
              <div style={{
                position: "relative",
                width: "100%",
                padding: "1rem 1.25rem",
                borderRadius: 14,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.06)",
                maxHeight: 280,
                overflowY: "auto",
              }}>
                <p style={{
                  whiteSpace: "pre-line",
                  fontSize: "0.82rem",
                  lineHeight: 1.7,
                  color: "rgba(255,255,255,0.8)",
                  textAlign: "left",
                  margin: 0,
                }}>
                  {errorPopup}
                </p>
              </div>

              {/* Button */}
              <button
                type="button"
                onClick={() => setErrorPopup(null)}
                style={{
                  position: "relative",
                  width: "100%",
                  padding: "0.75rem 1.5rem",
                  borderRadius: 14,
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  color: "#fff",
                  cursor: "pointer",
                  border: "none",
                  background: "linear-gradient(135deg, rgba(220,50,80,0.5), rgba(180,30,60,0.4))",
                  boxShadow: "0 0 0 1px rgba(220,50,80,0.4) inset, 0 6px 20px -6px rgba(220,50,80,0.5)",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "linear-gradient(135deg, rgba(220,50,80,0.65), rgba(180,30,60,0.55))";
                  e.currentTarget.style.boxShadow = "0 0 0 1px rgba(220,50,80,0.5) inset, 0 8px 28px -6px rgba(220,50,80,0.65)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "linear-gradient(135deg, rgba(220,50,80,0.5), rgba(180,30,60,0.4))";
                  e.currentTarget.style.boxShadow = "0 0 0 1px rgba(220,50,80,0.4) inset, 0 6px 20px -6px rgba(220,50,80,0.5)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {ui.banner.close}
              </button>
            </div>
          </div>

          {/* Animations CSS injectées */}
          <style>{`
            @keyframes bt-popup-overlay-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes bt-popup-card-in {
              from { opacity: 0; transform: scale(0.92) translateY(16px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>,
        document.body,
      )}

      {/* Topbar : Back + Nav pills (gauche) + Profil avec avatar (droite) */}
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

          {/* Spacer pour pousser Profil à droite */}
          <div className="flex-1" />

          {/* Bouton Profil avec avatar circulaire */}
          <button
            type="button"
            onClick={() => {
              setViewedProfile(null); // Toujours revenir à son propre profil depuis la nav
              setPage("profile");
            }}
            aria-label={ui.nav.profile}
            className={`group flex shrink-0 items-center gap-2.5 rounded-2xl border py-1.5 pl-1.5 pr-4 backdrop-blur-sm transition duration-300 ${
              page === "profile"
                ? "border-amber-400/40 bg-amber-500/[0.12] shadow-[0_6px_20px_-8px_rgba(245,158,11,0.4)]"
                : "border-white/[0.08] bg-white/[0.03] hover:border-amber-400/25 hover:bg-white/[0.06]"
            }`}
          >
            <span
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 transition ${
                page === "profile" ? "ring-amber-300/60" : "ring-white/15 group-hover:ring-amber-300/30"
              }`}
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-bold uppercase text-amber-200">
                  {(profile.display_name || profile.username || "?").charAt(0)}
                </span>
              )}
            </span>
            <span
              className={`text-sm font-semibold tracking-tight transition ${
                page === "profile" ? "text-amber-100" : "text-white/75 group-hover:text-white"
              }`}
            >
              {ui.nav.profile}
            </span>
          </button>
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
            siteUrl={siteUrl}
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
            onViewProfile={(p) => {
              setViewedProfile(p);
              setPage("profile");
            }}
            battleStateIsIdle={battleState.phase === "idle"}
          />
        )}
        {page === "profile" && (
          <BattleTowerProfile
            labels={ui.profile}
            profile={viewedProfile ?? profile}
            isSelf={!viewedProfile || viewedProfile.id === session.user.id}
            onBack={() => {
              setViewedProfile(null);
              setPage("amical");
            }}
            onViewOpponent={(opponentId) => {
              // Chercher le profil dans les membres connus
              const found = allMembers.find((m) => m.id === opponentId);
              if (found) {
                setViewedProfile(found);
              } else {
                // Fallback : créer un profil minimal depuis l'ID (le composant fetche les stats de toute façon)
                supabase
                  .from("profiles")
                  .select("id, discord_id, username, display_name, avatar_url, banner_url, bio, roles, created_at")
                  .eq("id", opponentId)
                  .single()
                  .then(({ data }) => {
                    if (data) setViewedProfile(data as ChatProfile);
                  });
              }
            }}
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
