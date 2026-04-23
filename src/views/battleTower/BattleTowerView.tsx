// src/views/battleTower/BattleTowerView.tsx
// Wrapper de la Tour de Combat : navigation 3 sous-pages (Accueil / Combat Lead / Combat Amical)
// + bannière d'état de combat active (invitation / waiting / relaying / complete / error)
// qui persiste quelle que soit la sous-page.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import {
  FaArrowLeft,
  FaArrowRightArrowLeft,
  FaBolt,
  FaChevronRight,
  FaChartPie,
  FaDice,
  FaDna,
  FaGamepad,
  FaGem,
  FaHandFist,
  FaHandshake,
  FaHeart,
  FaLayerGroup,
  FaLeaf,
  FaMars,
  FaScaleBalanced,
  FaShield,
  FaShieldHalved,
  FaSpinner,
  FaSkull,
  FaStar,
  FaTriangleExclamation,
  FaTrophy,
  FaUserCheck,
  FaUsers,
  FaVenus,
  FaWandMagicSparkles,
  FaXmark,
} from "react-icons/fa6";
import { NATURE_FR } from "../../gtsDepositedPokemon";
import type {
  BattleRoomState,
  BoxPokemon,
  ChatChannel,
  ChatProfile,
  GameLivePlayer,
  PlayerProfile,
  TeamMember,
  TradeSelection,
  TradeSelectionPreview,
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
  writeBetTransferTrigger,
  writeOpponentLeft,
  writeStopTrigger,
  _currentBattleEventLog,
  _currentBattleTurnLog,
} from "../../battleRelay";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../../supabaseClient";
import { extractBetPokemon, sendBetTransfer, saveBetToSupabase, completeBet, pollBetDone } from "../../betTransfer";
import { extractAndEncode } from "../../tradeP2P";
import PCBoxView from "../PCBoxView";
import { fetchPvpStats, recordBattleResult, snapshotTeam, type PvpStats } from "../../leaderboard";
import {
  attachRankedQueueListeners,
  sendRankedQueueJoin,
  sendRankedQueueLeave,
  sendRankedAccept,
  sendRankedDecline,
  type RankedMatchCancelReason,
  type RankedMatchFoundPayload,
  type RankedQueueJoinedPayload,
} from "../../battleRelay";
import { getLauncherUi, uiLangFromGameLang, type UiLang } from "../../launcherUiLocale";
import { BattleTowerHome } from "./BattleTowerHome";
import { CombatLeadView } from "./CombatLeadView";
import { CombatAmicalView } from "./CombatAmicalView";
import { BattleTowerProfile } from "./BattleTowerProfile";
import { RankedQueueModal } from "./RankedQueueModal";
import { MatchFoundPopup } from "./MatchFoundPopup";
import { PromotionCelebration } from "./PromotionCelebration";
import type { RankTier } from "../../ranked";

type Page = "home" | "lead" | "amical" | "profile";

interface Props {
  session: Session;
  profile: ChatProfile;
  gameProfile?: PlayerProfile | null;
  siteUrl: string;
  /** Chemin de la sauvegarde la plus récente (pour extraction B64 du pari). */
  savePath?: string | null;
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
  savePath: savePropPath,
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

  // ── Ranked matchmaking state ──
  const [myPvpStats, setMyPvpStats] = useState<PvpStats | null>(null);
  const [rankedSearching, setRankedSearching] = useState(false);
  const [rankedJoined, setRankedJoined] = useState<RankedQueueJoinedPayload | null>(null);
  const [rankedWaitMs, setRankedWaitMs] = useState(0);
  const [rankedMmrWindow, setRankedMmrWindow] = useState<number | null>(null);
  const [rankedError, setRankedError] = useState<string | null>(null);
  const [matchFound, setMatchFound] = useState<RankedMatchFoundPayload | null>(null);
  const [matchFoundWaiting, setMatchFoundWaiting] = useState(false);
  const [matchFoundCancelReason, setMatchFoundCancelReason] = useState<RankedMatchCancelReason | null>(null);
  // Animation de promotion après match ranked
  const [promotionTier, setPromotionTier] = useState<RankTier | null>(null);
  const [promotionIsPlacement, setPromotionIsPlacement] = useState(false);
  const battleStartedAtRef = useRef<string>("");
  const turnCountRef = useRef(0);
  const battleResultRef = useRef<string>("");
  const lastRecordedRoomRef = useRef<string>("");
  /** Snapshot de l'équipe capturée au moment du défi/acceptation (= la vraie team utilisée en combat). */
  const battleTeamSnapshotRef = useRef<TeamMember[] | null>(null);

  // ── Bet mode state ──
  /** Target en attente du choix de mode (Normal / Parier). null = pas de modal. */
  const [pendingChallenge, setPendingChallenge] = useState<ChatProfile | null>(null);
  /** Chemin de la dernière save connue (pour extraction B64 du pari). */
  const lastSavePathRef = useRef<string | null>(savePropPath ?? null);
  useEffect(() => {
    if (savePropPath) lastSavePathRef.current = savePropPath;
  }, [savePropPath]);
  /** Ref pour le channel Supabase broadcast (échange de sélections en temps réel). */
  const betChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Charge les stats PvP au montage + quand on revient de la page profile ──
  const refreshPvpStats = useCallback(async () => {
    try {
      const s = await fetchPvpStats(session.user.id);
      setMyPvpStats(s);
    } catch {
      /* silent — la tile my rank restera en skeleton */
    }
  }, [session.user.id]);
  useEffect(() => {
    refreshPvpStats();
  }, [refreshPvpStats]);

