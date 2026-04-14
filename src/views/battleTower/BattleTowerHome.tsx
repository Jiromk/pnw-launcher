// src/views/battleTower/BattleTowerHome.tsx
// Page d'accueil de la Tour de Combat : hero + 2 cards de mode + stats placeholder.
import React, { useEffect, useRef, useState } from "react";
import {
  FaChartLine,
  FaChevronRight,
  FaCrown,
  FaHandshake,
  FaShieldHalved,
  FaSkull,
  FaTrophy,
  FaCircleInfo,
  FaCircleCheck,
  FaBan,
} from "react-icons/fa6";
import { fetchBanlist, type BannedPokemon } from "../../banlist";

export type BattleTowerHomeLabels = {
  title: string;
  subtitle: string;
  modes: {
    lead: { badge: string; title: string; description: string };
    amical: { badge: string; title: string; description: string };
  };
  statsTitle: string;
  statsPlaceholder: string;
  statsHint: string;
  statLabels: {
    wins: string;
    losses: string;
    winrate: string;
    elo: string;
  };
  info: {
    buttonAria: string;
    title: string;
    subtitle: string;
    accessTitle: string;
    rules: {
      version: string;
      iv: string;
      ev: string;
      banlist: string;
    };
    rankedOnlyTag: string;
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
  labels: BattleTowerHomeLabels;
  onNavigate: (page: "lead" | "amical") => void;
  siteUrl: string;
};

export function BattleTowerHome({ labels, onNavigate, siteUrl }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const [banlist, setBanlist] = useState<BannedPokemon[] | null>(null);
  const [banlistLoading, setBanlistLoading] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch banlist une fois au montage (cache 60s côté module)
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

  // Hover gérée avec petit délai pour éviter flicker quand on traverse l'espace button→tooltip
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

  const banlistCount = banlist?.length ?? 0;

  return (
    <div className="relative flex flex-col items-center px-6 py-10 sm:px-10 sm:py-14">
      {/* Info button (top-left) avec tooltip au hover */}
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
          {/* Badge de compteur si Pokémons bannis */}
          {banlistCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border border-rose-300/40 bg-gradient-to-br from-rose-500 to-red-600 px-1 text-[10px] font-bold text-white shadow-[0_4px_12px_rgba(244,63,94,0.45)]"
              aria-hidden
            >
              {banlistCount}
            </span>
          )}
        </button>

        {/* Tooltip overlay */}
        {showInfo && (
          <div
            className="absolute left-0 top-[calc(100%+10px)] w-[min(calc(100vw-3rem),420px)] origin-top-left"
            style={{ animation: "update-page-in 0.2s ease-out both" }}
          >
            {/* Flèche */}
            <div className="absolute -top-[7px] left-4 h-4 w-4 rotate-45 border-l border-t border-amber-400/25 bg-[#141020]" />

            <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-b from-[#1a1226] via-[#130d1f] to-[#0d0918] ring-1 ring-inset ring-amber-300/10 shadow-[0_30px_80px_-20px_rgba(245,158,11,0.4),0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              {/* Corner glow */}
              <div
                className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-400/15 blur-3xl"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl"
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

              {/* Section: Conditions d'accès */}
              <div className="relative px-5 py-4">
                <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber-300/90">
                  <FaCircleCheck className="text-[10px]" />
                  {labels.info.accessTitle}
                </h4>
                <ul className="space-y-2 text-[12.5px] text-white/80">
                  <RuleItem text={labels.info.rules.version} />
                  <RuleItem text={labels.info.rules.iv} />
                  <RuleItem text={labels.info.rules.ev} />
                  <RuleItem
                    text={labels.info.rules.banlist}
                    tag={labels.info.rankedOnlyTag}
                  />
                </ul>
              </div>

              {/* Separator */}
              <div className="relative mx-5 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

              {/* Section: Banlist */}
              <div className="relative px-5 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rose-300/90">
                    <FaBan className="text-[10px]" />
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
                  <ul className="max-h-[340px] space-y-2 overflow-y-auto overscroll-contain pr-2"
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

      {/* Hero header */}
      <div
        className="mb-12 flex flex-col items-center text-center"
        style={{ animation: "update-page-in 0.5s ease-out both" }}
      >
        <div
          className="relative mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 via-white/[0.06] to-sky-500/15 ring-1 ring-white/15"
          style={{ animation: "update-glow-pulse 4s ease-in-out infinite" }}
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400/20 to-transparent" />
          <FaShieldHalved className="relative text-5xl text-amber-200 drop-shadow-[0_0_24px_rgba(245,158,11,0.45)]" />
        </div>
        <h1 className="mb-3 text-center text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {labels.title}
        </h1>
        <p className="max-w-xl text-center text-sm leading-relaxed text-white/55 sm:text-base">
          {labels.subtitle}
        </p>
      </div>

      {/* Two mode cards */}
      <div
        className="mb-14 grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-2"
        style={{ animation: "update-page-in 0.6s ease-out 0.1s both" }}
      >
        {/* Combat Lead */}
        <button
          type="button"
          onClick={() => onNavigate("lead")}
          className="group relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.12] via-orange-500/[0.06] to-transparent p-7 text-left ring-1 ring-inset ring-amber-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-amber-300/40 hover:from-amber-500/[0.18] hover:to-orange-500/[0.1] hover:shadow-[0_20px_60px_-20px_rgba(245,158,11,0.4)]"
        >
          {/* Corner glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-400/20 blur-3xl transition group-hover:bg-amber-400/35" />

          {/* Badge */}
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              <FaTrophy className="text-[9px]" />
              {labels.modes.lead.badge}
            </span>
            <FaChevronRight className="text-sm text-white/30 transition group-hover:translate-x-1 group-hover:text-amber-200" />
          </div>

          {/* Icon */}
          <div className="relative mt-2">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-orange-500/15 ring-1 ring-amber-300/30">
              <FaCrown className="text-2xl text-amber-100 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
            </div>
          </div>

          {/* Title + description */}
          <div className="relative">
            <h2 className="mb-2 text-2xl font-bold text-white">
              {labels.modes.lead.title}
            </h2>
            <p className="text-sm leading-relaxed text-white/55">
              {labels.modes.lead.description}
            </p>
          </div>
        </button>

        {/* Combat Amical */}
        <button
          type="button"
          onClick={() => onNavigate("amical")}
          className="group relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.12] via-teal-500/[0.06] to-transparent p-7 text-left ring-1 ring-inset ring-emerald-300/10 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-300/40 hover:from-emerald-500/[0.18] hover:to-teal-500/[0.1] hover:shadow-[0_20px_60px_-20px_rgba(52,211,153,0.4)]"
        >
          {/* Corner glow */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl transition group-hover:bg-emerald-400/35" />

          {/* Badge */}
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
              <FaHandshake className="text-[9px]" />
              {labels.modes.amical.badge}
            </span>
            <FaChevronRight className="text-sm text-white/30 transition group-hover:translate-x-1 group-hover:text-emerald-200" />
          </div>

          {/* Icon */}
          <div className="relative mt-2">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/25 to-teal-500/15 ring-1 ring-emerald-300/30">
              <FaHandshake className="text-2xl text-emerald-100 drop-shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
            </div>
          </div>

          {/* Title + description */}
          <div className="relative">
            <h2 className="mb-2 text-2xl font-bold text-white">
              {labels.modes.amical.title}
            </h2>
            <p className="text-sm leading-relaxed text-white/55">
              {labels.modes.amical.description}
            </p>
          </div>
        </button>
      </div>

      {/* Stats placeholder section */}
      <div
        className="w-full max-w-4xl"
        style={{ animation: "update-page-in 0.6s ease-out 0.2s both" }}
      >
        <div className="mb-4 flex items-center gap-3">
          <FaChartLine className="text-base text-white/55" />
          <h3 className="text-lg font-semibold text-white/85">{labels.statsTitle}</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile
            icon={<FaTrophy className="text-emerald-300/70" />}
            label={labels.statLabels.wins}
            placeholder={labels.statsPlaceholder}
          />
          <StatTile
            icon={<FaSkull className="text-rose-300/70" />}
            label={labels.statLabels.losses}
            placeholder={labels.statsPlaceholder}
          />
          <StatTile
            icon={<FaChartLine className="text-sky-300/70" />}
            label={labels.statLabels.winrate}
            placeholder={labels.statsPlaceholder}
          />
          <StatTile
            icon={<FaCrown className="text-amber-300/70" />}
            label={labels.statLabels.elo}
            placeholder={labels.statsPlaceholder}
          />
        </div>

        <p className="mt-4 text-center text-xs italic text-white/35">{labels.statsHint}</p>
      </div>
    </div>
  );
}

function RuleItem({ text, tag }: { text: string; tag?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <FaCircleCheck className="mt-0.5 shrink-0 text-[13px] text-emerald-300/85" />
      <span className="flex flex-wrap items-center gap-1.5 leading-snug">
        <span>{text}</span>
        {tag && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">
            <FaCrown className="text-[8px]" />
            {tag}
          </span>
        )}
      </span>
    </li>
  );
}

function StatTile({
  icon,
  label,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.04] backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-base opacity-70">{icon}</span>
      </div>
      {/* Skeleton value */}
      <div className="mb-2 h-8 w-16 animate-pulse rounded-md bg-white/[0.08]" />
      <p className="text-[10px] italic text-white/30">{placeholder}</p>
    </div>
  );
}
