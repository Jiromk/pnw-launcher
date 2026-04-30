// src/views/battleTower/CombatLeadView.tsx
// Mode compétitif — maquette visuelle avec tous les contrôles désactivés.
// Aucune logique, aucun fetch, aucune subscription.
import React, { useEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import {
  fetchMyLeaderboardPosition,
  fetchRankedLeaderboard,
  type MyLeaderboardPosition,
  type RankedLeaderboardEntry,
  type RankedLeaderboardFilter,
} from "../../leaderboard";
import {
  FaArrowsUpDown,
  FaBan,
  FaBoltLightning,
  FaChartLine,
  FaCircleCheck,
  FaCircleInfo,
  FaCrown,
  FaListCheck,
  FaLock,
  FaMagnifyingGlass,
  FaShieldHalved,
  FaStar,
  FaTrophy,
} from "react-icons/fa6";
import { fetchBanlist, type BannedPokemon } from "../../banlist";
import {
  RANK_ORDER,
  isApex,
  tierIconUrl,
  tierLabel,
  tierTheme,
  type RankTier,
} from "../../ranked";
import type { RankedQueueLabels } from "./RankedQueueModal";
import type { MatchFoundLabels } from "./MatchFoundPopup";
import { HologramGlobe } from "./HologramGlobe";

export type CombatLeadLabels = {
  title: string;
  subtitle: string;
  comingSoon: string;
  queueTitle: string;
  queueSubtitle: string;
  queueBtn: string;
  queueBtnLoading: string;
  queueBtnInBattle: string;
  queueBtnNeedGame: string;
  myRank: string;
  leaderboardTitle: string;
  leaderboardEmpty: string;
  leaderboardHint: string;
  leaderboardLoading: string;
  leaderboardFilters: {
    global: string;
    apex: string;
  };
  leaderboardYouNotRanked: string;
  leaderboardYouRank: (rank: number, total: number) => string;
  footer: string;
  columns: {
    rank: string;
    player: string;
    elo: string;
    wins: string;
    losses: string;
    winrate: string;
  };
  searching: RankedQueueLabels;
  matchFound: MatchFoundLabels;
  info: {
    buttonAria: string;
    title: string;
    subtitle: string;
    howTitle: string;
    howMmr: { label: string; desc: string };
    howLp: { label: string; desc: string };
    howRank: { label: string; desc: string };
    tiersTitle: string;
    tiersHint: string;
    placementTitle: string;
    placementBody: string[];
    progressTitle: string;
    progressBody: string[];
    mmrWindowTitle: string;
    mmrWindowBody: string[];
    apexTitle: string;
    apexBody: string;
    banlistTitle: string;
    banlistScope: string;
    banlistEmpty: string;
    banlistLoading: string;
    banlistCount: (n: number) => string;
    formBase: string;
    formLabel: (f: number) => string;
  };
};

type Props = {
  labels: CombatLeadLabels;
  /** Infos du joueur pour afficher son rang sur le bouton. */
  myRank?: {
    tier: RankTier;
    lp: number;
    mmr: number;
    placementPlayed: number;
  };
  /** true si on cherche déjà un match — disable le bouton + change label. */
  isSearching?: boolean;
  /** true si on est en combat — disable le bouton. */
  isInBattle?: boolean;
  /** Callback déclenché quand l'utilisateur clique "Chercher un match". */
  onStartSearch?: () => void;
  /** ID du joueur courant (pour highlight dans le leaderboard). */
  currentUserId?: string;
  /** Callback pour naviguer vers le profil d'un joueur cliqué dans le leaderboard. */
  onViewProfile?: (userId: string) => void;
  /** URL du site pour fetch la banlist depuis l'API. */
  siteUrl: string;
};

export function CombatLeadView({
  labels,
  myRank,
  isSearching,
  isInBattle,
  onStartSearch,
  currentUserId,
  onViewProfile,
  siteUrl,
}: Props) {
  const tier = myRank?.tier ?? "unranked";
  const theme = tierTheme(tier);
  const placementPhase = (myRank?.placementPlayed ?? 0) < 5;
  const canSearch = !!onStartSearch && !isSearching && !isInBattle;
  const btnLabel = isSearching
    ? labels.queueBtnLoading
    : isInBattle
      ? labels.queueBtnInBattle
      : labels.queueBtn;

  // ── Leaderboard state ──
  const [leaderboardFilter, setLeaderboardFilter] =
    useState<RankedLeaderboardFilter>("global");
  const [leaderboard, setLeaderboard] = useState<RankedLeaderboardEntry[] | null>(null);
  const [myPosition, setMyPosition] = useState<MyLeaderboardPosition>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLeaderboardLoading(true);
    Promise.all([
      fetchRankedLeaderboard(leaderboardFilter, 100, 0),
      fetchMyLeaderboardPosition(leaderboardFilter),
    ])
      .then(([list, pos]) => {
        if (cancelled) return;
        setLeaderboard(list);
        setMyPosition(pos);
      })
      .finally(() => {
        if (!cancelled) setLeaderboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leaderboardFilter]);

  // ── Tooltip d'info (hover) ──
  const [showInfo, setShowInfo] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Banlist (affichée dans le tooltip info — restriction ranked uniquement) ──
  const [banlist, setBanlist] = useState<BannedPokemon[] | null>(null);
  const [banlistLoading, setBanlistLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchBanlist(siteUrl)
      .then((list) => {
        if (cancelled) return;
        setBanlist(list);
        setBanlistLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBanlist([]);
        setBanlistLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteUrl]);
  const banlistCount = banlist?.length ?? 0;
  const handleEnter = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setShowInfo(true);
  };
  const handleLeave = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowInfo(false), 150);
  };

  // ── LP progress (0-100) avec bar visuelle ──
  const lpPercent = isApex(tier)
    ? null // apex = pas de plafond, pas de bar
    : Math.max(0, Math.min(100, myRank?.lp ?? 0));

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 sm:px-10 sm:py-12">
      {/* ── Orbes décoratifs en background (toute la page) ── */}
      <div
        className="pointer-events-none absolute -left-32 top-12 h-96 w-96 rounded-full blur-[100px]"
        style={{ background: theme.glow, opacity: 0.45 }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-violet-500/10 blur-[120px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-20 bottom-24 h-72 w-72 rounded-full bg-rose-500/10 blur-[100px]"
        aria-hidden
      />

      {/* ── Bouton info (top-left) avec tooltip au hover ── */}
      <div
        className="absolute left-4 top-4 z-30 sm:left-6 sm:top-6"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <button
          type="button"
          aria-label={labels.info.buttonAria}
          className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/25 bg-gradient-to-br from-amber-500/[0.12] via-white/[0.04] to-transparent text-amber-200 ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-amber-300/45 hover:bg-amber-500/[0.18] hover:text-amber-100 hover:shadow-[0_10px_30px_-10px_rgba(245,158,11,0.5)]"
        >
          <FaCircleInfo className="text-lg drop-shadow-[0_0_10px_rgba(245,158,11,0.55)]" />
          {/* Badge compteur de Pokémons bannis */}
          {banlistCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border border-rose-300/40 bg-gradient-to-br from-rose-500 to-red-600 px-1 text-[10px] font-bold text-white shadow-[0_4px_12px_rgba(244,63,94,0.45)]"
              aria-hidden
            >
              {banlistCount}
            </span>
          )}
        </button>

        {showInfo && (
          <div
            className="absolute left-0 top-[calc(100%+10px)] w-[min(calc(100vw-3rem),460px)] origin-top-left"
            style={{ animation: "update-page-in 0.2s ease-out both" }}
          >
            {/* Flèche */}
            <div className="absolute -top-[7px] left-4 h-4 w-4 rotate-45 border-l border-t border-amber-400/25 bg-[#141020]" />

            <div className="relative max-h-[80vh] overflow-y-auto rounded-2xl border border-amber-400/25 bg-gradient-to-b from-[#1a1226] via-[#130d1f] to-[#0d0918] ring-1 ring-inset ring-amber-300/10 shadow-[0_30px_80px_-20px_rgba(245,158,11,0.4),0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              {/* Corner glows */}
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-400/15 blur-3xl"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl"
                aria-hidden
              />

              {/* Header */}
              <div className="relative border-b border-white/[0.07] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-orange-500/15 ring-1 ring-amber-300/30">
                    <FaShieldHalved className="text-base text-amber-100 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold tracking-tight text-white">
                      {labels.info.title}
                    </h3>
                    <p className="text-[11px] text-white/50">{labels.info.subtitle}</p>
                  </div>
                </div>
              </div>

              {/* ── Section 1 : Comment ça marche ── */}
              <InfoSection
                icon={<FaChartLine />}
                tone="amber"
                title={labels.info.howTitle}
              >
                <ConceptRow
                  icon={<FaChartLine className="text-[10px]" />}
                  iconBg="from-sky-500/20 to-sky-700/10 border-sky-400/30"
                  iconColor="text-sky-200"
                  label={labels.info.howMmr.label}
                  desc={labels.info.howMmr.desc}
                />
                <ConceptRow
                  icon={<FaBoltLightning className="text-[10px]" />}
                  iconBg="from-amber-500/20 to-amber-700/10 border-amber-400/30"
                  iconColor="text-amber-200"
                  label={labels.info.howLp.label}
                  desc={labels.info.howLp.desc}
                />
                <ConceptRow
                  icon={<FaCrown className="text-[10px]" />}
                  iconBg="from-violet-500/20 to-purple-700/10 border-violet-400/30"
                  iconColor="text-violet-200"
                  label={labels.info.howRank.label}
                  desc={labels.info.howRank.desc}
                />
              </InfoSection>

              <Separator />

              {/* ── Section 2 : Liste des rangs (avec SVG) ── */}
              <InfoSection
                icon={<FaTrophy />}
                tone="amber"
                title={labels.info.tiersTitle}
                hint={labels.info.tiersHint}
              >
                <div className="grid grid-cols-5 gap-2">
                  {RANK_ORDER.filter((t) => t !== "unranked").map((t) => {
                    const tt = tierTheme(t);
                    return (
                      <div
                        key={t}
                        className="flex flex-col items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] py-2 transition hover:border-white/15 hover:bg-white/[0.04]"
                        style={{ boxShadow: `inset 0 0 0 1px ${tt.glow}` }}
                      >
                        <img
                          src={tierIconUrl(t)}
                          alt={tierLabel(t)}
                          className="h-9 w-9 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
                        />
                        <span
                          className="text-[9px] font-semibold uppercase tracking-wide"
                          style={{ color: tt.accent }}
                        >
                          {tierLabel(t)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </InfoSection>

              <Separator />

              {/* ── Section 3 : Phase de placement ── */}
              <InfoSection
                icon={<FaListCheck />}
                tone="emerald"
                title={labels.info.placementTitle}
              >
                <ul className="space-y-1.5 text-[12px] text-white/75">
                  {labels.info.placementBody.map((line, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <FaCircleCheck className="mt-0.5 text-[9px] text-emerald-300/70" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </InfoSection>

              <Separator />

              {/* ── Section 4 : Promotion / Démotion ── */}
              <InfoSection
                icon={<FaArrowsUpDown />}
                tone="sky"
                title={labels.info.progressTitle}
              >
                <ul className="space-y-1.5 text-[12px] text-white/75">
                  {labels.info.progressBody.map((line, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300/60" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </InfoSection>

              <Separator />

              {/* ── Section 5 : Matchmaking ── */}
              <InfoSection
                icon={<FaMagnifyingGlass />}
                tone="violet"
                title={labels.info.mmrWindowTitle}
              >
                <div className="grid grid-cols-1 gap-1.5 text-[12px] text-white/75">
                  {labels.info.mmrWindowBody.map((line, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-violet-400/15 bg-violet-500/[0.04] px-2.5 py-1.5"
                    >
                      <span className="text-white/85">{line}</span>
                    </div>
                  ))}
                </div>
              </InfoSection>

              <Separator />

              {/* ── Section 6 : Apex ── */}
              <InfoSection
                icon={<FaStar />}
                tone="rose"
                title={labels.info.apexTitle}
              >
                <p className="text-[12px] leading-relaxed text-white/75">
                  {labels.info.apexBody}
                </p>
                <div className="mt-3 flex items-center justify-center gap-3">
                  {(["master", "grandmaster", "challenger"] as RankTier[]).map((t) => (
                    <div key={t} className="flex flex-col items-center gap-1">
                      <img
                        src={tierIconUrl(t)}
                        alt={tierLabel(t)}
                        className="h-11 w-11 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                      />
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: tierTheme(t).accent }}
                      >
                        {tierLabel(t)}
                      </span>
                    </div>
                  ))}
                </div>
              </InfoSection>

              <Separator />

              {/* ── Section 7 : Pokémons bannis (uniquement applicable en classé) ── */}
              <div className="relative px-5 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rose-300/90">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-rose-400/25 to-pink-500/15 ring-1 ring-inset ring-rose-300/30">
                      <FaBan className="text-[9px]" />
                    </span>
                    {labels.info.banlistTitle}
                  </h4>
                  {banlist && banlistCount > 0 && (
                    <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-rose-200">
                      {labels.info.banlistCount(banlistCount)}
                    </span>
                  )}
                </div>
                <p className="mb-3 flex items-center gap-1.5 text-[10.5px] italic text-amber-200/70">
                  <FaCrown className="text-[9px]" />
                  {labels.info.banlistScope}
                </p>
                {banlistLoading ? (
                  <p className="text-[12px] italic text-white/40">
                    {labels.info.banlistLoading}
                  </p>
                ) : banlistCount === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-3 py-2.5">
                    <FaCircleCheck className="text-sm text-emerald-300/85" />
                    <span className="text-[12px] text-emerald-100/85">
                      {labels.info.banlistEmpty}
                    </span>
                  </div>
                ) : (
                  <ul
                    className="max-h-[340px] space-y-2 overflow-y-auto overscroll-contain pr-2"
                    style={{
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgba(244,63,94,0.35) transparent",
                    }}
                  >
                    {(banlist ?? []).map((b) => (
                      <li
                        key={b.id || `${b.speciesId}_${b.form ?? "base"}`}
                        className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 transition hover:border-rose-400/20 hover:bg-rose-500/[0.05]"
                      >
                        {b.imageUrl ? (
                          <img
                            src={b.imageUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg bg-black/30 object-contain ring-1 ring-white/10"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/30 text-rose-300/70 ring-1 ring-white/10">
                            <FaBan className="text-sm" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-semibold text-white">
                              {b.name || `#${b.speciesId}`}
                            </span>
                            <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-white/50">
                              #{String(b.speciesId).padStart(3, "0")}
                            </span>
                          </div>
                          <div className="text-[10.5px] text-white/45">
                            {b.form != null
                              ? labels.info.formLabel(b.form)
                              : labels.info.formBase}
                          </div>
                          {b.reason && (
                            <div className="mt-1 text-[11px] italic leading-snug text-rose-200/75">
                              « {b.reason} »
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Hero Header : titre stylisé avec accent dégradé ─── */}
      <div
        className="relative flex flex-col items-center text-center"
        style={{ animation: "update-page-in 0.45s ease-out both" }}
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-amber-400/60" />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.4em] text-amber-300/80"
            style={{ textShadow: "0 0 12px rgba(245,158,11,0.4)" }}
          >
            {labels.subtitle}
          </span>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-amber-400/60" />
        </div>
        <h1
          className="ranked-title relative text-4xl font-black tracking-tight text-transparent sm:text-5xl"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #fef3c7 0%, #fbbf24 35%, #f59e0b 60%, #d97706 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 30px rgba(245,158,11,0.35))",
          }}
        >
          {labels.title}
        </h1>
      </div>

      {/* ─── Queue card hero (premium) ─── */}
      <div
        className="ranked-hero-card relative overflow-hidden rounded-3xl border p-8 backdrop-blur-sm"
        style={{
          borderColor: theme.accent + "30",
          background: `radial-gradient(ellipse 90% 70% at 50% 0%, ${theme.glow} 0%, rgba(15,22,41,0.4) 50%, rgba(8,12,24,0.6) 100%)`,
          boxShadow: `0 24px 60px -20px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.08)`,
          animation: "update-page-in 0.5s ease-out 0.1s both",
        }}
      >
        {/* Grille décorative en background */}
        <div
          className="ranked-hero-grid pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 80%)",
          }}
        />

        {/* Glows multiples */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: theme.glow, opacity: 0.6 }}
        />
        <div
          className="pointer-events-none absolute -left-16 -bottom-20 h-60 w-60 rounded-full bg-violet-400/10 blur-3xl"
        />

        {/* Shimmer animé sur la bordure haute */}
        <div
          className="ranked-hero-shimmer pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
          }}
          aria-hidden
        />

        <div className="relative flex flex-col items-center text-center">
          {/* Globe holographique */}
          <div className="mb-6">
            <HologramGlobe size={240} tier={tier} intensity={isSearching ? "searching" : "idle"} />
          </div>

          {/* Titre + sous-titre */}
          <h2 className="mb-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {labels.queueTitle}
          </h2>
          <p className="mb-7 max-w-md text-sm leading-relaxed text-white/55">
            {labels.queueSubtitle}
          </p>

          {/* Bouton Chercher (gros, glow tier) */}
          <Button
            type="button"
            disabled={!canSearch}
            onClick={canSearch ? onStartSearch : undefined}
            className={`group relative !px-8 !py-3.5 !text-[13px] !font-bold !uppercase !tracking-widest sm:min-w-[18rem] ${
              canSearch
                ? "ranked-cta-btn"
                : "!cursor-not-allowed !bg-white/[0.04] !ring-white/10 !opacity-50"
            }`}
            style={
              canSearch
                ? {
                    background: `linear-gradient(135deg, ${theme.accent}30, ${theme.accent}10)`,
                    boxShadow: `0 14px 34px -10px ${theme.glowStrong}, inset 0 1px 0 rgba(255,255,255,0.18)`,
                    color: theme.accent,
                    borderColor: theme.accent + "60",
                  }
                : undefined
            }
          >
            {canSearch && (
              <span
                className="ranked-cta-shine pointer-events-none absolute inset-0 rounded-xl"
                aria-hidden
              />
            )}
            <FaMagnifyingGlass className="mr-2 text-sm" />
            {btnLabel}
          </Button>

          {/* ─── Carte de rang détaillée (avec LP bar) ─── */}
          {myRank ? (
            <div
              className="mt-8 flex w-full max-w-md flex-col gap-3 rounded-2xl border bg-white/[0.02] p-5 backdrop-blur-sm"
              style={{
                borderColor: theme.accent + "25",
                boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -8px ${theme.glow}`,
              }}
            >
              <div className="flex items-center gap-4">
                {/* Icône rang */}
                <div
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 bg-gradient-to-br from-white/[0.06] to-transparent"
                  style={{
                    borderColor: theme.accent + "55",
                    boxShadow: `0 6px 18px -4px ${theme.glowStrong}`,
                  }}
                >
                  <img
                    src={tierIconUrl(placementPhase ? "unranked" : tier)}
                    alt={tierLabel(tier)}
                    className="h-12 w-12 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                  />
                </div>

                {/* Tier + LP/MMR */}
                <div className="flex min-w-0 flex-1 flex-col text-left">
                  <span
                    className="text-[16px] font-extrabold uppercase tracking-wider"
                    style={{
                      color: theme.accent,
                      textShadow: `0 0 14px ${theme.glow}`,
                    }}
                  >
                    {placementPhase ? `${labels.myRank}` : tierLabel(tier)}
                  </span>
                  <span className="text-[11px] font-semibold text-white/55">
                    {placementPhase
                      ? `${myRank.placementPlayed} / 5 placements`
                      : isApex(tier)
                        ? `${myRank.lp} LP · ${myRank.mmr} MMR`
                        : `${myRank.lp} / 100 LP · ${myRank.mmr} MMR`}
                  </span>
                </div>
              </div>

              {/* LP bar — uniquement hors apex et hors placements */}
              {!placementPhase && lpPercent !== null && (
                <div className="relative h-2 w-full overflow-hidden rounded-full border border-white/[0.06] bg-black/40">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      width: `${lpPercent}%`,
                      background: `linear-gradient(90deg, ${theme.barFrom}, ${theme.barTo})`,
                      boxShadow: `0 0 12px ${theme.glow}`,
                    }}
                  />
                  {/* Marqueurs aux quarts */}
                  {[25, 50, 75].map((q) => (
                    <span
                      key={q}
                      className="absolute top-0 h-full w-px bg-white/[0.10]"
                      style={{ left: `${q}%` }}
                      aria-hidden
                    />
                  ))}
                </div>
              )}

              {/* Barre placement (5 segments) */}
              {placementPhase && (
                <div className="flex gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-2 flex-1 overflow-hidden rounded-full border border-white/[0.06] bg-black/40"
                    >
                      {i < (myRank.placementPlayed ?? 0) && (
                        <div
                          className="h-full rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${theme.barFrom}, ${theme.barTo})`,
                            boxShadow: `0 0 8px ${theme.glow}`,
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-8 flex w-full max-w-md items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 backdrop-blur-sm">
              <span className="text-xs font-medium uppercase tracking-wider text-white/40">
                {labels.myRank}
              </span>
              <div className="h-5 w-20 animate-pulse rounded-md bg-white/[0.08]" />
            </div>
          )}
        </div>
      </div>

      {/* ─── Divider décoratif entre queue et classement ─── */}
      <div className="relative flex items-center justify-center">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.10] to-transparent" />
        <FaTrophy className="mx-4 text-base text-amber-300/40" />
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/[0.10] to-transparent" />
      </div>

      {/* ───────────────── Leaderboard ───────────────── */}
      <LeaderboardSection
        labels={labels}
        leaderboard={leaderboard}
        myPosition={myPosition}
        loading={leaderboardLoading}
        filter={leaderboardFilter}
        onFilterChange={setLeaderboardFilter}
        currentUserId={currentUserId}
        onViewProfile={onViewProfile}
      />

      {/* Footer hint */}
      <p className="text-center text-xs leading-relaxed text-white/35">{labels.footer}</p>
    </div>
  );
}

/* ───────────── Sub-components du tooltip info ───────────── */

type InfoTone = "amber" | "emerald" | "sky" | "violet" | "rose";

const TONE_CONFIG: Record<InfoTone, { color: string; bg: string; ring: string }> = {
  amber:   { color: "text-amber-300/90",   bg: "from-amber-400/25 to-orange-500/15",  ring: "ring-amber-300/30" },
  emerald: { color: "text-emerald-300/90", bg: "from-emerald-400/25 to-teal-500/15",  ring: "ring-emerald-300/30" },
  sky:     { color: "text-sky-300/90",     bg: "from-sky-400/25 to-blue-500/15",      ring: "ring-sky-300/30" },
  violet:  { color: "text-violet-300/90",  bg: "from-violet-400/25 to-purple-500/15", ring: "ring-violet-300/30" },
  rose:    { color: "text-rose-300/90",    bg: "from-rose-400/25 to-pink-500/15",     ring: "ring-rose-300/30" },
};

function InfoSection({
  icon,
  tone,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  tone: InfoTone;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const cfg = TONE_CONFIG[tone];
  return (
    <div className="relative px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${cfg.color}`}>
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ${cfg.bg} ring-1 ring-inset ${cfg.ring}`}
          >
            <span className="text-[9px]">{icon}</span>
          </span>
          {title}
        </h4>
        {hint && (
          <span className="text-[10px] italic text-white/35">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ConceptRow({
  icon,
  iconBg,
  iconColor,
  label,
  desc,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  desc: string;
}) {
  return (
    <div className="mb-2 flex items-start gap-3 last:mb-0">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-gradient-to-br ${iconBg} ${iconColor}`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-[12px] font-semibold text-white/95">{label}</div>
        <div className="text-[11px] leading-snug text-white/55">{desc}</div>
      </div>
    </div>
  );
}

function Separator() {
  return (
    <div className="relative mx-5 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
  );
}

/* ───────────── Leaderboard ───────────── */

function LeaderboardSection({
  labels,
  leaderboard,
  myPosition,
  loading,
  filter,
  onFilterChange,
  currentUserId,
  onViewProfile,
}: {
  labels: CombatLeadLabels;
  leaderboard: RankedLeaderboardEntry[] | null;
  myPosition: MyLeaderboardPosition;
  loading: boolean;
  filter: RankedLeaderboardFilter;
  onFilterChange: (f: RankedLeaderboardFilter) => void;
  currentUserId?: string;
  onViewProfile?: (userId: string) => void;
}) {
  const list = leaderboard ?? [];
  const top3 = list.slice(0, 3);
  const rest = list.slice(3);
  const isEmpty = !loading && list.length === 0;
  const userInList =
    !!currentUserId && list.some((e) => e.user_id === currentUserId);
  const showMyPositionBanner = !!myPosition && !userInList && !loading;

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03] ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm"
      style={{ animation: "update-page-in 0.5s ease-out 0.2s both" }}
    >
      {/* Header avec onglets */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <FaTrophy className="text-base text-amber-300/80" />
          <h3 className="text-lg font-semibold text-white/90">{labels.leaderboardTitle}</h3>
          {!loading && list.length > 0 && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
              {list.length}
            </span>
          )}
        </div>

        {/* Onglets Global / Apex */}
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-sm">
          <FilterTab
            active={filter === "global"}
            onClick={() => onFilterChange("global")}
            label={labels.leaderboardFilters.global}
            tone="amber"
          />
          <FilterTab
            active={filter === "apex"}
            onClick={() => onFilterChange("apex")}
            label={labels.leaderboardFilters.apex}
            tone="rose"
          />
        </div>
      </div>

      {/* Contenu */}
      {loading ? (
        <div className="flex items-center justify-center px-6 py-16 text-sm text-white/55">
          <FaCircleInfo className="mr-2 animate-pulse text-base text-amber-300/60" />
          {labels.leaderboardLoading}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <FaShieldHalved className="text-3xl text-white/20" />
          <p className="text-sm text-white/55">{labels.leaderboardEmpty}</p>
          <p className="text-xs italic text-white/30">{labels.leaderboardHint}</p>
        </div>
      ) : (
        <>
          {/* Podium top 3 */}
          {top3.length > 0 && (
            <div className="px-6 pt-6 pb-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {top3.map((entry, idx) => (
                  <PodiumCard
                    key={entry.user_id}
                    entry={entry}
                    place={idx + 1}
                    isCurrent={entry.user_id === currentUserId}
                    onClick={
                      onViewProfile && entry.user_id !== currentUserId
                        ? () => onViewProfile(entry.user_id)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Reste de la liste 4-100 */}
          {rest.length > 0 && (
            <div className="relative overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-white/[0.06] text-left text-[10px] font-bold uppercase tracking-wider text-white/40">
                    <th className="w-14 px-6 py-2.5">{labels.columns.rank}</th>
                    <th className="px-6 py-2.5">{labels.columns.player}</th>
                    <th className="w-24 px-6 py-2.5 text-right">{labels.columns.elo}</th>
                    <th className="w-14 px-4 py-2.5 text-right">{labels.columns.wins}</th>
                    <th className="w-14 px-4 py-2.5 text-right">{labels.columns.losses}</th>
                    <th className="w-24 px-6 py-2.5 text-right">{labels.columns.winrate}</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((entry) => (
                    <LeaderboardRow
                      key={entry.user_id}
                      entry={entry}
                      isCurrent={entry.user_id === currentUserId}
                      onClick={
                        onViewProfile && entry.user_id !== currentUserId
                          ? () => onViewProfile(entry.user_id)
                          : undefined
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Bottom banner : ma position si je ne suis pas dans la liste */}
          {showMyPositionBanner && myPosition && (
            <div className="border-t border-white/[0.06] bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.04] to-transparent px-6 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-2 text-[11px] font-bold"
                    style={{
                      borderColor: tierTheme(myPosition.battleRankTier).accent + "55",
                      color: tierTheme(myPosition.battleRankTier).accent,
                      background: `linear-gradient(135deg, ${tierTheme(myPosition.battleRankTier).glow}, transparent)`,
                    }}
                  >
                    #{myPosition.rank}
                  </div>
                  <span className="text-[12px] font-bold uppercase tracking-wider text-amber-200">
                    {labels.leaderboardYouRank(myPosition.rank, myPosition.totalPlayers)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <img
                    src={tierIconUrl(myPosition.battleRankTier)}
                    alt={tierLabel(myPosition.battleRankTier)}
                    className="h-7 w-7"
                  />
                  <span className="text-[11px] font-semibold text-white/70">
                    {myPosition.battleLp} LP · {myPosition.battleMmr} MMR
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: "amber" | "rose";
}) {
  const activeClass =
    tone === "rose"
      ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30"
      : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
        active ? activeClass : "text-white/45 hover:text-white/75"
      }`}
    >
      {label}
    </button>
  );
}

/** Podium card (top 3) avec couleurs or/argent/bronze. */
function PodiumCard({
  entry,
  place,
  isCurrent,
  onClick,
}: {
  entry: RankedLeaderboardEntry;
  place: 1 | 2 | 3 | number;
  isCurrent?: boolean;
  onClick?: () => void;
}) {
  const tt = tierTheme(entry.battle_rank_tier);
  const total = entry.pvp_wins_ranked + entry.pvp_losses_ranked + entry.pvp_draws_ranked;
  const winrate =
    total > 0 ? Math.round((entry.pvp_wins_ranked / total) * 1000) / 10 : null;

  // Style du podium par place
  const podium =
    place === 1
      ? {
          orderClass: "sm:order-2",
          ring: "ring-amber-300/50",
          border: "border-amber-300/45",
          glow: "0 14px 40px -12px rgba(251,191,36,0.55)",
          medalBg: "from-amber-400 to-yellow-600",
          medalShadow: "0 0 16px rgba(251,191,36,0.7)",
          medalText: "text-amber-50",
          label: "1ER",
        }
      : place === 2
        ? {
            orderClass: "sm:order-1",
            ring: "ring-slate-300/40",
            border: "border-slate-300/40",
            glow: "0 12px 36px -14px rgba(203,213,225,0.50)",
            medalBg: "from-slate-200 to-slate-400",
            medalShadow: "0 0 14px rgba(203,213,225,0.6)",
            medalText: "text-slate-700",
            label: "2E",
          }
        : {
            orderClass: "sm:order-3",
            ring: "ring-orange-400/40",
            border: "border-orange-500/40",
            glow: "0 12px 36px -14px rgba(217,119,6,0.50)",
            medalBg: "from-orange-400 to-amber-700",
            medalShadow: "0 0 14px rgba(217,119,6,0.6)",
            medalText: "text-orange-50",
            label: `${place}E`,
          };

  const isClickable = !!onClick;

  return (
    <div
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border bg-gradient-to-b from-white/[0.05] to-transparent p-4 ring-1 ring-inset transition ${podium.border} ${podium.ring} ${podium.orderClass} ${
        isClickable ? "cursor-pointer hover:-translate-y-1 hover:bg-white/[0.06]" : ""
      } ${isCurrent ? "outline outline-2 outline-offset-2 outline-amber-300/40" : ""}`}
      style={{ boxShadow: podium.glow }}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
    >
      {/* Glow ambient */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl"
        style={{ background: tt.glow, opacity: 0.7 }}
        aria-hidden
      />

      {/* Médaille */}
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-xs font-extrabold ring-2 ring-white/30 ${podium.medalBg} ${podium.medalText}`}
        style={{ boxShadow: podium.medalShadow }}
      >
        {place}
      </div>

      {/* Avatar */}
      <div className="relative">
        {entry.avatar_url ? (
          <img
            src={entry.avatar_url}
            alt=""
            className="h-14 w-14 rounded-full object-cover ring-2 ring-white/15"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-base font-bold uppercase text-amber-200 ring-2 ring-white/15">
            {(entry.display_name || entry.username || "?").charAt(0)}
          </div>
        )}
        {/* Petit badge rang superposé */}
        <img
          src={tierIconUrl(entry.battle_rank_tier)}
          alt={tierLabel(entry.battle_rank_tier)}
          className="absolute -bottom-1 -right-1 h-7 w-7 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
        />
      </div>

      {/* Pseudo + Tag VOUS */}
      <div className="relative flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[140px] truncate text-[13px] font-bold text-white">
            {entry.display_name || entry.username}
          </span>
          {isCurrent && (
            <span className="rounded-md border border-amber-400/50 bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-100">
              VOUS
            </span>
          )}
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: tt.accent }}
        >
          {tierLabel(entry.battle_rank_tier)} · {entry.battle_lp} LP
        </span>
      </div>

      {/* Stats */}
      <div className="relative flex items-center gap-2 text-[10px]">
        <span className="font-bold text-white/85">{entry.battle_mmr} MMR</span>
        <span className="text-white/30">·</span>
        <span className="text-emerald-300/80">{entry.pvp_wins_ranked}V</span>
        <span className="text-rose-300/80">{entry.pvp_losses_ranked}D</span>
        {winrate != null && (
          <>
            <span className="text-white/30">·</span>
            <span className="text-sky-300/80">{winrate}%</span>
          </>
        )}
      </div>
    </div>
  );
}

function LeaderboardRow({
  entry,
  isCurrent,
  onClick,
}: {
  entry: RankedLeaderboardEntry;
  isCurrent?: boolean;
  onClick?: () => void;
}) {
  const tt = tierTheme(entry.battle_rank_tier);
  const total = entry.pvp_wins_ranked + entry.pvp_losses_ranked + entry.pvp_draws_ranked;
  const winrate =
    total > 0 ? Math.round((entry.pvp_wins_ranked / total) * 1000) / 10 : null;
  const isClickable = !!onClick;
  return (
    <tr
      className={`border-b border-white/[0.04] transition ${
        isCurrent
          ? "bg-amber-500/[0.08]"
          : isClickable
            ? "cursor-pointer hover:bg-white/[0.03]"
            : ""
      }`}
      onClick={onClick}
    >
      <td className="px-6 py-3">
        <span className="text-[13px] font-bold text-white/55">#{entry.rank}</span>
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          {entry.avatar_url ? (
            <img
              src={entry.avatar_url}
              alt=""
              className="h-7 w-7 rounded-full object-cover ring-1 ring-white/10"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold uppercase text-amber-200">
              {(entry.display_name || entry.username || "?").charAt(0)}
            </div>
          )}
          <img
            src={tierIconUrl(entry.battle_rank_tier)}
            alt={tierLabel(entry.battle_rank_tier)}
            className="h-6 w-6 shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-semibold text-white/90">
                {entry.display_name || entry.username}
              </span>
              {isCurrent && (
                <span className="rounded-md border border-amber-400/50 bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-100">
                  VOUS
                </span>
              )}
            </div>
            <span
              className="text-[9.5px] font-bold uppercase tracking-wider"
              style={{ color: tt.accent }}
            >
              {tierLabel(entry.battle_rank_tier)} · {entry.battle_lp} LP
            </span>
          </div>
        </div>
      </td>
      <td className="px-6 py-3 text-right">
        <span className="font-mono text-[12px] font-semibold text-white/80">
          {entry.battle_mmr}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-[12px] font-bold text-emerald-300/80">
          {entry.pvp_wins_ranked}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-[12px] font-bold text-rose-300/80">
          {entry.pvp_losses_ranked}
        </span>
      </td>
      <td className="px-6 py-3 text-right">
        <span className="text-[12px] font-semibold text-sky-300/80">
          {winrate != null ? `${winrate}%` : "—"}
        </span>
      </td>
    </tr>
  );
}