  // ── Ranked queue listeners (actifs en permanence sur BattleTowerView pour
  //    capter les events même quand on navigue entre pages). ──
  useEffect(() => {
    const cleanup = attachRankedQueueListeners({
      onJoined: (p) => {
        setRankedJoined(p);
        setRankedError(null);
      },
      onStatus: ({ waitMs, mmrWindow }) => {
        setRankedWaitMs(waitMs);
        setRankedMmrWindow(mmrWindow);
      },
      onMatchFound: (payload) => {
        setMatchFound(payload);
        setMatchFoundWaiting(false);
        setMatchFoundCancelReason(null);
      },
      onMatchStart: async (payload) => {
        // Les 2 joueurs ont accepté — on ferme la modal et on lance le combat
        setMatchFound(null);
        setMatchFoundWaiting(false);
        setMatchFoundCancelReason(null);
        setRankedSearching(false);
        setRankedJoined(null);
        setRankedWaitMs(0);

        // Vérifie que le jeu est lancé
        const gameUp = await isGameRunning();
        if (!gameUp) {
          setErrorPopup(ui.banner.errorTitle);
          return;
        }

        // Nettoyage d'un éventuel précédent relay
        await fullCleanup(battleRelayCleanupRef);

        // Init battle state côté client
        setBattleState({
          phase: "waiting_game",
          roomCode: payload.roomCode,
          partnerId: payload.opponent.id,
          partnerName: payload.opponent.name,
          partnerAvatar: null,
          dmChannelId: 0,
          matchType: "ranked",
        });

        // Rafraichit l'équipe
        try {
          const team = await getFreshTeam();
          battleTeamSnapshotRef.current = team;
        } catch {
          /* silent */
        }

        // Ecrit le trigger au jeu — rôle "host" pour A et "client" pour B,
        // on détermine via l'ordre alphabétique des userIds (source déterministe).
        const role: "host" | "client" =
          session.user.id < payload.opponent.id ? "host" : "client";
        try {
          await writeBattleTrigger(
            Number(payload.roomCode),
            payload.opponent.name,
            role,
          );
        } catch (e) {
          console.error("[RankedMatch] writeBattleTrigger failed:", e);
        }

        battleStartedAtRef.current = new Date().toISOString();
        turnCountRef.current = 0;
        battleResultRef.current = "";

        // Démarre le relay (même mécanique que l'amical)
        const cleanupRelay = startRelay(
          payload.roomCode,
          session.user.id,
          () =>
            setBattleState((prev) =>
              (prev as any).roomCode === payload.roomCode
                ? ({ ...prev, phase: "relaying" } as any)
                : prev,
            ),
          (reason) => {
            const result =
              reason === "opponent_forfeit" || reason === "opponent_game_end"
                ? battleResultRef.current || "win"
                : reason === "opponent_crash" || reason === "crash"
                  ? "draw"
                  : reason === "forfeit"
                    ? "loss"
                    : reason === "game_end"
                      ? battleResultRef.current || "unknown"
                      : "unknown";
            setBattleState((prev) =>
              (prev as any).roomCode === payload.roomCode
                ? ({ ...prev, phase: "complete", endReason: reason, battleResult: result } as any)
                : prev,
            );
          },
          undefined,
          (count) => setSpectatorCount(count),
          (result) => {
            battleResultRef.current = result;
          },
        );
        battleRelayCleanupRef.current = cleanupRelay;
      },
      onMatchCancelled: ({ reason }) => {
        setMatchFoundCancelReason(reason);
        setMatchFoundWaiting(false);
        // Si c'est un timeout / declined, on garde la queue ouverte
        // mais on vide le matchFound pour pouvoir relancer la recherche
        setTimeout(() => {
          setMatchFound(null);
          setMatchFoundCancelReason(null);
        }, 2500);
      },
      onLeft: () => {
        setRankedSearching(false);
        setRankedJoined(null);
        setRankedWaitMs(0);
        setRankedMmrWindow(null);
      },
      onError: (msg) => {
        setRankedError(msg);
      },
    });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  // ── Handlers pour le bouton "Chercher un match" ──
  const onStartRankedSearch = useCallback(async () => {
    // Vérifie que le jeu est lancé avant de queue-up
    const gameUp = await isGameRunning();
    if (!gameUp) {
      setErrorPopup(ui.lead.queueBtnNeedGame);
      return;
    }
    setRankedSearching(true);
    setRankedError(null);
    setRankedWaitMs(0);
    setRankedMmrWindow(null);
    setRankedJoined(null);
    sendRankedQueueJoin(
      session.user.id,
      profile.display_name || profile.username || "Joueur",
    );
  }, [session.user.id, profile.display_name, profile.username, ui.lead.queueBtnNeedGame]);

  const onCancelRankedSearch = useCallback(() => {
    sendRankedQueueLeave(session.user.id);
    setRankedSearching(false);
    setRankedJoined(null);
    setRankedWaitMs(0);
    setRankedMmrWindow(null);
    setRankedError(null);
  }, [session.user.id]);

  const onAcceptMatch = useCallback(() => {
    if (!matchFound) return;
    sendRankedAccept(matchFound.roomCode, session.user.id);
    setMatchFoundWaiting(true);
  }, [matchFound, session.user.id]);

  const onDeclineMatch = useCallback(() => {
    if (!matchFound) return;
    sendRankedDecline(matchFound.roomCode, session.user.id);
    setMatchFound(null);
    setMatchFoundWaiting(false);
    setRankedSearching(false);
    setRankedJoined(null);
  }, [matchFound, session.user.id]);

  const onDismissMatchFound = useCallback(() => {
    setMatchFound(null);
    setMatchFoundCancelReason(null);
    setMatchFoundWaiting(false);
  }, []);
  /** Statut de la confirmation du transfert de pari par le jeu. */
  const [betTransferStatus, setBetTransferStatus] = useState<string | null>(null);
  /** Affiche le hint "retournez sur la carte" après 5s en waiting_game. */
  const [showWaitingHint, setShowWaitingHint] = useState(false);
  /** Sélection en attente de confirmation (le joueur a cliqué un Pokémon mais pas encore "Confirmer"). */
  const [pendingBetSelection, setPendingBetSelection] = useState<TradeSelection | null>(null);

  // Recharger la save du jeu dès l'ouverture de la Tour de Combat
  // pour avoir l'équipe actuelle (pas celle d'une ancienne session).
  useEffect(() => {
    onProfileReload?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Record battle result when a match completes.
  useEffect(() => {
    if (battleState.phase !== "complete") return;
    const st = battleState as any;
    const endReason = st.endReason;
    let result: string = "draw";
    if (endReason === "opponent_forfeit") result = "win";
    else if (endReason === "opponent_game_end") result = st.battleResult || battleResultRef.current || "loss";
    else if (endReason === "opponent_crash") result = "draw";
    else if (endReason === "crash") result = "draw";
    else if (endReason === "forfeit") result = "loss";
    else if (endReason === "game_end") result = st.battleResult || battleResultRef.current || "draw";

    const validResult = result === "win" || result === "loss" || result === "draw";
    if (
      endReason &&
      st.partnerId &&
      st.roomCode !== lastRecordedRoomRef.current &&
      validResult
    ) {
      lastRecordedRoomRef.current = st.roomCode;
      const doRecord = async () => {
        let teamForRecord = battleTeamSnapshotRef.current;
        if (!teamForRecord || teamForRecord.length === 0) {
          teamForRecord = await getFreshTeam();
        }
        const matchTypeForRecord = (st.matchType as "amical" | "ranked" | undefined) ?? "amical";
        const rankedResult = await recordBattleResult(
          session.user.id,
          st.partnerId,
          st.roomCode,
          st.partnerName,
          result as "win" | "loss" | "draw",
          endReason,
          {
            startedAt: battleStartedAtRef.current || null,
            endedAt: new Date().toISOString(),
            matchType: matchTypeForRecord,
            lpDelta: null,
            myTeam: snapshotTeam(teamForRecord),
            betMode: st.betMode || false,
            betPokemonPreview: st.myBet ? (({ boxIdx: _b, slotIdx: _s, pokemonB64: _p, ...rest }: any) => rest)(st.myBet) : undefined,
          },
        );

        // ── Animation de promotion si ranked + promotion réelle ──
        if (rankedResult && rankedResult.wasRecorded) {
          // Refresh stats affichées sur CombatLeadView / profil
          refreshPvpStats();
          const isPlacementComplete =
            rankedResult.isPlacement && rankedResult.placementPlayed >= 5;
          if (rankedResult.promoted || isPlacementComplete) {
            setPromotionTier(rankedResult.newTier);
            setPromotionIsPlacement(isPlacementComplete);
          }
        }
        // ── Bet transfer trigger ──
        if (st.betMode && (result === "win" || result === "loss" || result === "draw")) {
          const r = result as "win" | "loss" | "draw";
          await sendBetTransfer({
            result: r,
            receivePokemonB64: r === "win" ? st.theirBetB64 : undefined,
            removeBoxIdx: r === "loss" && st.myBet ? st.myBet.boxIdx : undefined,
            removeSlotIdx: r === "loss" && st.myBet ? st.myBet.slotIdx : undefined,
          });
          // Persist to Supabase for crash recovery
          if (r === "win" || r === "loss") {
            const winnerId = r === "win" ? session.user.id : st.partnerId;
            const loserId = r === "loss" ? session.user.id : st.partnerId;
            const winnerReceivesB64 = r === "win" ? st.theirBetB64 : st.myBet?.pokemonB64;
            const winnerReceivesPreview = r === "win" ? st.theirBet : (({ boxIdx: _b, slotIdx: _s, pokemonB64: _p, ...rest }: any) => rest)(st.myBet);
            const loserLosesPreview = r === "loss" ? (({ boxIdx: _b, slotIdx: _s, pokemonB64: _p, ...rest }: any) => rest)(st.myBet) : st.theirBet;
            const loserBoxIdx = r === "loss" ? st.myBet?.boxIdx ?? 0 : 0;
            const loserSlotIdx = r === "loss" ? st.myBet?.slotIdx ?? 0 : 0;
            if (winnerReceivesB64 && winnerReceivesPreview && loserLosesPreview) {
              await saveBetToSupabase({
                roomCode: st.roomCode,
                winnerId, loserId,
                winnerReceivesB64,
                winnerReceivesPreview,
                loserLosesPreview,
                loserBoxIdx, loserSlotIdx,
              });
            }
          }
        }
      };
      doRecord().catch((err) => console.warn("[Battle] recordBattleResult failed:", err));
    }
  }, [battleState, session.user.id, getFreshTeam]);

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

  /**
   * Ouvre le modal de choix de mode (Normal / Parier un Pokémon).
   * L'ancien flow "challengePlayer" est maintenant "sendChallenge".
   */
  const challengePlayer = useCallback(
    (target: ChatProfile) => {
      if (battleState.phase !== "idle" && battleState.phase !== "complete" && battleState.phase !== "error") return;
      setPendingChallenge(target);
    },
    [battleState.phase],
  );

  /**
   * Envoie effectivement le défi (après choix du mode).
   * @param betMode true si mode pari
   * @param betSelection sélection du Pokémon misé (si betMode)
   */
  /**
   * Envoie le défi après choix du mode.
   * En mode pari, on envoie juste betMode=true sans Pokémon.
   * La sélection se fait APRÈS l'acceptation, des deux côtés.
   */
  const sendChallenge = useCallback(
    async (target: ChatProfile, betMode: boolean) => {
      const running = await isGameRunning();
      if (!running) {
        setErrorPopup(ui.errors.gameNotRunning);
        return;
      }
      const freshTeam = await refreshBattleTeam();
      if (!(await checkBanlistOrShowError(freshTeam))) return;
      if (!(await checkStatsOrShowError(freshTeam))) return;
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
        betMode: betMode || undefined,
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
        betMode: betMode || undefined,
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

  /**
   * Callback quand le joueur clique un Pokémon dans le PCBoxView.
   * Extrait le B64 et stocke en "pending" — PAS encore envoyé.
   * Le joueur voit la preview et peut Confirmer ou Changer.
   */
  const handleBetPokemonSelected = useCallback(
    async (poke: BoxPokemon, boxIdx: number) => {
      const savePath = lastSavePathRef.current;
      if (!savePath) { setErrorPopup("Aucune sauvegarde trouvée."); return; }
      try {
        const result = await extractBetPokemon(savePath, boxIdx, poke.slot);
        if (!result) { setErrorPopup("Impossible d'extraire le Pokémon."); return; }
        const selection: TradeSelection = {
          speciesId: typeof poke.code === "number" ? poke.code : parseInt(String(poke.code), 10) || 0,
          name: poke.speciesName || poke.nickname || "Pokémon",
          nickname: poke.nickname,
          level: poke.level ?? 1,
          shiny: poke.isShiny ?? false,
          altShiny: poke.isAltShiny ?? false,
          gender: poke.gender,
          nature: poke.nature,
          form: typeof poke.form === "number" ? poke.form : 0,
          ability: poke.ability,
          moves: poke.moves,
          ivHp: poke.ivHp, ivAtk: poke.ivAtk, ivDfe: poke.ivDfe,
          ivSpd: poke.ivSpd, ivAts: poke.ivAts, ivDfs: poke.ivDfs,
          boxIdx,
          slotIdx: poke.slot,
          pokemonB64: result.pokemonB64,
        };
        setPendingBetSelection(selection);
      } catch (e) {
        console.error("[Bet] extract error:", e);
        setErrorPopup("Erreur lors de l'extraction du Pokémon.");
      }
    },
    [],
  );

  /** Confirme la sélection : met à jour battleState.myBet + broadcast au partenaire. */
  const confirmBetSelection = useCallback(() => {
    if (!pendingBetSelection) return;
    const selection = pendingBetSelection;
    const preview: TradeSelectionPreview = {
      speciesId: selection.speciesId, name: selection.name, nickname: selection.nickname,
      level: selection.level, shiny: selection.shiny, altShiny: selection.altShiny,
      gender: selection.gender, nature: selection.nature, form: selection.form,
      ability: selection.ability, moves: selection.moves,
      ivHp: selection.ivHp, ivAtk: selection.ivAtk, ivDfe: selection.ivDfe,
      ivSpd: selection.ivSpd, ivAts: selection.ivAts, ivDfs: selection.ivDfs,
    };
    setBattleState((prev) => ({ ...(prev as any), myBet: selection }));
    betChannelRef.current?.send({
      type: "broadcast",
      event: "bet_select",
      payload: { userId: session.user.id, preview, pokemonB64: selection.pokemonB64 },
    });
    setPendingBetSelection(null);
  }, [pendingBetSelection, session.user.id, setBattleState]);

  // ── Supabase broadcast channel pour l'échange de sélections de pari en temps réel ──
  useEffect(() => {
    const st = battleState as any;
    // Activer le channel seulement en phase waiting_game + betMode
    if (st.phase !== "waiting_game" || !st.betMode) {
      // Cleanup du channel si on quitte la phase
      if (betChannelRef.current) {
        supabase.removeChannel(betChannelRef.current);
        betChannelRef.current = null;
      }
      return;
    }
    const roomCode = st.roomCode;
    if (!roomCode) return;

    const channel = supabase.channel(`bet-${roomCode}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "bet_select" }, ({ payload }: any) => {
      if (!payload || payload.userId === session.user.id) return;
      console.log("[Bet] Received opponent selection:", payload.preview?.name);
      setBattleState((prev) => ({
        ...(prev as any),
        theirBet: payload.preview ?? null,
        theirBetB64: payload.pokemonB64 ?? undefined,
      }));
    });
    channel.subscribe();
    betChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      betChannelRef.current = null;
    };
  }, [battleState.phase, (battleState as any).betMode, (battleState as any).roomCode, session.user.id, setBattleState]);

  /**
   * Lance le relay APRÈS que les deux joueurs aient choisi leur Pokémon.
   * Identique au flow normal (writeBattleTrigger + startRelay) mais déclenché par l'overlay.
   */
  const startRelayAfterBetSelections = useCallback(async () => {
    const st = battleState as any;
    if (!st.roomCode || !st.myBet || !st.theirBet) return;

    // Déterminer le rôle : le challenger a startedAt, l'accepteur non
    const role: "host" | "client" = st.startedAt ? "host" : "client";

    await fullCleanup(battleRelayCleanupRef);
    try {
      await writeBattleTrigger(Number(st.roomCode), st.partnerName, role);
    } catch (e) {
      console.error("[Battle] writeBattleTrigger FAILED:", e);
    }
    battleStartedAtRef.current = new Date().toISOString();
    turnCountRef.current = 0;
    battleResultRef.current = "";
    const cleanup = startRelay(
      st.roomCode,
      session.user.id,
      () => setBattleState((prev) => (prev as any).roomCode === st.roomCode ? ({ ...prev, phase: "relaying" } as any) : prev),
      (reason) => {
        const result =
          reason === "opponent_forfeit" || reason === "opponent_game_end"
            ? battleResultRef.current || "win"
            : reason === "opponent_crash" ? "draw"
            : reason === "crash" ? "draw"
            : reason === "forfeit" ? "loss"
            : reason === "game_end" ? battleResultRef.current || "unknown"
            : "unknown";
        saveBattleLog({
          roomCode: st.roomCode, myUserId: session.user.id, partnerId: st.partnerId,
          partnerName: st.partnerName, result, reason: reason || "unknown",
          turns: turnCountRef.current, startedAt: battleStartedAtRef.current,
          endedAt: new Date().toISOString(),
          turnLog: [..._currentBattleTurnLog], eventLog: [..._currentBattleEventLog],
        });
        setSpectatorCount(0);
        const needsOpponentLeft = reason?.startsWith("opponent_");
        if (needsOpponentLeft) {
          writeOpponentLeft(reason || "unknown").then(() => writeStopTrigger()).then(() => cleanupBattleFiles());
        } else {
          writeStopTrigger().then(() => cleanupBattleFiles());
        }
        setBattleState({
          phase: "complete", roomCode: st.roomCode, partnerId: st.partnerId, partnerName: st.partnerName,
          endReason: reason, battleResult: result,
          betMode: st.betMode, myBet: st.myBet, theirBet: st.theirBet, theirBetB64: st.theirBetB64,
        } as any);
      },
      () => { turnCountRef.current++; },
      (count) => { setSpectatorCount(count); },
      (result) => { battleResultRef.current = result; },
    );
    battleRelayCleanupRef.current = cleanup;
  }, [battleState, session.user.id, setBattleState, battleRelayCleanupRef]);

  // ── Auto-start relay quand les deux ont choisi ──
  useEffect(() => {
    const st = battleState as any;
    if (st.phase === "waiting_game" && st.betMode && st.myBet && st.theirBet) {
      startRelayAfterBetSelections();
    }
  }, [(battleState as any).myBet, (battleState as any).theirBet]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hint "retournez sur la carte" après 5s en waiting_game ──
  useEffect(() => {
    if (battleState.phase !== "waiting_game") { setShowWaitingHint(false); return; }
    const timer = setTimeout(() => setShowWaitingHint(true), 5000);
    return () => { clearTimeout(timer); setShowWaitingHint(false); };
  }, [battleState.phase]);

  // ── Poll vms_bet_done.json pour confirmation du transfert par le jeu ──
  useEffect(() => {
    const st = battleState as any;
    if (st.phase !== "complete" || !st.betMode) {
      setBetTransferStatus(null);
      return;
    }
    let active = true;
    const poll = async () => {
      while (active) {
        const done = await pollBetDone();
        if (done) {
          console.log("[BetTransfer] Game confirmed:", done);
          const status = done.status === "applied" ? "done" : done.status === "pc_full" ? "pc_full" : done.status === "error" ? "error" : "done";
          setBetTransferStatus(status);

          // ── Notification Windows ──
          try {
            if (Notification.permission === "granted" || Notification.permission === "default") {
              if (Notification.permission === "default") await Notification.requestPermission();
              if (Notification.permission === "granted") {
                const pokeName = done.pokemon || "Pokémon";
                if (done.result === "win" && status === "done") {
                  new Notification("Pari gagné !", { body: `${pokeName} a rejoint votre PC (${done.box || "PC"}).`, icon: "/icon.png" });
                } else if (done.result === "loss" && status === "done") {
                  new Notification("Pari perdu", { body: `${pokeName} a été transféré à votre adversaire.`, icon: "/icon.png" });
                } else if (done.result === "draw") {
                  new Notification("Match nul", { body: "Aucun Pokémon échangé.", icon: "/icon.png" });
                } else if (status === "pc_full") {
                  new Notification("PC plein !", { body: `Vous avez gagné ${pokeName} mais votre PC est plein.`, icon: "/icon.png" });
                }
              }
            }
          } catch (e) {
            console.warn("[BetTransfer] Notification error:", e);
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    poll();
    return () => { active = false; };
  }, [battleState.phase, (battleState as any).betMode]);

  /**
   * Accepter un combat.
   * - Normal : valide l'équipe, écrit le trigger, lance le relay.
   * - Bet : valide l'équipe, envoie l'accept, passe en waiting_game.
   *         L'overlay de sélection s'affiche ensuite (les deux joueurs choisissent).
   *         Le relay ne démarre qu'après que les deux aient choisi.
   */
  const acceptBattle = useCallback(async () => {
    const st = battleState as any;
    const running = await isGameRunning();
    if (!running) {
      setErrorPopup(ui.errors.gameNotRunningAccept);
      sendBattleDecline(st.roomCode, st.partnerId, session.user.id);
      setBattleState({ phase: "idle" });
      return;
    }
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

    // ── BET MODE : accepter et entrer en phase de sélection ──
    if (st.betMode) {
      sendBattleAccept({
        roomCode: st.roomCode, fromId: st.partnerId, acceptedBy: session.user.id,
        partnerName: profile.display_name || profile.username,
      });
      setBattleState({ ...st, phase: "waiting_game" });
      // Le relay sera lancé par startRelayAfterBetSelections()
      return;
    }

    // ── Normal mode : flow classique ──
    await fullCleanup(battleRelayCleanupRef);
    sendBattleAccept({
      roomCode: st.roomCode, fromId: st.partnerId, acceptedBy: session.user.id,
      partnerName: profile.display_name || profile.username,
    });
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
          reason === "opponent_forfeit" || reason === "opponent_game_end"
            ? battleResultRef.current || "win" // Adversaire a quitte → resultat du serveur (generalement win)
            : reason === "opponent_crash"
              ? "draw" // Crash adverse → match nul
              : reason === "crash"
                ? "draw" // Notre propre crash technique → match nul
                : reason === "forfeit"
                  ? "loss" // Notre abandon volontaire (bouton) → defaite
                  : reason === "game_end"
                    ? battleResultRef.current || "unknown" // Fin normale (notre jeu a ecrit battle_result)
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
        // writeOpponentLeft UNIQUEMENT si l'adversaire a quitte/crashe pendant
        // qu'on jouait encore. PAS si le combat s'est termine normalement
        // (game_end = notre jeu a ecrit battle_result, PSDK gere la sortie tout seul).
        const needsOpponentLeft = reason?.startsWith("opponent_");
        if (needsOpponentLeft) {
          writeOpponentLeft(reason || "unknown")
            .then(() => writeStopTrigger())
            .then(() => cleanupBattleFiles());
        } else {
          writeStopTrigger().then(() => cleanupBattleFiles());
        }
        setBattleState({
          phase: "complete",
          roomCode: st.roomCode,
          partnerId: st.partnerId,
          partnerName: st.partnerName,
          endReason: reason,
          battleResult: result,
          // Conserver les données de pari pour le transfert
          betMode: st.betMode,
          myBet: st.myBet,
          theirBet: st.theirBet,
          theirBetB64: st.theirBetB64,
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
      (async () => {
        let teamForRecord = battleTeamSnapshotRef.current;
        if (!teamForRecord || teamForRecord.length === 0) {
          teamForRecord = await getFreshTeam();
        }
        const matchTypeForForfeit = (st.matchType as "amical" | "ranked" | undefined) ?? "amical";
        const rankedResult = await recordBattleResult(
          session.user.id,
          st.partnerId,
          st.roomCode,
          st.partnerName || "",
          "loss",
          "forfeit",
          {
            startedAt: battleStartedAtRef.current || null,
            endedAt: new Date().toISOString(),
            matchType: matchTypeForForfeit,
            lpDelta: null,
            myTeam: snapshotTeam(teamForRecord),
          },
        );
        if (rankedResult && rankedResult.wasRecorded) {
          refreshPvpStats();
          // Abandon = défaite, pas de promotion (mais potentiellement démotion
          // on ne l'anime pas, c'est déprimant)
        }
      })().catch((err) => console.warn("[Battle] recordBattleResult (forfeit) failed:", err));
    }
    await fullCleanup(battleRelayCleanupRef);
    setBattleState({ phase: "idle" });
  }, [battleState, session, setBattleState, battleRelayCleanupRef, battleTimeoutRef, getFreshTeam]);

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
              : (battleState as any).betMode && battleState.phase === "inviting"
                ? "bg-gradient-to-r from-amber-500/[0.10] via-rose-500/[0.05] to-amber-500/[0.10] bet-banner-shimmer"
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
                      className={`h-11 w-11 rounded-full ${stAny.betMode ? "ring-2 ring-amber-400/60 shadow-[0_0_16px_rgba(245,158,11,0.3)]" : "ring-2 ring-amber-400/40"}`}
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-100">
                      {stAny.betMode ? (
                        <>
                          <FaGem className="text-xs text-amber-300 drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]" style={{ animation: "bet-float 3s ease-in-out infinite" }} />
                          {ui.banner.betIncomingTitle}
                        </>
                      ) : (
                        <>
                          <FaBolt className="text-xs" />
                          {ui.banner.incomingTitle}
                        </>
                      )}
                    </div>
                    <div className="text-xs text-white/65">
                      {stAny.betMode && stAny.theirBet
                        ? ui.banner.betIncomingDesc(
                            stAny.partnerName ?? "?",
                            stAny.theirBet.name ?? "Pokémon",
                            stAny.theirBet.level ?? 0,
                          )
                        : ui.banner.incomingDesc(stAny.partnerName ?? "?")}
                    </div>
                  </div>
                  {stAny.betMode && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200"
                      style={{ animation: "bet-ribbon-pulse 2s ease-in-out infinite" }}>
                      <FaDice className="text-[8px]" />
                      Mise
                    </span>
                  )}
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
                      {stAny.betMode && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-200">
                          <FaGem className="text-[7px]" /> Mise
                        </span>
                      )}
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
                  ) : stAny.betMode && stAny.battleResult === "win" ? (
                    <FaGem className="text-2xl text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" style={{ animation: "bet-float 3s ease-in-out infinite" }} />
                  ) : (
                    <FaTrophy className="text-2xl text-amber-300" />
                  )}
                  {stAny.betMode && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
                      <FaDice className="text-[7px]" /> Mise
                    </span>
                  )}
                  <div>
                    <div className="text-sm font-bold text-white/90">
                      {stAny.endReason === "opponent_forfeit"
                        ? ui.banner.completeWin
                        : (stAny.endReason === "opponent_crash" || stAny.endReason === "crash")
                          ? ui.banner.completeDraw
                          : stAny.endReason === "forfeit"
                            ? ui.banner.completeLoss
                            : (stAny.endReason === "game_end" || stAny.endReason === "opponent_game_end") && stAny.battleResult === "win"
                              ? ui.banner.completeWin
                              : (stAny.endReason === "game_end" || stAny.endReason === "opponent_game_end") && stAny.battleResult === "loss"
                                ? ui.banner.completeLoss
                                : (stAny.endReason === "game_end" || stAny.endReason === "opponent_game_end") && stAny.battleResult === "draw"
                                  ? ui.banner.completeDraw
                                  : ui.banner.completeGeneric}
                    </div>
                    <div className="text-xs text-white/65">
                      {stAny.betMode && stAny.battleResult === "win" && stAny.theirBet
                        ? (betTransferStatus === "done"
                            ? `${stAny.theirBet.name ?? "Pokémon"} a rejoint votre PC !`
                            : ui.banner.betCompleteWin(stAny.theirBet.name ?? "Pokémon"))
                        : stAny.betMode && stAny.battleResult === "loss" && stAny.myBet
                          ? (betTransferStatus === "done"
                              ? `${stAny.myBet.name ?? "Pokémon"} a été transféré.`
                              : ui.banner.betCompleteLoss(stAny.myBet.name ?? "Pokémon"))
                          : stAny.betMode && (stAny.battleResult === "draw" || stAny.endReason === "crash" || stAny.endReason === "opponent_crash")
                            ? ui.banner.betCompleteDraw
                            : stAny.endReason === "opponent_forfeit"
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
        {page === "lead" && (
          <CombatLeadView
            labels={ui.lead}
            myRank={
              myPvpStats
                ? {
                    tier: myPvpStats.battle_rank_tier,
                    lp: myPvpStats.battle_lp,
                    mmr: myPvpStats.battle_mmr,
                    placementPlayed: myPvpStats.placement_played,
                  }
                : undefined
            }
            isSearching={rankedSearching}
            isInBattle={battleState.phase !== "idle" && battleState.phase !== "complete"}
            onStartSearch={onStartRankedSearch}
          />
        )}
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
            battleStateIsIdle={battleState.phase === "idle" || battleState.phase === "complete" || battleState.phase === "error"}
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

      {/* ═══════════════════════════════════════════════════════
          MODE SELECTION MODAL — Normal / Parier un Pokémon
       ═══════════════════════════════════════════════════════ */}
      {pendingChallenge && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 backdrop-blur-md"
          onClick={() => setPendingChallenge(null)}
        >
          <div
            className="bet-modal-overlay relative w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#0f1629]/[0.98] to-[#080c18]/[0.99] p-0 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Decorative orbs */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-emerald-500/[0.07] blur-[80px]" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-amber-500/[0.07] blur-[80px]" />

            {/* Header */}
            <div className="relative border-b border-white/[0.06] px-7 pb-5 pt-7">
              <button
                type="button"
                onClick={() => setPendingChallenge(null)}
                className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.05] text-white/50 ring-1 ring-white/[0.08] transition hover:bg-white/[0.1] hover:text-white"
              >
                <FaXmark className="text-xs" />
              </button>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-rose-500/10 ring-1 ring-amber-400/25">
                  <FaScaleBalanced className="text-lg text-amber-200 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-white">{ui.bet.modeTitle}</h3>
                  <p className="text-xs text-white/40">vs {pendingChallenge.display_name || pendingChallenge.username}</p>
                </div>
              </div>
            </div>

            {/* Cards — mirror BattleTowerHome mode cards */}
            <div className="relative grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
              {/* ── Combat Normal ── */}
              <button
                type="button"
                onClick={async () => {
                  const target = pendingChallenge;
                  setPendingChallenge(null);
                  await sendChallenge(target, false);
                }}
                className="bet-card-normal group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.10] via-teal-500/[0.05] to-transparent p-5 text-left ring-1 ring-inset ring-emerald-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-300/40 hover:from-emerald-500/[0.16] hover:shadow-[0_16px_48px_-16px_rgba(52,211,153,0.35)]"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-emerald-400/15 blur-2xl transition group-hover:bg-emerald-400/30" />
                <div className="relative flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                    <FaHandshake className="text-[8px]" />
                    Amical
                  </span>
                  <FaChevronRight className="text-xs text-white/25 transition group-hover:translate-x-0.5 group-hover:text-emerald-200" />
                </div>
                <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/25 to-teal-500/15 ring-1 ring-emerald-300/25">
                  <FaShieldHalved className="text-xl text-emerald-100 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
                </div>
                <div className="relative">
                  <h4 className="mb-1 text-base font-bold text-white">{ui.bet.modeNormal}</h4>
                  <p className="text-[11px] leading-relaxed text-white/45">{ui.bet.modeNormalDesc}</p>
                </div>
              </button>

              {/* ── Parier un Pokémon ── */}
              <button
                type="button"
                onClick={async () => {
                  const target = pendingChallenge;
                  setPendingChallenge(null);
                  await sendChallenge(target, true);
                }}
                className="bet-card-wager group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.10] via-rose-500/[0.04] to-transparent p-5 text-left ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-300/40 hover:from-amber-500/[0.16] hover:shadow-[0_16px_48px_-16px_rgba(245,158,11,0.35)]"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-amber-400/15 blur-2xl transition group-hover:bg-amber-400/30" />
                <div className="relative flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/12 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
                    <FaDice className="text-[8px]" />
                    Mise
                  </span>
                  <FaChevronRight className="text-xs text-white/25 transition group-hover:translate-x-0.5 group-hover:text-amber-200" />
                </div>
                <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-rose-500/15 ring-1 ring-amber-300/25">
                  <FaGem className="text-xl text-amber-100 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]" style={{ animation: "bet-float 4s ease-in-out infinite" }} />
                </div>
                <div className="relative">
                  <h4 className="mb-1 text-base font-bold text-white">{ui.bet.modeBet}</h4>
                  <p className="text-[11px] leading-relaxed text-white/45">{ui.bet.modeBetDesc}</p>
                </div>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ═══════════════════════════════════════════════════════
          BET SELECTION OVERLAY — Split-screen : les deux joueurs
          choisissent en même temps, avec preview en temps réel.
          Affiché quand phase=waiting_game + betMode + pas encore les deux choix.
       ═══════════════════════════════════════════════════════ */}
      {(battleState as any).betMode && battleState.phase === "waiting_game" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div
            className="bet-modal-overlay relative flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-3xl border border-amber-400/15 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(245,158,11,0.08)_inset]"
            style={{ background: "linear-gradient(160deg, rgba(15,22,41,.98), rgba(12,18,34,.99))" }}
          >
            {/* Decorative orbs */}
            <div className="pointer-events-none absolute -left-32 -top-32 h-64 w-64 rounded-full bg-amber-500/[0.06] blur-[80px]" />
            <div className="pointer-events-none absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-rose-500/[0.05] blur-[80px]" />

            {/* ── Header ── */}
            <div className="relative z-10 flex items-center gap-4 border-b border-white/[0.06] bg-gradient-to-r from-amber-500/[0.06] via-rose-500/[0.03] to-transparent px-6 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-rose-500/10 ring-1 ring-amber-400/25"
                style={{ animation: "bet-glow-amber 3s ease-in-out infinite" }}>
                <FaGem className="text-lg text-amber-200 drop-shadow-[0_0_10px_rgba(245,158,11,0.6)]" style={{ animation: "bet-float 3s ease-in-out infinite" }} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold tracking-tight text-white">{ui.bet.selectTitle}</h3>
                <p className="text-xs text-white/40">vs {stAny.partnerName ?? "?"} — {ui.bet.selectDesc}</p>
              </div>
              <button
                onClick={() => { cancelBattle(); }}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-white/50 ring-1 ring-white/[0.08] transition hover:bg-white/[0.1] hover:text-white"
              >
                <FaXmark className="text-sm" />
              </button>
            </div>

            {/* ── Main content: PC selector / preview / cards view ── */}
            {!(battleState as any).myBet ? (
              pendingBetSelection ? (
                /* Player has a pending pick → show preview with Confirm/Change */
                <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 overflow-auto px-6 py-6"
                  style={{ animation: "update-page-in 0.3s ease-out both" }}>
                  {/* Opponent status if available */}
                  {(battleState as any).theirBet && (
                    <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/[0.06]">
                      <FaUserCheck className="text-[10px] text-emerald-300" />
                      <span className="text-[11px] text-white/50">{stAny.partnerName} :</span>
                      <span className="text-[11px] font-semibold text-amber-200">{(battleState as any).theirBet.name} Nv.{(battleState as any).theirBet.level}</span>
                    </div>
                  )}
                  <div className="w-full max-w-xs">
                    <BetPokeCard pk={pendingBetSelection} label={ui.bet.yourBet} accent="emerald" />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={confirmBetSelection}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-600/20 px-6 py-3 text-sm font-bold text-emerald-50 ring-1 ring-emerald-400/40 shadow-[0_0_24px_-6px_rgba(52,211,153,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_0_32px_-4px_rgba(52,211,153,0.7)]"
                    >
                      <FaUserCheck className="text-xs" /> {ui.bet.confirmBet}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingBetSelection(null)}
                      className="inline-flex items-center gap-2 rounded-xl bg-white/[0.05] px-5 py-3 text-sm font-semibold text-white/70 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
                    >
                      <FaArrowRightArrowLeft className="text-xs" /> Changer
                    </button>
                  </div>
                </div>
              ) : (
                /* Player hasn't selected yet → show PCBoxView */
                <div className="relative z-10 flex-1 overflow-auto">
                  {/* Compact opponent status bar at top */}
                  {(battleState as any).theirBet && (
                    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/[0.06] bg-[#0d1224]/95 px-4 py-2 backdrop-blur-sm">
                      <FaUserCheck className="text-[10px] text-emerald-300" />
                      <span className="text-[11px] text-white/50">{stAny.partnerName} a choisi :</span>
                      <span className="text-[11px] font-semibold text-amber-200">{(battleState as any).theirBet.name} Nv.{(battleState as any).theirBet.level}</span>
                      {(battleState as any).theirBet.shiny && <FaStar className="text-[9px] text-amber-300" />}
                    </div>
                  )}
                  <PCBoxView
                    profile={gameProfile ?? null}
                    embedded
                    savePath={lastSavePathRef.current}
                    p2pTradeMode
                    onTradeSelect={handleBetPokemonSelected}
                    siteUrl={siteUrl}
                  />
                </div>
              )
            ) : (
              /* Player selected → show cards split view */
              <div className="relative z-10 flex flex-1 flex-col items-center overflow-auto px-6 py-6">
                {/* Both cards side by side */}
                <div className="flex w-full max-w-2xl items-start justify-center gap-4">
                  {/* My card */}
                  <div className="flex-1" style={{ animation: "update-page-in 0.4s ease-out both" }}>
                    <BetPokeCard pk={(battleState as any).myBet} label={ui.bet.yourBet} accent="emerald" />
                  </div>

                  {/* VS separator */}
                  <div className="flex flex-col items-center justify-center gap-2 pt-12">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-rose-500/15 ring-1 ring-white/10">
                      <FaArrowRightArrowLeft className="text-sm text-white/60" />
                    </div>
                  </div>

                  {/* Their card */}
                  <div className="flex-1" style={{ animation: "update-page-in 0.4s ease-out 0.15s both" }}>
                    {(battleState as any).theirBet ? (
                      <BetPokeCard pk={(battleState as any).theirBet} label={ui.bet.theirBet} accent="amber" />
                    ) : (
                      <div className="flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 ring-1 ring-inset ring-white/[0.04]">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/30">{ui.bet.theirBet}</div>
                        <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                          <FaSpinner className="animate-spin text-xl text-white/15" />
                        </div>
                        <div className="text-xs text-white/30">En attente de {stAny.partnerName ?? "l'adversaire"}...</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Status indicator */}
                <div className="mt-6" style={{ animation: "update-page-in 0.4s ease-out 0.3s both" }}>
                  {(battleState as any).theirBet ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/[0.1] px-5 py-3 ring-1 ring-emerald-400/20">
                      <FaGamepad className="text-lg text-emerald-300" style={{ animation: "bet-float 2s ease-in-out infinite" }} />
                      <span className="text-sm font-bold text-emerald-200">Lancement du combat...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-white/35">
                      <FaSpinner className="animate-spin text-base" />
                      <span>En attente de la sélection adverse...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ────────── Ranked matchmaking overlays ────────── */}
      {rankedSearching && !matchFound && (
        <RankedQueueModal
          myMmr={rankedJoined?.mmr ?? myPvpStats?.battle_mmr ?? null}
          myTier={
            (rankedJoined?.tier as RankTier) ??
            myPvpStats?.battle_rank_tier ??
            "unranked"
          }
          waitMs={rankedWaitMs}
          mmrWindow={rankedMmrWindow}
          connecting={!rankedJoined && !rankedError}
          errorMessage={rankedError}
          onCancel={onCancelRankedSearch}
          labels={ui.lead.searching}
        />
      )}
      {matchFound && (
        <MatchFoundPopup
          roomCode={matchFound.roomCode}
          opponent={matchFound.opponent}
          acceptTimeoutMs={matchFound.acceptTimeoutMs}
          waitingForOpponent={matchFoundWaiting}
          cancelReason={matchFoundCancelReason}
          onAccept={onAcceptMatch}
          onDecline={onDeclineMatch}
          onDismiss={onDismissMatchFound}
          labels={ui.lead.matchFound}
        />
      )}

      {/* ────────── Promotion celebration (après match ranked) ────────── */}
      {promotionTier && (
        <PromotionCelebration
          tier={promotionTier}
          isPlacement={promotionIsPlacement}
          onDismiss={() => {
            setPromotionTier(null);
            setPromotionIsPlacement(false);
          }}
          labels={{
            title: ui.profile.stats.promotionTitle,
            subtitle: ui.profile.stats.promotionSubtitle,
            placementTitle: ui.profile.stats.promotionPlacementTitle,
            placementSubtitle: ui.profile.stats.promotionPlacementSubtitle,
            continue: ui.profile.stats.promotionContinue,
          }}
        />
      )}
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

/* ==================== Bet Pokémon Sprite ==================== */
function BetSprite({ speciesId, form, shiny, altShiny, size = 80 }: { speciesId: number; form: number; shiny?: boolean; altShiny?: boolean; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (speciesId <= 0) return;
    let active = true;
    const formArg = form > 0 ? form : null;
    (async () => {
      if (altShiny) { try { const r = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: formArg }); if (active && r) { setSrc(r); return; } } catch {} }
      if (shiny) { try { const r = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: formArg }); if (active && r) { setSrc(r); return; } } catch {} }
      try { const r = await invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: formArg }); if (active && r) setSrc(r); } catch {}
    })();
    return () => { active = false; };
  }, [speciesId, form, shiny, altShiny]);
  if (!src) return <div style={{ width: size, height: size, display: "grid", placeItems: "center", background: "rgba(255,255,255,.04)", borderRadius: 12 }}><FaSpinner className="animate-spin text-white/20" /></div>;
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", imageRendering: "pixelated" as any }} draggable={false} />;
}

/* ==================== Bet Pokémon Card (with sprite, stats, IVs) ==================== */
function BetPokeCard({ pk, label, accent }: { pk: TradeSelectionPreview; label: string; accent: "amber" | "emerald" }) {
  const ni = Array.isArray(pk.nature) ? pk.nature?.[0] : pk.nature;
  const nat = ni != null ? NATURE_FR[ni] : null;
  const hasIvs = pk.ivHp != null;
  const ivRows = hasIvs ? [
    { Icon: FaHeart, l: "PS", v: pk.ivHp!, cls: "bg-rose-400" },
    { Icon: FaHandFist, l: "Atk", v: pk.ivAtk!, cls: "bg-orange-400" },
    { Icon: FaShield, l: "Déf", v: pk.ivDfe!, cls: "bg-amber-400" },
    { Icon: FaBolt, l: "Vit", v: pk.ivSpd!, cls: "bg-cyan-400" },
    { Icon: FaWandMagicSparkles, l: "SpA", v: pk.ivAts!, cls: "bg-violet-400" },
    { Icon: FaShieldHalved, l: "SpD", v: pk.ivDfs!, cls: "bg-emerald-400" },
  ] : null;
  const ivTotal = ivRows ? ivRows.reduce((s, r) => s + r.v, 0) : 0;
  const borderCls = accent === "amber" ? "border-amber-400/20 ring-amber-300/10" : "border-emerald-400/20 ring-emerald-300/10";
  const labelCls = accent === "amber" ? "text-amber-200" : "text-emerald-200";

  return (
    <div className={`relative flex flex-col items-center overflow-hidden rounded-2xl border bg-white/[0.02] p-4 ring-1 ring-inset backdrop-blur-sm ${borderCls}`}>
      {/* Label */}
      <div className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${labelCls}`}>{label}</div>
      {/* Sprite */}
      <div className="relative mb-2">
        <BetSprite speciesId={pk.speciesId} form={pk.form} shiny={pk.shiny} altShiny={pk.altShiny} size={88} />
        {pk.shiny && (
          <FaStar className="absolute -right-1 -top-1 text-sm text-amber-300 drop-shadow-[0_0_4px_rgba(250,204,21,0.8)]" />
        )}
      </div>
      {/* Name + Level */}
      <div className="mb-1 text-sm font-bold text-white">{pk.nickname || pk.name}</div>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-white/50">
        <span>Nv.{pk.level}</span>
        {pk.gender === 0 && <FaMars className="text-sky-300" />}
        {pk.gender === 1 && <FaVenus className="text-rose-300" />}
        {nat && <span className="flex items-center gap-0.5"><FaLeaf className="text-[8px] text-emerald-300/60" /> {nat}</span>}
      </div>
      {/* IV bars */}
      {ivRows && (
        <div className="w-full space-y-1 rounded-xl bg-black/20 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40">
              <FaChartPie className="text-[8px]" /> IV
            </span>
            <span className="flex items-center gap-1 text-[9px] text-white/35">
              <FaDna className="text-[7px]" /> {ivTotal}/186
            </span>
          </div>
          {ivRows.map(({ Icon, l, v, cls }) => (
            <div key={l} className="flex items-center gap-1.5">
              <Icon className="w-3 text-[9px] text-white/30" />
              <span className="w-6 text-[9px] text-white/45">{l}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full ${cls} transition-all duration-500`} style={{ width: `${Math.min(100, (v / 31) * 100)}%`, opacity: 0.7 }} />
              </div>
              <span className="w-5 text-right text-[9px] font-semibold text-white/60">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
