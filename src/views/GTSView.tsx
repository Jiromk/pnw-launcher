import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { normalizeName } from "../utils/pokedexLookup";
import CustomSelect from "../components/CustomSelect";
import { supabaseGts } from "../supabaseGts";
import { supabase as supabaseChat } from "../supabaseClient";

const GTS_BOT_USER_ID = "00000000-0000-0000-0000-000000000001";
import {
  FaArrowLeft,
  FaArrowRightArrowLeft,
  FaMagnifyingGlass,
  FaSpinner,
  FaVenusMars,
  FaMars,
  FaVenus,
  FaHashtag,
  FaCircleInfo,
  FaGlobe,
  FaUser,
  FaStar,
  FaGift,
  FaKey,
  FaFingerprint,
  FaChartLine,
  FaWandMagicSparkles,
  FaBagShopping,
  FaChartPie,
  FaHeart,
  FaHandFist,
  FaShield,
  FaBolt,
  FaShieldHalved,
  FaStairs,
  FaDna,
  FaLeaf,
  FaLayerGroup,
  FaCircleQuestion,
  FaBoxesStacked,
  FaArrowDown,
  FaSpinner as FaSpinner2,
  FaCheck as FaCheck2,
  FaTriangleExclamation as FaWarn2,
  FaXmark,
  FaBoxOpen,
  FaPen,
  FaFloppyDisk,
  FaArrowsRotate,
  FaClockRotateLeft,
  FaHeart as FaHeart2,
  FaHandFist as FaHandFist2,
  FaShield as FaShield2,
  FaBolt as FaBolt2,
  FaWandMagicSparkles as FaWandMagicSparkles2,
  FaShieldHalved as FaShieldHalved2,
  FaListUl,
  FaFilter,
  FaShareNodes,
  FaBell,
  FaTrash,
  FaPlus,
} from "react-icons/fa6";
import {
  parseGtsDepositedPokemon,
  NATURE_FR,
  type GtsDepositedParsed,
} from "../gtsDepositedPokemon";
import PCBoxView, { type TradeFilter } from "./PCBoxView";
import GtsTransferAnim from "../components/GtsTransferAnim";
import GtsSwapAnim from "../components/GtsSwapAnim";

const GTS_GAME_ID = 128;

function isTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function proxyPost(action: string, data: Record<string, string | number> = {}): Promise<string> {
  const fields: Record<string, string> = { action };
  for (const [k, v] of Object.entries(data)) fields[k] = String(v);
  const url = `${window.location.origin}/gts-proxy/api.php?i=${GTS_GAME_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchGtsPokemonBlob(onlineId: string): Promise<string | null> {
  if (isTauriShell()) {
    try {
      const raw = await invoke<string>("cmd_gts_download_pokemon", {
        gameId: GTS_GAME_ID,
        onlineId,
      });
      const t = raw?.trim();
      return t || null;
    } catch {
      return null;
    }
  }
  try {
    const raw = await proxyPost("downloadPokemon", { id: onlineId });
    const t = raw?.trim();
    return t || null;
  } catch {
    return null;
  }
}

async function gtsSearch(
  species: number,
  levelMin: number,
  levelMax: number,
  gender: number,
): Promise<TradeEntry[]> {
  if (isTauriShell()) {
    const raw = await invoke<string>("cmd_gts_search", {
      gameId: GTS_GAME_ID,
      species,
      levelMin,
      levelMax,
      gender,
    });
    const data = JSON.parse(raw) as { trades: TradeEntry[] };
    return data.trades;
  }

  const listRaw = await proxyPost("getPokemonList", { id: 99999, species, levelMin, levelMax, gender });
  if (!listRaw.trim() || listRaw.trim() === "nothing") return [];
  const ids = listRaw.includes("/,,,/") ? listRaw.split("/,,,/") : listRaw.split(",");
  const entries: TradeEntry[] = [];
  for (const id of ids.slice(0, 30)) {
    try {
      const w = await proxyPost("downloadWantedData", { id });
      if (w?.trim()) {
        const p = w.split(",").map(Number);
        entries.push({ onlineId: id, wanted: { species: p[0], levelMin: p[1], levelMax: p[2], gender: p[3] < 0 ? 0 : p[3] } });
      } else {
        entries.push({ onlineId: id, wanted: null });
      }
    } catch { entries.push({ onlineId: id, wanted: null }); }
  }
  return entries;
}

interface TradeEntry {
  onlineId: string;
  wanted: {
    species: number;
    levelMin: number;
    levelMax: number;
    gender: number;
  } | null;
}

/** Jauge niveau 1–100 pour les critères « souhaités » (données serveur). */
function wantLevelRangeStyle(levelMin: number, levelMax: number): { left: string; width: string } {
  const lo = Math.max(1, Math.min(100, levelMin));
  const hi = Math.max(1, Math.min(100, levelMax));
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const left = ((a - 1) / 100) * 100;
  const width = ((b - a + 1) / 100) * 100;
  return { left: `${left}%`, width: `${Math.min(100 - left, width)}%` };
}

/** Barres IV 0–31 + total, avec icônes par stat. */
function GtsIvSpread({ dep }: { dep: GtsDepositedParsed }) {
  const rows: {
    Icon: typeof FaHeart;
    label: string;
    v: number;
    fill: string;
  }[] = [
    { Icon: FaHeart, label: "PS", v: dep.ivHp, fill: "gts-iv-fill--hp" },
    { Icon: FaHandFist, label: "Atk", v: dep.ivAtk, fill: "gts-iv-fill--atk" },
    { Icon: FaShield, label: "Déf", v: dep.ivDfe, fill: "gts-iv-fill--def" },
    { Icon: FaBolt, label: "Vit", v: dep.ivSpd, fill: "gts-iv-fill--spe" },
    { Icon: FaWandMagicSparkles, label: "Sp.A", v: dep.ivAts, fill: "gts-iv-fill--spa" },
    { Icon: FaShieldHalved, label: "Sp.D", v: dep.ivDfs, fill: "gts-iv-fill--spd" },
  ];
  const total = rows.reduce((s, r) => s + r.v, 0);
  return (
    <div className="gts-iv-block">
      <div className="gts-iv-head">
        <FaChartPie className="gts-iv-head-ico" aria-hidden />
        <span className="gts-iv-head-title">Rép. IV</span>
        <span className="gts-iv-total" title="Somme des IV (max 186)">
          <FaDna className="gts-iv-total-ico" aria-hidden />
          Σ {total}
          <span className="gts-iv-total-max">/186</span>
        </span>
      </div>
      <div className="gts-iv-rows">
        {rows.map(({ Icon, label, v, fill }) => (
          <div key={label} className="gts-iv-row">
            <div className="gts-iv-meta">
              <Icon className="gts-iv-stat-ico" aria-hidden />
              <span className="gts-iv-lab">{label}</span>
            </div>
            <div className="gts-iv-bar-track" aria-hidden>
              <div
                className={`gts-iv-bar-fill ${fill}`}
                style={{ width: `${Math.min(100, (v / 31) * 100)}%` }}
              />
            </div>
            <span className="gts-iv-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Affiche les attaques du Pokémon déposé. */
function GtsMoveList({
  moves,
  skillNames,
}: {
  moves: number[];
  skillNames: string[] | null;
}) {
  if (moves.length === 0) return null;
  return (
    <div className="gts-moves-block">
      <div className="gts-moves-head">
        <FaLayerGroup className="gts-moves-head-ico" aria-hidden />
        <span className="gts-moves-head-title">Attaques</span>
      </div>
      <div className="gts-moves-list">
        {moves.map((id, i) => {
          const name = skillNames && skillNames[id] ? skillNames[id] : `#${id}`;
          return (
            <div key={`${id}-${i}`} className="gts-move-chip">
              <span className="gts-move-name">{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Critères bonus stockés par le launcher lors d'un dépôt. */
type GtsLauncherExtras = {
  shiny: "any" | "yes" | "no";
  nature: number | null;
  ivs: { hp: number; atk: number; def: number; spd: number; spa: number; spd2: number };
  depositedAt: number;
};

type CriteriaViolation = {
  label: string;
  demanded: string;
  actual: string;
};

const GENDER_GTS_LABELS: Record<number, string> = { 0: "Indifférent", 1: "Mâle", 2: "Femelle" };
const GENDER_SAVE_LABELS: Record<number, string> = { 0: "Mâle", 1: "Femelle", 2: "Asexué" };

/** Vérifie si un Pokémon respecte tous les critères du dépôt GTS (base + extras).
 *  Retourne un tableau de violations structurées (vide = tout est OK). */
function validateTradeCriteria(
  poke: import("../types").BoxPokemon,
  extras: GtsLauncherExtras | null,
  wanted?: { levelMin: number; levelMax: number; gender: number } | null,
): CriteriaViolation[] {
  const violations: CriteriaViolation[] = [];

  // ── Critères GTS de base (niveau, genre) ──
  if (wanted) {
    const lvl = poke.level ?? 1;
    if (lvl < wanted.levelMin || lvl > wanted.levelMax) {
      violations.push({
        label: "Niveau",
        demanded: wanted.levelMin === wanted.levelMax ? String(wanted.levelMin) : `${wanted.levelMin} — ${wanted.levelMax}`,
        actual: String(lvl),
      });
    }
    if (wanted.gender > 0) {
      // GTS: 1=mâle, 2=femelle ; save: 0=♂, 1=♀, 2=asexué
      const gtsToSave = wanted.gender === 1 ? 0 : 1;
      if (poke.gender !== gtsToSave) {
        violations.push({
          label: "Genre",
          demanded: GENDER_GTS_LABELS[wanted.gender] ?? "?",
          actual: GENDER_SAVE_LABELS[poke.gender ?? 2] ?? "?",
        });
      }
    }
  }

  if (!extras) return violations;

  // ── Critères launcher (shiny, nature, IVs) ──

  // Shiny
  if (extras.shiny === "yes" && !poke.isShiny) {
    violations.push({ label: "Shiny", demanded: "Oui", actual: "Non" });
  } else if (extras.shiny === "no" && poke.isShiny) {
    violations.push({ label: "Shiny", demanded: "Non", actual: "Oui" });
  }

  // Nature
  if (extras.nature !== null && poke.nature !== extras.nature) {
    const wantedName = NATURE_FR[extras.nature] ?? `#${extras.nature}`;
    const haveName = poke.nature != null ? (NATURE_FR[poke.nature] ?? `#${poke.nature}`) : "Inconnue";
    violations.push({ label: "Nature", demanded: wantedName, actual: haveName });
  }

  // IVs — si tous à 0, c'est "peu importe"
  const { hp, atk, def: ivDef, spd, spa, spd2 } = extras.ivs;
  const allZero = hp === 0 && atk === 0 && ivDef === 0 && spd === 0 && spa === 0 && spd2 === 0;
  if (!allZero) {
    const checks: { min: number; actual: number; label: string }[] = [
      { min: hp,    actual: poke.ivHp  ?? 0, label: "PV" },
      { min: atk,   actual: poke.ivAtk ?? 0, label: "Atk" },
      { min: ivDef, actual: poke.ivDfe ?? 0, label: "Déf" },
      { min: spd,   actual: poke.ivSpd ?? 0, label: "Vit" },
      { min: spa,   actual: poke.ivAts ?? 0, label: "Sp.A" },
      { min: spd2,  actual: poke.ivDfs ?? 0, label: "Sp.D" },
    ];
    for (const { min, actual, label } of checks) {
      if (min > 0 && actual < min) {
        violations.push({ label, demanded: `≥ ${min}`, actual: String(actual) });
      }
    }
  }

  return violations;
}

const GENDER_LABELS: Record<number, string> = {
  0: "Indifférent",
  1: "Mâle",
  2: "Femelle",
};

/** Genre du Pokémon déposé (PSDK : 0 mâle, 1 femelle, 2 sans genre). */
const POKEMON_GENDER_LABELS: Record<number, string> = {
  0: "Mâle",
  1: "Femelle",
  2: "Sans genre",
};

const GENDER_ICONS: Record<number, React.ReactNode> = {
  0: <FaVenusMars className="gts-gender-icon gts-gender-icon--any" />,
  1: <FaMars className="gts-gender-icon gts-gender-icon--male" />,
  2: <FaVenus className="gts-gender-icon gts-gender-icon--female" />,
};

const POKEMON_GENDER_ICONS: Record<number, React.ReactNode> = {
  0: <FaMars className="gts-gender-icon gts-gender-icon--male" />,
  1: <FaVenus className="gts-gender-icon gts-gender-icon--female" />,
  2: <FaVenusMars className="gts-gender-icon gts-gender-icon--any" />,
};

type DexRow = { id: number; name: string; imageUrl?: string; isExtradex?: boolean; extradexNum?: number };

function parseDexEntries(res: unknown): DexRow[] {
  const entries = (res as { pokedex?: { entries?: unknown[] } })?.pokedex?.entries;
  if (!Array.isArray(entries)) return [];
  const out: DexRow[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    const num = parseInt(String(o.num ?? o.number ?? ""), 10);
    if (!name || !Number.isFinite(num) || num < 1) continue;
    out.push({
      id: num,
      name,
      imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : undefined,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

function parseExtradexEntries(res: unknown): DexRow[] {
  const entries = (res as { extradex?: { entries?: unknown[] } })?.extradex?.entries;
  if (!Array.isArray(entries)) return [];
  const out: DexRow[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    const extradexNum = parseInt(String(o.num ?? o.number ?? ""), 10);
    if (!name || !Number.isFinite(extradexNum) || extradexNum < 1) continue;
    out.push({
      id: extradexNum + 10000,
      name,
      imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : undefined,
      isExtradex: true,
      extradexNum,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

function mergeDexRows(pokedex: DexRow[], extradex: DexRow[]): DexRow[] {
  const nameSet = new Set(pokedex.map((r) => normalizeName(r.name)));
  const merged = [...pokedex];
  for (const ex of extradex) {
    if (!nameSet.has(normalizeName(ex.name))) {
      merged.push(ex);
      nameSet.add(normalizeName(ex.name));
    }
  }
  return merged.sort((a, b) => {
    if (a.isExtradex && !b.isExtradex) return 1;
    if (!a.isExtradex && b.isExtradex) return -1;
    if (a.isExtradex && b.isExtradex) return (a.extradexNum ?? 0) - (b.extradexNum ?? 0);
    return a.id - b.id;
  });
}

/** ID interne GTS = index dans la liste lue depuis `Data/2.dat`, trouvé par nom français normalisé. */
function internalIdFromPokemonName(
  row: DexRow | undefined,
  psdkNameToInternal: Map<string, number> | null,
): number | null {
  if (!row || !psdkNameToInternal) return null;
  return psdkNameToInternal.get(normalizeName(row.name)) ?? null;
}

function resolveSpeciesFromQuery(
  query: string,
  rows: DexRow[],
): { id: number | null; error?: string } {
  const t = query.trim();
  if (!t) return { id: null, error: "Entrez un nom ou un n° de Pokémon." };

  const paren = /\(#(\d+)\)\s*$/i.exec(t);
  if (paren) {
    const n = parseInt(paren[1], 10);
    return n >= 1 ? { id: n } : { id: null, error: "Numéro invalide." };
  }

  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 ? { id: n } : { id: null, error: "Numéro invalide." };
  }

  const q = normalizeName(t);
  if (!q) return { id: null, error: "Entrez un nom ou un n° de Pokémon." };

  const exact = rows.find((r) => normalizeName(r.name) === q);
  if (exact) return { id: exact.id };

  const partial = rows.filter((r) => normalizeName(r.name).includes(q));
  if (partial.length === 1) return { id: partial[0].id };
  if (partial.length === 0) {
    return { id: null, error: `Aucun Pokémon ne correspond à « ${t} ».` };
  }
  return {
    id: null,
    error: "Plusieurs Pokémon correspondent, choisissez-en un dans la liste.",
  };
}

export default function GTSView({
  siteUrl,
  onBack,
  profile,
  savePath,
  onProfileReload,
  onShareToChat,
  pendingOnlineId,
  onPendingOnlineIdConsumed,
  chatProfile,
  onWishlistMatchCount,
}: {
  siteUrl: string;
  onBack?: () => void;
  profile?: import("../types").PlayerProfile | null;
  savePath?: string | null;
  onProfileReload?: () => void;
  onShareToChat?: (data: import("../types").GtsShareData) => void;
  pendingOnlineId?: string | number | null;
  onPendingOnlineIdConsumed?: () => void;
  chatProfile?: import("../types").ChatProfile | null;
  onWishlistMatchCount?: (count: number) => void;
}) {
  const base = siteUrl.replace(/\/$/, "");
  const [showPCBox, setShowPCBox] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  // ─── Wishlist (Patreon) ───
  const isPatreon = chatProfile?.roles?.includes("patreon") || chatProfile?.roles?.includes("admin") || chatProfile?.roles?.includes("devteam");
  const [showWishlist, setShowWishlist] = useState(false);
  const [wishlistGateReason, setWishlistGateReason] = useState<"login" | "patreon" | null>(null);
  type GtsWishlist = { id: number; chat_user_id: string; wanted_species: number; wanted_shiny: string; wanted_nature: number | null; wanted_iv_min: number; wanted_gender: number; notified_ids: number[] };
  const [wishlists, setWishlists] = useState<GtsWishlist[]>([]);
  const [wishSpeciesQuery, setWishSpeciesQuery] = useState("");
  const [wishSpeciesId, setWishSpeciesId] = useState<number | null>(null);
  const [wishSuggestOpen, setWishSuggestOpen] = useState(false);
  const [wishExpandedIds, setWishExpandedIds] = useState<Set<number>>(new Set());
  const [wishSeenOids, setWishSeenOids] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem("pnw.gts.wishSeenOids"); return raw ? new Set(JSON.parse(raw)) : new Set(); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem("pnw.gts.wishSeenOids", JSON.stringify([...wishSeenOids])); } catch {}
  }, [wishSeenOids]);
  const wishSuggestRef = useRef<HTMLDivElement>(null);
  const [wishShiny, setWishShiny] = useState<"any" | "yes" | "no">("any");
  const [wishNature, setWishNature] = useState<number | null>(null);
  const [wishIvMin, setWishIvMin] = useState(0);
  const [wishGender, setWishGender] = useState(0);
  const wishlistsRef = useRef<GtsWishlist[]>([]);
  useEffect(() => { wishlistsRef.current = wishlists; }, [wishlists]);

  // Charger les wishlists au montage si Patreon
  useEffect(() => {
    if (!isPatreon || !chatProfile?.id) return;
    supabaseGts.from("gts_wishlists").select("*").eq("chat_user_id", chatProfile.id)
      .then(({ data }) => { if (data) setWishlists(data as GtsWishlist[]); });
  }, [isPatreon, chatProfile?.id]);

  /** Vérifie un nouveau dépôt contre TOUTES les wishlists (pas seulement les nôtres) et envoie les DM */
  const checkWishlistsForDeposit = useCallback(async (deposit: BrowseEntry) => {
    if (!deposit.parsed) return;
    try {
      // Charger toutes les wishlists de tous les Patreon
      const { data: allWishlists } = await supabaseGts.from("gts_wishlists").select("*");
      if (!allWishlists || allWishlists.length === 0) return;

      const oid = parseInt(deposit.onlineId, 10);
      const dep = deposit.parsed;
      const ivTotal = (dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0);

      for (const wish of allWishlists as GtsWishlist[]) {
        // Vérifier si déjà notifié
        if (wish.notified_ids?.includes(oid)) continue;
        // Vérifier les critères
        if (deposit.depositedSpecies !== wish.wanted_species) continue;
        if (wish.wanted_shiny === "yes" && !dep.isShiny && !dep.isAltShiny) continue;
        if (wish.wanted_shiny === "no" && (dep.isShiny || dep.isAltShiny)) continue;
        if (wish.wanted_nature !== null && dep.nature !== wish.wanted_nature) continue;
        if (wish.wanted_gender > 0) {
          const expected = wish.wanted_gender; // 1=mâle, 2=femelle
          if (dep.gender !== expected) continue;
        }
        if (wish.wanted_iv_min > 0 && ivTotal < wish.wanted_iv_min) continue;

        // Match trouvé ! Envoyer un DM
        console.log(`[GTS wishlist] Match trouvé pour user ${wish.chat_user_id} — dépôt #${oid}`);

        // Résoudre le nom et sprite de l'espèce déposée
        const depRow = speciesByInternalRef.current.get(deposit.depositedSpecies);
        const specName = depRow?.name ?? psdkFrenchNamesRef.current?.[deposit.depositedSpecies] ?? `#${deposit.depositedSpecies}`;
        const specSprite = depRow?.imageUrl ? fullImageUrl(depRow.imageUrl) : "";
        const natureName = NATURE_FR[dep.nature] ?? "";
        const wantedName = deposit.wanted ? (psdkFrenchNamesRef.current?.[deposit.wanted.species] ?? `#${deposit.wanted.species}`) : "?";
        const wantedRow = deposit.wanted ? speciesByInternalRef.current.get(deposit.wanted.species) : null;
        const wantedSprite = wantedRow?.imageUrl ? fullImageUrl(wantedRow.imageUrl) : "";

        // Format embed JSON pour le chat (rendu en carte interactive)
        const wishData = {
          onlineId: deposit.onlineId,
          name: specName,
          sprite: specSprite,
          level: dep.level ?? 0,
          nature: natureName,
          gender: dep.gender ?? 0,
          shiny: dep.isShiny ?? false,
          altShiny: dep.isAltShiny ?? false,
          ivTotal,
          wantedName,
          wantedSprite,
          wantedLevelRange: deposit.wanted ? `${deposit.wanted.levelMin}–${deposit.wanted.levelMax}` : null,
        };
        const msg = `🔔WISHLIST🔔${JSON.stringify(wishData)}`;

        // Envoyer un DM via le bot GTS (RPC SECURITY DEFINER qui bypasse le RLS)
        try {
          const { data: dmId, error: rpcErr } = await supabaseChat.rpc("send_bot_dm", {
            p_target_user_id: wish.chat_user_id,
            p_content: msg,
          });
          if (rpcErr) {
            console.warn(`[GTS wishlist] Erreur RPC send_bot_dm:`, rpcErr);
          } else {
            console.log(`[GTS wishlist] DM bot envoyé à ${wish.chat_user_id} dans channel ${dmId}`);
          }
        } catch (e) {
          console.warn(`[GTS wishlist] Erreur envoi DM bot:`, e);
        }

        // Marquer comme notifié
        supabaseGts.from("gts_wishlists").update({
          notified_ids: [...(wish.notified_ids ?? []), oid],
        }).eq("id", wish.id).then(() => {});
      }
    } catch (e) {
      console.warn("[GTS wishlist] Erreur vérification wishlists:", e);
    }
  }, []);

  const [historyPage, setHistoryPage] = useState(0);
  const HISTORY_PER_PAGE = 5;
  const [dexRows, setDexRows] = useState<DexRow[]>([]);
  const [dexLoading, setDexLoading] = useState(true);
  const [pokemonQuery, setPokemonQuery] = useState("");
  const [resolvedPickId, setResolvedPickId] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);
  const searchSectionRef = useRef<HTMLElement>(null);
  const [levelMin, setLevelMin] = useState(1);
  const [levelMax, setLevelMax] = useState(100);
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [directSearchInternalId, setDirectSearchInternalId] = useState<number | null>(null);
  const [gender, setGender] = useState(0);
  const [results, setResults] = useState<TradeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  /** Noms français par ID interne (index = ID PSDK), lus depuis `Data/2.dat` via Tauri. Hors Tauri : vide (pas d'accès au disque). */
  const [psdkFrenchNames, setPsdkFrenchNames] = useState<string[] | null>(() =>
    isTauriShell() ? null : [],
  );
  const psdkFrenchNamesRef = useRef<string[] | null>(null);
  useEffect(() => { psdkFrenchNamesRef.current = psdkFrenchNames; }, [psdkFrenchNames]);
  const speciesByInternalRef = useRef<Map<number, DexRow>>(new Map());
  /** Noms français des attaques (index = ID PSDK de l'attaque). */
  const [psdkSkillNames, setPsdkSkillNames] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isTauriShell()) return;
    let cancelled = false;
    invoke<string>("cmd_psdk_french_species_names")
      .then((raw) => {
        if (cancelled) return;
        try {
          const arr = JSON.parse(raw) as unknown;
          if (Array.isArray(arr) && arr.length > 100 && arr.every((x) => typeof x === "string")) {
            setPsdkFrenchNames(arr as string[]);
          } else {
            setPsdkFrenchNames([]);
          }
        } catch {
          setPsdkFrenchNames([]);
        }
      })
      .catch(() => {
        if (!cancelled) setPsdkFrenchNames([]);
      });
    // Charger aussi les noms d'attaques
    invoke<string>("cmd_psdk_french_skill_names")
      .then((raw) => {
        if (cancelled) return;
        try {
          const arr = JSON.parse(raw) as unknown;
          if (Array.isArray(arr) && arr.length > 50 && arr.every((x) => typeof x === "string")) {
            setPsdkSkillNames(arr as string[]);
          } else {
            setPsdkSkillNames([]);
          }
        } catch {
          setPsdkSkillNames([]);
        }
      })
      .catch(() => {
        if (!cancelled) setPsdkSkillNames([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${base}/api/pokedex?t=${Date.now()}`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/extradex?t=${Date.now()}`).then((r) => r.json()).catch(() => null),
    ]).then(([pokedexData, extradexData]) => {
      if (cancelled) return;
      const pokedex = parseDexEntries(pokedexData);
      const extradex = parseExtradexEntries(extradexData);
      setDexRows(mergeDexRows(pokedex, extradex));
    }).catch(() => {
      if (!cancelled) setDexRows([]);
    }).finally(() => {
      if (!cancelled) setDexLoading(false);
    });
    return () => { cancelled = true; };
  }, [base]);

  const speciesById = useMemo(() => {
    const m = new Map<number, DexRow>();
    for (const r of dexRows) m.set(r.id, r);
    return m;
  }, [dexRows]);

  /** Nom français normalisé → ID interne (index dans la liste issue de Data/2.dat). */
  const psdkNameToInternal = useMemo(() => {
    if (psdkFrenchNames === null) return null;
    const m = new Map<string, number>();
    psdkFrenchNames.forEach((name, id) => {
      const k = normalizeName(name);
      if (!m.has(k)) m.set(k, id);
    });
    return m;
  }, [psdkFrenchNames]);

  const speciesByInternal = useMemo(() => {
    const m = new Map<number, DexRow>();
    if (!psdkNameToInternal) return m;
    for (const r of dexRows) {
      const id = psdkNameToInternal.get(normalizeName(r.name));
      if (id != null) m.set(id, r);
    }
    return m;
  }, [dexRows, psdkNameToInternal]);
  useEffect(() => { speciesByInternalRef.current = speciesByInternal; }, [speciesByInternal]);

  /** Résout le nom d'espèce : PSDK Data/2.dat > dex website > nickname */
  const resolveSpeciesName = useCallback((internalId: number, nickname?: string | null): string => {
    if (psdkFrenchNames && internalId > 0 && internalId < psdkFrenchNames.length && psdkFrenchNames[internalId]) {
      return psdkFrenchNames[internalId];
    }
    const row = speciesByInternal.get(internalId);
    if (row?.name) return row.name;
    return nickname || "Pokémon";
  }, [psdkFrenchNames, speciesByInternal]);

  const psdkDataReady =
    psdkFrenchNames !== null && psdkNameToInternal != null && psdkNameToInternal.size > 0;

  /* ─── Supabase → BrowseEntry conversion ─── */
  function supabaseRowToBrowseEntry(row: any): BrowseEntry {
    const parsed: GtsDepositedParsed = {
      speciesInternalId: row.deposited_species ?? 0,
      level: row.deposited_level ?? 1,
      gender: row.deposited_gender ?? 0,
      form: row.deposited_form ?? 0,
      nature: row.deposited_nature ?? 0,
      itemHolding: 0,
      ability: 0,
      trainerIdRaw: 0,
      trainerVisibleId: 0,
      trainerName: row.deposited_trainer_name || "—",
      nickname: row.deposited_nickname ?? null,
      exp: 0,
      isShiny: row.deposited_shiny ?? false,
      isAltShiny: row.deposited_alt_shiny ?? false,
      ivHp: row.deposited_iv_hp ?? 0,
      ivAtk: row.deposited_iv_atk ?? 0,
      ivDfe: row.deposited_iv_dfe ?? 0,
      ivSpd: row.deposited_iv_spd ?? 0,
      ivAts: row.deposited_iv_ats ?? 0,
      ivDfs: row.deposited_iv_dfs ?? 0,
      marshalRareness: null,
      marshalShinyRate: null,
      moves: row.deposited_moves ?? [],
    };
    return {
      onlineId: String(row.online_id),
      depositedSpecies: row.deposited_species ?? 0,
      wanted: row.wanted_species ? {
        species: row.wanted_species,
        levelMin: row.wanted_level_min ?? 1,
        levelMax: row.wanted_level_max ?? 100,
        gender: row.wanted_gender ?? 0,
      } : null,
      parsed,
      firstSeenAt: row.first_seen_at ? new Date(row.first_seen_at).getTime() : 0,
    };
  }

  function browseEntryToSupabaseRow(entry: BrowseEntry) {
    const p = entry.parsed;
    return {
      online_id: parseInt(entry.onlineId, 10),
      deposited_species: entry.depositedSpecies,
      wanted_species: entry.wanted?.species ?? 0,
      wanted_level_min: entry.wanted?.levelMin ?? 1,
      wanted_level_max: entry.wanted?.levelMax ?? 100,
      wanted_gender: entry.wanted?.gender ?? 0,
      deposited_level: p?.level ?? 1,
      deposited_gender: p?.gender ?? 0,
      deposited_nature: p?.nature ?? 0,
      deposited_form: p?.form ?? 0,
      deposited_shiny: p?.isShiny ?? false,
      deposited_alt_shiny: p?.isAltShiny ?? false,
      deposited_iv_hp: p?.ivHp ?? 0,
      deposited_iv_atk: p?.ivAtk ?? 0,
      deposited_iv_dfe: p?.ivDfe ?? 0,
      deposited_iv_spd: p?.ivSpd ?? 0,
      deposited_iv_ats: p?.ivAts ?? 0,
      deposited_iv_dfs: p?.ivDfs ?? 0,
      deposited_trainer_name: p?.trainerName ?? "",
      deposited_nickname: p?.nickname ?? null,
      deposited_moves: p?.moves ?? [],
      updated_at: new Date().toISOString(),
    };
  }

  /* ─── Browse state (catalogue automatique) ─── */
  interface BrowseEntry {
    onlineId: string;
    depositedSpecies: number; // résolu depuis le blob
    wanted: { species: number; levelMin: number; levelMax: number; gender: number } | null;
    parsed: GtsDepositedParsed | null; // blob décodé
    firstSeenAt: number; // timestamp de première découverte
  }
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseDetailEntry, setBrowseDetailEntry] = useState<BrowseEntry | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [launcherDepositIds, setLauncherDepositIds] = useState<Set<string>>(new Set());
  const myDepositOnlineIdRef = useRef<string | null>(null);
  const [browseProgress, setBrowseProgress] = useState<{ scanned: number; total: number; found: number } | null>(null);
  const [browseLastFetchTime, setBrowseLastFetchTime] = useState(0);
  const [browseNameQuery, setBrowseNameQuery] = useState("");
  const [browseGender, setBrowseGender] = useState(0);
  const [browseLevelMin, setBrowseLevelMin] = useState(1);
  const [browseLevelMax, setBrowseLevelMax] = useState(100);
  const [browseSortOrder, setBrowseSortOrder] = useState<"newest" | "oldest">("newest");
  const [browseShinyOnly, setBrowseShinyOnly] = useState(false);
  // Filtres avancés
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterNature, setFilterNature] = useState<number | null>(null);
  const [filterShiny, setFilterShiny] = useState<"any" | "yes" | "no">("any");
  const [filterIvs, setFilterIvs] = useState({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 });
  const [filterWantedQuery, setFilterWantedQuery] = useState("");
  const [browseDepositByOnlineId, setBrowseDepositByOnlineId] = useState<
    Record<string, GtsDepositedParsed | null | undefined>
  >({});
  const browseDepositFetchGen = useRef(0);

  /** Nombre total de dépôts GTS correspondant aux wishlists (non encore vus) */
  const wishlistMatchCount = useMemo(() => {
    if (wishlists.length === 0 || browseEntries.length === 0) return 0;
    let count = 0;
    for (const w of wishlists) {
      for (const entry of browseEntries) {
        if (!entry.parsed) continue;
        if (wishSeenOids.has(entry.onlineId)) continue;
        if (entry.depositedSpecies !== w.wanted_species) continue;
        const dep = entry.parsed;
        if (w.wanted_shiny === "yes" && !dep.isShiny && !dep.isAltShiny) continue;
        if (w.wanted_shiny === "no" && (dep.isShiny || dep.isAltShiny)) continue;
        if (w.wanted_nature !== null && dep.nature !== w.wanted_nature) continue;
        if (w.wanted_gender > 0 && dep.gender !== w.wanted_gender) continue;
        const ivTotal = (dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0);
        if (w.wanted_iv_min > 0 && ivTotal < w.wanted_iv_min) continue;
        count++;
      }
    }
    return count;
  }, [wishlists, browseEntries, wishSeenOids]);

  useEffect(() => { onWishlistMatchCount?.(wishlistMatchCount); }, [wishlistMatchCount, onWishlistMatchCount]);

  // Nettoyer les seenOids qui ne correspondent plus à des dépôts existants
  useEffect(() => {
    if (browseEntries.length === 0 || wishSeenOids.size === 0) return;
    const activeOids = new Set(browseEntries.map((e) => e.onlineId));
    const cleaned = new Set([...wishSeenOids].filter((oid) => activeOids.has(oid)));
    if (cleaned.size < wishSeenOids.size) setWishSeenOids(cleaned);
  }, [browseEntries]);

  /* ─── Auto-open exchange from chat card ─── */
  useEffect(() => {
    if (!pendingOnlineId || !browseEntries.length) return;
    const id = String(pendingOnlineId);
    const entry = browseEntries.find((e) => String(e.onlineId) === id);
    if (entry) {
      // Open the result popup for this specific entry
      const depRow = speciesByInternal.get(entry.depositedSpecies);
      if (depRow) {
        setPokemonQuery(`${depRow.name} (#${depRow.id})`);
        setResolvedPickId(depRow.id);
      } else {
        const pName = psdkFrenchNamesRef.current?.[entry.depositedSpecies];
        if (pName) setPokemonQuery(pName);
      }
      setResults([{ onlineId: entry.onlineId, wanted: entry.wanted }]);
      setSearched(true);
      setError(null);
    }
    onPendingOnlineIdConsumed?.();
  }, [pendingOnlineId, browseEntries.length]);

  /** Clé localStorage pour le cache browse GTS */
  const GTS_BROWSE_CACHE_KEY = "gts-browse-cache";
  interface BrowseCacheData {
    entries: Array<{
      onlineId: string;
      depositedSpecies: number;
      wanted: BrowseEntry["wanted"];
      blob: string; // garder le blob pour re-parser si besoin
      firstSeenAt?: number;
    }>;
    timestamp: number;
    maxOnlineId: number;
  }

  /** Parse les entrées brutes du serveur kawasemi en BrowseEntry[] */
  const parseRawEntries = useCallback((rawEntries: any[]): { entries: BrowseEntry[]; blobs: Record<string, string> } => {
    const blobs: Record<string, string> = {};
    const entries: BrowseEntry[] = rawEntries.map((e: any) => {
      let depositedParsed: GtsDepositedParsed | null = null;
      let depositedSpecies = 0;
      const blobStr = (e.blob && typeof e.blob === "string") ? e.blob : "";
      if (blobStr.length > 0) {
        blobs[String(e.onlineId)] = blobStr;
        try {
          depositedParsed = parseGtsDepositedPokemon(blobStr);
          depositedSpecies = depositedParsed?.speciesInternalId ?? 0;
        } catch (err) {
          console.warn(`[GTS browse] Erreur décodage blob pour ID ${e.onlineId}:`, err);
        }
      }
      return {
        onlineId: String(e.onlineId),
        depositedSpecies,
        wanted: e.wanted
          ? {
              species: Number(e.wanted.species),
              levelMin: Number(e.wanted.levelMin),
              levelMax: Number(e.wanted.levelMax),
              gender: Number(e.wanted.gender),
            }
          : null,
        parsed: depositedParsed,
        firstSeenAt: Date.now(),
      };
    });
    return { entries, blobs };
  }, []);

  /** Charge le catalogue browse depuis Supabase (instantané) */
  const loadBrowseFromSupabase = useCallback(async (): Promise<BrowseEntry[] | null> => {
    try {
      const { data: rows, error } = await supabaseGts
        .from("gts_deposits")
        .select("*")
        .order("first_seen_at", { ascending: false });
      if (error || !rows || rows.length === 0) return null;
      const entries = rows.map(supabaseRowToBrowseEntry);
      console.log(`[GTS browse] Chargé depuis Supabase — ${entries.length} dépôts`);
      return entries;
    } catch (e) {
      console.warn("[GTS browse] Erreur chargement Supabase:", e);
      return null;
    }
  }, []);

  // Chargement instantané Supabase au montage (séparé du scan)
  const supabaseLoadDone = useRef(false);
  useEffect(() => {
    if (supabaseLoadDone.current) return;
    supabaseLoadDone.current = true;
    loadBrowseFromSupabase().then((entries) => {
      if (entries && entries.length > 0) {
        setBrowseEntries(entries);
        const depositMap: Record<string, GtsDepositedParsed | null> = {};
        for (const e of entries) depositMap[e.onlineId] = e.parsed;
        setBrowseDepositByOnlineId(depositMap);
        setBrowseLastFetchTime(Date.now());
        console.log(`[GTS browse] Affichage instantané — ${entries.length} dépôts depuis Supabase`);
      }
    });
  }, [loadBrowseFromSupabase]);

  const startBrowseScan = useCallback(async (forceFullScan = false) => {
    if (browseLoading) return;

    // Scan background kawasemi (Tauri uniquement) pour synchroniser
    if (!isTauriShell()) return;

    // Récupérer les IDs connus depuis Supabase pour le scan optimisé
    let supabaseIds: number[] = [];
    try {
      const { data: rows } = await supabaseGts.from("gts_deposits").select("online_id");
      if (rows) supabaseIds = rows.map((r) => r.online_id as number).filter((n) => n > 0);
    } catch {}

    const knownIds = supabaseIds.length > 0 && !forceFullScan ? supabaseIds : [];
    const lastMaxId = knownIds.length > 0 ? Math.max(...knownIds) : 0;
    console.log(`[GTS browse] Scan ${knownIds.length > 0 ? "optimisé" : "complet"} — ${knownIds.length} IDs connus`);

    setBrowseLoading(true);
    setBrowseProgress({ scanned: 0, total: 1, found: 0 });

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<{ scanned: number; total: number; found: number }>(
        "pnw://gts-browse-progress",
        (ev) => setBrowseProgress(ev.payload),
      ) as unknown as () => void;

      // Inclure le propre onlineId + IDs des dépôts launcher
      const extraIds: number[] = [];
      if (myDepositOnlineIdRef.current) {
        const n = parseInt(myDepositOnlineIdRef.current, 10);
        if (n > 0) extraIds.push(n);
      }
      try {
        const launcherIds = await invoke<number[]>("cmd_gts_list_extras_ids");
        for (const lid of launcherIds) if (lid > 0 && !extraIds.includes(lid)) extraIds.push(lid);
      } catch {}

      const raw = await invoke<string>("cmd_gts_browse_all", {
        gameId: GTS_GAME_ID,
        knownIds,
        lastMaxId,
        extraIds,
      });
      const parsed = JSON.parse(raw);
      const { entries } = parseRawEntries(parsed.entries ?? []);

      // Injecter le propre dépôt s'il est absent
      const myId = myDepositOnlineIdRef.current;
      if (myId && !entries.find((e) => String(e.onlineId) === myId)) {
        try {
          const wRaw = await invoke<string>("cmd_gts_download_wanted_data", { gameId: GTS_GAME_ID, onlineId: parseInt(myId, 10) });
          const wTrimmed = wRaw?.trim();
          if (wTrimmed) {
            const parts = wTrimmed.split(",").map(Number);
            const blobRaw = await fetchGtsPokemonBlob(myId);
            const depParsed = blobRaw ? parseGtsDepositedPokemon(blobRaw) : null;
            entries.push({
              onlineId: myId,
              depositedSpecies: depParsed?.speciesInternalId ?? 0,
              wanted: parts.length >= 4 ? { species: parts[0], levelMin: parts[1], levelMax: parts[2], gender: parts[3] < 0 ? 0 : parts[3] } : null,
              parsed: depParsed,
              firstSeenAt: Date.now(),
            });
          }
        } catch {}
      }

      // Synchroniser avec Supabase : upsert toutes les entrées avec données complètes
      const upsertRows = entries.map(browseEntryToSupabaseRow);
      if (upsertRows.length > 0) {
        supabaseGts.from("gts_deposits")
          .upsert(upsertRows, { onConflict: "online_id" })
          .then(({ error }) => {
            if (error) console.warn("[GTS browse] Erreur sync Supabase:", error.message);
            else console.log(`[GTS browse] ${upsertRows.length} dépôts synchronisés vers Supabase`);
          });
      }

      // Nettoyer les dépôts retirés
      const activeIds = new Set(entries.map((e) => e.onlineId));
      const staleIds = supabaseIds.filter((id) => !activeIds.has(String(id)));
      if (staleIds.length > 0) {
        supabaseGts.from("gts_deposits").delete().in("online_id", staleIds)
          .then(({ error }) => {
            if (error) console.warn("[GTS browse] Erreur nettoyage Supabase:", error.message);
            else console.log(`[GTS browse] ${staleIds.length} dépôts stale supprimés de Supabase`);
          });
      }

      // Recharger depuis Supabase pour avoir les first_seen_at corrects
      const freshEntries = await loadBrowseFromSupabase();
      if (freshEntries) {
        setBrowseEntries(freshEntries);
        const depositMap: Record<string, GtsDepositedParsed | null> = {};
        for (const e of freshEntries) depositMap[e.onlineId] = e.parsed;
        setBrowseDepositByOnlineId(depositMap);
      } else {
        // Fallback : utiliser les entrées du scan directement
        setBrowseEntries(entries);
        const depositMap: Record<string, GtsDepositedParsed | null> = {};
        for (const e of entries) depositMap[e.onlineId] = e.parsed;
        setBrowseDepositByOnlineId(depositMap);
      }
      setBrowseLastFetchTime(Date.now());
    } catch (err) {
      console.error("[GTS browse] scan error:", err);
    } finally {
      unlisten?.();
      setBrowseLoading(false);
      setBrowseProgress(null);
    }
  }, [browseLoading, browseEntries.length, parseRawEntries, loadBrowseFromSupabase]);

  // Lancer le scan automatiquement au montage
  const browseScanStarted = useRef(false);
  const startBrowseScanRef = useRef(startBrowseScan);
  startBrowseScanRef.current = startBrowseScan;
  // Compteur "il y a X min" qui se rafraîchit toutes les 30s
  const [browseAgoText, setBrowseAgoText] = useState("");
  useEffect(() => {
    const update = () => {
      if (browseLastFetchTime <= 0) { setBrowseAgoText(""); return; }
      const mins = Math.round((Date.now() - browseLastFetchTime) / 60000);
      setBrowseAgoText(mins < 1 ? "à l'instant" : `il y a ${mins} min`);
    };
    update();
    const iv = setInterval(update, 30_000);
    return () => clearInterval(iv);
  }, [browseLastFetchTime]);

  useEffect(() => {
    if (browseScanStarted.current) return;
    browseScanStarted.current = true;
    // Délai pour laisser les données PSDK se charger
    const t = setTimeout(() => void startBrowseScanRef.current(), 1200);
    // Auto-refresh toutes les 15 minutes (Realtime couvre l'entre-deux)
    const interval = setInterval(() => {
      console.log("[GTS browse] Auto-refresh…");
      void startBrowseScanRef.current();
    }, 15 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Supabase Realtime : mises à jour en temps réel ───
  useEffect(() => {
    const channel = supabaseGts
      .channel("gts-deposits-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "gts_deposits" },
        (payload) => {
          const newEntry = supabaseRowToBrowseEntry(payload.new);
          setBrowseEntries((prev) => {
            if (prev.some((e) => e.onlineId === newEntry.onlineId)) return prev;
            return [newEntry, ...prev];
          });
          if (newEntry.parsed) {
            setBrowseDepositByOnlineId((prev) => ({ ...prev, [newEntry.onlineId]: newEntry.parsed }));
          }
          console.log(`[GTS realtime] Nouveau dépôt #${newEntry.onlineId}`);
          // Vérifier les wishlists pour ce nouveau dépôt
          void checkWishlistsForDeposit(newEntry);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "gts_deposits" },
        (payload) => {
          const updated = supabaseRowToBrowseEntry(payload.new);
          setBrowseEntries((prev) => prev.map((e) => (e.onlineId === updated.onlineId ? updated : e)));
          if (updated.parsed) {
            setBrowseDepositByOnlineId((prev) => ({ ...prev, [updated.onlineId]: updated.parsed }));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "gts_deposits" },
        (payload) => {
          const deletedId = String((payload.old as any)?.online_id);
          if (!deletedId) return;
          setBrowseEntries((prev) => prev.filter((e) => e.onlineId !== deletedId));
          setBrowseDepositByOnlineId((prev) => {
            const next = { ...prev };
            delete next[deletedId];
            return next;
          });
          console.log(`[GTS realtime] Dépôt #${deletedId} retiré`);
        },
      )
      .subscribe((status) => {
        console.log(`[GTS realtime] Status: ${status}`);
      });

    return () => { supabaseGts.removeChannel(channel); };
  }, []);

  // Charger la liste des dépôts faits via le launcher (présence d'extras)
  useEffect(() => {
    if (!isTauriShell()) return;
    invoke<number[]>("cmd_gts_list_extras_ids")
      .then((ids) => setLauncherDepositIds(new Set(ids.map(String))))
      .catch(() => {});
  }, [browseEntries.length]);

  // Charger les blobs pour les entrées browse visibles
  const loadBrowseBlob = useCallback(async (onlineId: string) => {
    if (onlineId in browseDepositByOnlineId) return;
    setBrowseDepositByOnlineId((prev) => ({ ...prev, [onlineId]: undefined }));
    const raw = await fetchGtsPokemonBlob(onlineId);
    const parsed = raw ? parseGtsDepositedPokemon(raw) : null;
    setBrowseDepositByOnlineId((prev) => ({ ...prev, [onlineId]: parsed }));
  }, [browseDepositByOnlineId]);

  /** Résout le nom/sprite d'une espèce à partir de son ID interne PSDK */
  const resolveBrowseSpecies = useCallback((psdkId: number): { name: string; imageUrl: string } => {
    // Priorité 1 : speciesByInternal (PSDK ID → DexRow via nom normalisé)
    const row = speciesByInternal.get(psdkId);
    if (row) return { name: row.name, imageUrl: row.imageUrl ?? "" };
    // Priorité 2 : psdkFrenchNames
    const psdkName = psdkFrenchNamesRef.current?.[psdkId];
    if (psdkName) return { name: psdkName, imageUrl: "" };
    return { name: `#${psdkId}`, imageUrl: "" };
  }, [speciesByInternal, psdkFrenchNames]);

  // Filtrage browse côté client — utilise les filtres de la barre de recherche principale
  const filteredBrowseEntries = useMemo(() => {
    let filtered = browseEntries;
    // Filtrer par nom via la barre de recherche principale (pokemonQuery)
    // Retirer le suffixe " (#XXX)" ajouté automatiquement lors d'une sélection
    const cleanQuery = pokemonQuery.replace(/\s*\(#\d+\)\s*$/, "").trim();
    if (cleanQuery) {
      const q = normalizeName(cleanQuery);
      const digits = cleanQuery.replace(/\D/g, "");
      filtered = filtered.filter((e) => {
        const { name } = resolveBrowseSpecies(e.depositedSpecies);
        return normalizeName(name).includes(q) || (digits.length > 0 && String(e.depositedSpecies).includes(digits));
      });
    }
    // Filtrer par genre via le filtre principal
    if (gender > 0) {
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        if (!dep) return true;
        return dep.gender === gender;
      });
    }
    // Filtrer par niveau via les filtres principaux
    if (levelMin > 1 || levelMax < 100) {
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        if (!dep) return true;
        return dep.level >= levelMin && dep.level <= levelMax;
      });
    }
    // Filtrer shiny (ancien toggle + nouveau filtre)
    const effectiveShiny = filterShiny !== "any" ? filterShiny : (browseShinyOnly ? "yes" : "any");
    if (effectiveShiny === "yes") {
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        return dep?.isShiny === true || dep?.isAltShiny === true;
      });
    } else if (effectiveShiny === "no") {
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        return !dep?.isShiny && !dep?.isAltShiny;
      });
    }
    // Filtrer par nature
    if (filterNature !== null) {
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        if (!dep) return true;
        return dep.nature === filterNature;
      });
    }
    // Filtrer par IVs minimum
    if (Object.values(filterIvs).some((v) => v > 0)) {
      const ivMap: [string, string][] = [["hp","ivHp"],["atk","ivAtk"],["def","ivDfe"],["spd","ivSpd"],["spa","ivAts"],["spd2","ivDfs"]];
      filtered = filtered.filter((e) => {
        const dep = e.parsed ?? browseDepositByOnlineId[e.onlineId];
        if (!dep) return true;
        return ivMap.every(([fk, dk]) => {
          const min = (filterIvs as any)[fk] ?? 0;
          return min <= 0 || ((dep as any)[dk] ?? 0) >= min;
        });
      });
    }
    // Filtrer par Pokémon demandé en retour
    if (filterWantedQuery.trim()) {
      const wq = normalizeName(filterWantedQuery.trim());
      const wDigits = filterWantedQuery.trim().replace(/\D/g, "");
      filtered = filtered.filter((e) => {
        if (!e.wanted) return false;
        const { name } = resolveBrowseSpecies(e.wanted.species);
        return normalizeName(name).includes(wq) || (wDigits.length > 0 && String(e.wanted.species).includes(wDigits));
      });
    }
    // Tri par date de première découverte (plus récent = découvert plus tard)
    filtered = [...filtered].sort((a, b) => {
      const tA = a.firstSeenAt || 0;
      const tB = b.firstSeenAt || 0;
      return browseSortOrder === "newest" ? tB - tA : tA - tB;
    });
    return filtered;
  }, [browseEntries, pokemonQuery, gender, levelMin, levelMax, browseDepositByOnlineId, resolveBrowseSpecies, browseShinyOnly, browseSortOrder, filterNature, filterShiny, filterIvs, filterWantedQuery]);

  /** Liste Pokédex complète filtrée (pas de limite artificielle : tout le dex + recherche). */
  const dexRowsNoMega = useMemo(() => dexRows.filter((r) => !r.name.startsWith("Méga-") && !r.name.startsWith("Méga ")), [dexRows]);

  const filteredDexRows = useMemo(() => {
    const t = pokemonQuery.trim();
    if (!t) return dexRowsNoMega;
    const q = normalizeName(t);
    if (!q) return dexRowsNoMega;
    const digits = t.replace(/\D/g, "");
    return dexRowsNoMega.filter(
      (r) =>
        normalizeName(r.name).includes(q) ||
        (digits.length > 0 && String(r.id).includes(digits)),
    );
  }, [pokemonQuery, dexRowsNoMega]);

  // Filtered dex rows for wishlist autocomplete
  const wishFilteredDexRows = useMemo(() => {
    const t = wishSpeciesQuery.trim();
    if (!t) return dexRowsNoMega;
    const q = normalizeName(t);
    if (!q) return dexRowsNoMega;
    const digits = t.replace(/\D/g, "");
    return dexRowsNoMega.filter(
      (r) =>
        normalizeName(r.name).includes(q) ||
        (digits.length > 0 && String(r.id).includes(digits)),
    );
  }, [wishSpeciesQuery, dexRowsNoMega]);

  const pickWishPokemon = useCallback((row: DexRow) => {
    setWishSpeciesQuery(row.name);
    setWishSpeciesId(row.id);
    setWishSuggestOpen(false);
  }, []);

  // Close wishlist suggest on outside click
  useEffect(() => {
    if (!wishSuggestOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wishSuggestRef.current?.contains(e.target as Node)) return;
      setWishSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wishSuggestOpen]);

  const [depositByOnlineId, setDepositByOnlineId] = useState<
    Record<string, GtsDepositedParsed | null | undefined>
  >({});
  const depositFetchGen = useRef(0);

  /* ─── Extras launcher (critères bonus stockés sur disque) ─── */
  const [extrasByOnlineId, setExtrasByOnlineId] = useState<Record<string, GtsLauncherExtras | null>>({});

  useEffect(() => {
    if (!isTauriShell() || results.length === 0) return;
    for (const entry of results) {
      const id = entry.onlineId;
      if (id in extrasByOnlineId) continue;
      setExtrasByOnlineId((p) => ({ ...p, [id]: null }));
      invoke<string | null>("cmd_gts_read_extras", { onlineId: parseInt(id, 10) })
        .then((raw) => {
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as GtsLauncherExtras;
              setExtrasByOnlineId((p) => ({ ...p, [id]: parsed }));
            } catch {
              setExtrasByOnlineId((p) => ({ ...p, [id]: null }));
            }
          }
        })
        .catch(() => {});
    }
  }, [results]);

  /* ─── Mes dépôts (retrait) ─── */
  const [myDepositStatus, setMyDepositStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [myDeposit, setMyDeposit] = useState<GtsDepositedParsed | null>(null);
  const [myDepositOnlineId, setMyDepositOnlineId] = useState<string | null>(null);
  useEffect(() => { myDepositOnlineIdRef.current = myDepositOnlineId; }, [myDepositOnlineId]);
  const [myDepositWanted, setMyDepositWanted] = useState<{ species: number; levelMin: number; levelMax: number; gender: number } | null>(null);
  const [isDepositTraded, setIsDepositTraded] = useState(false);
  const [showTradedPopup, setShowTradedPopup] = useState(false);
  const [withdrawAction, setWithdrawAction] = useState<"idle" | "withdrawing" | "deleting" | "done" | "error">("idle");
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawBoxName, setWithdrawBoxName] = useState<string | null>(null);
  const [showWithdrawAnim, setShowWithdrawAnim] = useState(false);
  const [withdrawAnimInfo, setWithdrawAnimInfo] = useState<{
    spriteUrl: string | null; name: string; isShiny: boolean; isAltShiny: boolean; boxName: string | null;
  } | null>(null);

  /* ─── Échange GTS ─── */
  const [tradeTarget, setTradeTarget] = useState<TradeEntry | null>(null);
  const [tradeMode, setTradeMode] = useState(false);
  const [tradeStep, setTradeStep] = useState<"idle" | "selecting" | "confirm" | "trading" | "success" | "error">("idle");
  const [tradeError, setTradeError] = useState("");
  const [tradePoke, setTradePoke] = useState<import("../types").BoxPokemon | null>(null);
  const [tradeBoxIdx, setTradeBoxIdx] = useState(0);
  const [showTradeAnim, setShowTradeAnim] = useState(false);
  const [tradeAnimInfo, setTradeAnimInfo] = useState<{
    mySpriteUrl: string | null; myName: string; myShiny: boolean; myAltShiny: boolean;
    theirSpriteUrl: string | null; theirName: string; theirShiny: boolean; theirAltShiny: boolean;
    boxName: string | null;
  } | null>(null);

  /* ─── Modifier extras ─── */
  const [editingExtras, setEditingExtras] = useState(false);
  const [editShiny, setEditShiny] = useState<"any" | "yes" | "no">("any");
  const [editNature, setEditNature] = useState<number | null>(null);
  const [editIvs, setEditIvs] = useState({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 });
  const [myExtras, setMyExtras] = useState<GtsLauncherExtras | null>(null);

  const startEditExtras = useCallback(() => {
    setEditShiny(myExtras?.shiny ?? "any");
    setEditNature(myExtras?.nature ?? null);
    setEditIvs(myExtras?.ivs ?? { hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 });
    setEditingExtras(true);
  }, [myExtras]);

  const saveEditExtras = useCallback(async () => {
    if (!myDepositOnlineId) return;
    const onlineId = parseInt(myDepositOnlineId, 10);
    const hasExtras = editShiny !== "any" || editNature !== null || Object.values(editIvs).some(v => v > 0);
    if (hasExtras) {
      const extras: GtsLauncherExtras = {
        shiny: editShiny,
        nature: editNature,
        ivs: editIvs,
        depositedAt: myExtras?.depositedAt ?? Date.now(),
      };
      await invoke("cmd_gts_save_extras", {
        onlineId,
        jsonData: JSON.stringify(extras, null, 2),
      }).catch((e) => console.warn("[GTS] Impossible de sauvegarder les extras:", e));
      setMyExtras(extras);
      setExtrasByOnlineId(prev => ({ ...prev, [myDepositOnlineId]: extras }));
    } else {
      await invoke("cmd_gts_delete_extras", { onlineId }).catch(() => {});
      setMyExtras(null);
      setExtrasByOnlineId(prev => ({ ...prev, [myDepositOnlineId]: null }));
    }
    setEditingExtras(false);
  }, [myDepositOnlineId, editShiny, editNature, editIvs, myExtras]);

  const checkMyDeposit = useCallback(async () => {
    if (!isTauriShell() || !savePath) return;
    setMyDepositStatus("loading");
    try {
      const { getOnlineId, loadSaveForEdit } = await import("../saveWriter");
      const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
      if (!blob) { setMyDepositStatus("error"); return; }
      const raw = Uint8Array.from(atob(blob.bytes_b64), c => c.charCodeAt(0));
      const ctx = loadSaveForEdit(raw);
      const onlineId = getOnlineId(ctx.root);
      if (!onlineId || onlineId <= 0) { setMyDepositStatus("loaded"); setMyDeposit(null); return; }

      // Check if has uploaded
      const hasUp = await invoke<boolean>("cmd_gts_has_pokemon_uploaded", {
        gameId: GTS_GAME_ID,
        onlineId,
      });
      if (!hasUp) { setMyDepositStatus("loaded"); setMyDeposit(null); setMyDepositOnlineId(null); setIsDepositTraded(false); return; }

      // Check if deposit has been traded
      const taken = await invoke<boolean>("cmd_gts_is_taken", { gameId: GTS_GAME_ID, onlineId }).catch(() => false);
      setIsDepositTraded(taken);
      if (taken && !showTradedPopup) setShowTradedPopup(true);

      // Download the Pokémon blob
      const pokBlob = await fetchGtsPokemonBlob(String(onlineId));
      const parsed = pokBlob ? parseGtsDepositedPokemon(pokBlob) : null;
      setMyDeposit(parsed);
      setMyDepositOnlineId(String(onlineId));

      // Download wanted data
      try {
        if (isTauriShell()) {
          // Use a direct HTTP call via Tauri
          const wData = await invoke<string>("cmd_gts_download_wanted_data", {
            gameId: GTS_GAME_ID,
            onlineId,
          });
          if (wData?.trim()) {
            const p = wData.split(",").map(Number);
            setMyDepositWanted({ species: p[0], levelMin: p[1], levelMax: p[2], gender: p[3] < 0 ? 0 : p[3] });
          }
        } else {
          const wData = await proxyPost("downloadWantedData", { id: onlineId });
          if (wData?.trim()) {
            const p = wData.split(",").map(Number);
            setMyDepositWanted({ species: p[0], levelMin: p[1], levelMax: p[2], gender: p[3] < 0 ? 0 : p[3] });
          }
        }
      } catch { /* ignore wanted data failure */ }

      // Charger les extras launcher
      try {
        const extrasRaw = await invoke<string | null>("cmd_gts_read_extras", { onlineId });
        if (extrasRaw) {
          setMyExtras(JSON.parse(extrasRaw) as GtsLauncherExtras);
        } else {
          setMyExtras(null);
        }
      } catch { setMyExtras(null); }

      setMyDepositStatus("loaded");
    } catch (e) {
      console.error("[GTS] Check my deposit error:", e);
      setMyDepositStatus("error");
    }
  }, [savePath]);

  useEffect(() => {
    if (savePath && !showPCBox) checkMyDeposit();
  }, [savePath, showPCBox]);

  // Auto-refresh toutes les 30s quand un dépôt est actif (pour détecter les échanges)
  useEffect(() => {
    if (!myDepositOnlineId || !savePath || showPCBox || tradeMode) return;
    const interval = setInterval(() => {
      checkMyDeposit();
    }, 30_000);
    return () => clearInterval(interval);
  }, [myDepositOnlineId, savePath, showPCBox, tradeMode, checkMyDeposit]);

  const withdrawMyDeposit = useCallback(async (remove: boolean) => {
    if (!myDepositOnlineId) return;
    setWithdrawAction(remove ? "deleting" : "withdrawing");
    setWithdrawError("");
    setWithdrawBoxName(null);
    const onlineId = parseInt(myDepositOnlineId, 10);

    try {
      if (remove) {
        // Suppression simple — pas de réécriture save
        const ok = await invoke<boolean>("cmd_gts_delete_pokemon", {
          gameId: GTS_GAME_ID, onlineId, withdraw: false,
        });
        if (!ok) { setWithdrawError("Le serveur n'a pas pu traiter la demande."); setWithdrawAction("error"); return; }
        await invoke("cmd_gts_delete_extras", { onlineId }).catch(() => {});
        setWithdrawAction("done");
        setMyDeposit(null);
        setMyDepositOnlineId(null);
        setTimeout(() => { setWithdrawAction("idle"); checkMyDeposit(); }, 1500);
        return;
      }

      // ─── Retrait avec réécriture dans la save ───

      // 1. Vérifier que le jeu n'est pas lancé
      const running = await invoke<boolean>("cmd_is_game_running");
      if (running) {
        setWithdrawError("Le jeu est en cours d'exécution ! Fermez-le avant de retirer.");
        setWithdrawAction("error");
        return;
      }

      // 2. Déterminer si c'est un retrait simple ou une récupération après échange
      const traded = isDepositTraded || await invoke<boolean>("cmd_gts_is_taken", { gameId: GTS_GAME_ID, onlineId }).catch(() => false);

      let selfContainedBytes: Uint8Array;
      let withdrawEvolvedTo: number | null = null;
      let withdrawEvolvedForm: number | null = null;

      if (traded) {
        // ─── Récupération après échange : télécharger le NOUVEAU Pokémon du serveur ───
        console.info("[GTS Withdraw] Dépôt échangé — téléchargement du Pokémon reçu...");
        const gtsBlob = await fetchGtsPokemonBlob(String(onlineId));
        if (!gtsBlob) {
          setWithdrawError("Impossible de télécharger le Pokémon reçu.");
          setWithdrawAction("error");
          return;
        }
        // Décoder le blob GTS → bytes self-contained (strip header 0x04 0x08)
        const { unzlibSync } = await import("fflate");
        const compressed = Uint8Array.from(atob(gtsBlob), (c) => c.charCodeAt(0));
        const marshalBytes = unzlibSync(compressed);
        selfContainedBytes = (marshalBytes.length >= 2 && marshalBytes[0] === 0x04 && marshalBytes[1] === 0x08)
          ? marshalBytes.slice(2)
          : marshalBytes;
        console.info(`[GTS Withdraw] Blob reçu décodé: ${selfContainedBytes.length} bytes`);

        // Vérifier l'évolution par échange du Pokémon reçu
        try {
          const { load: marshalLoad, dump: marshalDump } = await import("@hyrious/marshal");
          const { loadTradeEvolutions, checkTradeEvolution } = await import("../tradeP2P");
          const fullBytes = new Uint8Array(selfContainedBytes.length + 2);
          fullBytes[0] = 0x04; fullBytes[1] = 0x08;
          fullBytes.set(selfContainedBytes, 2);
          const pokeObj = marshalLoad(fullBytes);
          if (pokeObj && typeof pokeObj === "object") {
            // Extraire speciesId, form, itemHolding du Pokemon recu
            let recvSpeciesId = 0, recvForm = 0, recvItemHolding = 0;
            for (const k of Reflect.ownKeys(pokeObj as object)) {
              const name = typeof k === "symbol" ? String(k).slice(7, -1) : String(k);
              if (name === "@id") recvSpeciesId = (pokeObj as any)[k] ?? 0;
              else if (name === "@form") recvForm = (pokeObj as any)[k] ?? 0;
              else if (name === "@item_holding") recvItemHolding = (pokeObj as any)[k] ?? 0;
            }
            if (recvSpeciesId > 0) {
              const evolutions = await loadTradeEvolutions();
              // myDeposit contient notre Pokemon original (celui qu'on a envoye)
              const mySpeciesId = myDeposit?.speciesInternalId;
              const evoResult = checkTradeEvolution(recvSpeciesId, recvForm, recvItemHolding, evolutions, mySpeciesId);
              if (evoResult) {
                withdrawEvolvedTo = evoResult.to;
                withdrawEvolvedForm = evoResult.form;
                console.info(`[GTS Withdraw] Évolution: ${recvSpeciesId} → ${evoResult.to} (forme ${evoResult.form})`);
                for (const k of Reflect.ownKeys(pokeObj as object)) {
                  const name = typeof k === "symbol" ? String(k).slice(7, -1) : String(k);
                  if (name === "@id") (pokeObj as any)[k] = evoResult.to;
                  else if (name === "@form") (pokeObj as any)[k] = evoResult.form;
                  else if (name === "@item_holding" && evoResult.consumeItem) (pokeObj as any)[k] = 0;
                }
                const evolved = marshalDump(pokeObj);
                selfContainedBytes = evolved.slice(2);
              }
            }
          }
        } catch (e) {
          console.warn("[GTS Withdraw] Évolution échouée, insertion sans évolution:", e);
        }
      } else {
        // ─── Retrait simple : utiliser les bytes sauvegardés ───
        const extrasRaw = await invoke<string | null>("cmd_gts_read_extras", { onlineId });
        let rawSlotB64: string | null = null;
        if (extrasRaw) {
          try {
            const parsed = JSON.parse(extrasRaw);
            rawSlotB64 = parsed.rawSlotB64 ?? null;
          } catch { /* ignore parse error */ }
        }
        if (!rawSlotB64) {
          const ok = await invoke<boolean>("cmd_gts_delete_pokemon", {
            gameId: GTS_GAME_ID, onlineId, withdraw: true,
          });
          if (!ok) { setWithdrawError("Le serveur n'a pas pu traiter la demande."); setWithdrawAction("error"); return; }
          await invoke("cmd_gts_delete_extras", { onlineId }).catch(() => {});
          setWithdrawError("Pokémon retiré du serveur, mais pas réinséré dans la save (dépôt ancien). Ouvrez le GTS en jeu pour le récupérer.");
          setWithdrawAction("error");
          setMyDeposit(null);
          setMyDepositOnlineId(null);
          return;
        }
        selfContainedBytes = Uint8Array.from(atob(rawSlotB64), (c) => c.charCodeAt(0));
      }

      // 3. Charger la save
      if (!savePath) { setWithdrawError("Chemin de sauvegarde introuvable."); setWithdrawAction("error"); return; }
      const saveBlob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
      if (!saveBlob) { setWithdrawError("Impossible de charger la sauvegarde."); setWithdrawAction("error"); return; }
      const raw = Uint8Array.from(atob(saveBlob.bytes_b64), (c) => c.charCodeAt(0));

      const { loadSaveForEdit, findFirstEmptySlot, insertPokemonIntoSave, bytesToBase64 } = await import("../saveWriter");
      const ctx = loadSaveForEdit(raw);

      // 4. Trouver le premier slot vide
      const emptySlot = findFirstEmptySlot(ctx.rawBytes, ctx.marshalOffset);
      if (!emptySlot) {
        setWithdrawError("Toutes vos boîtes PC sont pleines ! Libérez un emplacement.");
        setWithdrawAction("error");
        return;
      }

      // 5. Insérer dans la save (tree approach)
      const patched = insertPokemonIntoSave(ctx.rawBytes, ctx.marshalOffset, emptySlot.boxIndex, emptySlot.slotIndex, selfContainedBytes);

      // 6. Écrire la save (backup auto côté Rust)
      await invoke("cmd_write_save_blob", { savePath, bytesB64: bytesToBase64(patched) });

      // 7. Supprimer du serveur — withdraw=false si traded, true sinon (comme le jeu)
      await invoke<boolean>("cmd_gts_delete_pokemon", {
        gameId: GTS_GAME_ID, onlineId, withdraw: !traded,
      });

      // 8. Enregistrer dans l'historique si c'était un échange
      const boxName = profile?.boxes?.[emptySlot.boxIndex]?.name ?? `Boîte ${emptySlot.boxIndex + 1}`;
      if (traded && myDeposit) {
        // Lire les extras pour connaître le Pokémon original envoyé
        const extrasRaw2 = await invoke<string | null>("cmd_gts_read_extras", { onlineId }).catch(() => null);
        let originalDepositInfo: any = null;
        if (extrasRaw2) {
          try { originalDepositInfo = JSON.parse(extrasRaw2); } catch {}
        }
        // Le Pokémon reçu = myDeposit (c'est le blob actuel sur le serveur, post-trade)
        const recvRow = speciesByInternal.get(myDeposit.speciesInternalId);
        const recvName = recvRow?.name ?? (psdkFrenchNamesRef.current?.[myDeposit.speciesInternalId] ?? `#${myDeposit.speciesInternalId}`);
        const recvImgUrl = recvRow?.imageUrl ? fullImageUrl(recvRow.imageUrl) : null;
        const recvIvTotal = (myDeposit.ivHp ?? 0) + (myDeposit.ivAtk ?? 0) + (myDeposit.ivDfe ?? 0)
          + (myDeposit.ivSpd ?? 0) + (myDeposit.ivAts ?? 0) + (myDeposit.ivDfs ?? 0);

        // Le Pokémon envoyé = ce qui était dans les extras (info du dépôt original)
        const sentSpecies = originalDepositInfo?.originalSpecies ?? 0;
        const sentRow = sentSpecies ? speciesByInternal.get(sentSpecies) : null;
        const sentName = originalDepositInfo?.originalName ?? sentRow?.name ?? "?";
        const sentImgUrl = sentRow?.imageUrl ? fullImageUrl(sentRow.imageUrl) : null;

        invoke("cmd_gts_append_history", {
          jsonEntry: JSON.stringify({
            date: new Date().toISOString(),
            type: "deposit_traded",
            sent: {
              name: sentName,
              species: sentSpecies,
              level: originalDepositInfo?.originalLevel ?? 0,
              shiny: originalDepositInfo?.originalShiny ?? false,
              altShiny: originalDepositInfo?.originalAltShiny ?? false,
              spriteUrl: sentImgUrl,
            },
            received: {
              name: recvName,
              species: myDeposit.speciesInternalId,
              level: myDeposit.level ?? 0,
              shiny: myDeposit.isShiny ?? false,
              altShiny: myDeposit.isAltShiny ?? false,
              gender: myDeposit.gender,
              nature: myDeposit.nature,
              ivTotal: recvIvTotal,
              spriteUrl: recvImgUrl,
              trainerName: myDeposit.trainerName ?? null,
            },
            boxName,
          }),
        }).catch((e) => console.warn("[GTS] Erreur sauvegarde historique:", e));
      }

      // 9. Supprimer les extras
      await invoke("cmd_gts_delete_extras", { onlineId }).catch(() => {});

      // 10. Lancer l'animation de retrait (avec sprite évolué si applicable)
      const withdrawDisplaySpecies = withdrawEvolvedTo ?? myDeposit?.speciesInternalId ?? 0;
      const depRow = speciesByInternal.get(withdrawDisplaySpecies);
      const depImgUrl = depRow?.imageUrl;
      let normalSprUrl = depImgUrl
        ? (depImgUrl.startsWith("http") ? depImgUrl : `${base}${depImgUrl.startsWith("/") ? "" : "/"}${depImgUrl}`)
        : null;
      // Si évolution, essayer de charger le sprite via Tauri
      if (withdrawEvolvedTo && !normalSprUrl) {
        try {
          const formArg = (withdrawEvolvedForm ?? 0) > 0 ? withdrawEvolvedForm : null;
          const spr = await invoke<string | null>("cmd_get_normal_sprite", { speciesId: withdrawEvolvedTo, form: formArg });
          if (spr) normalSprUrl = spr;
        } catch {}
      }
      // Utiliser le sprite alt shiny / shiny si applicable
      const shinyKey = `${withdrawDisplaySpecies}_${withdrawEvolvedForm ?? myDeposit?.form ?? 0}`;
      const altShinySprUrl = myDeposit?.isAltShiny ? altShinySpriteCache[shinyKey] : null;
      const shinySprUrl = myDeposit?.isShiny ? shinySpriteCache[shinyKey] : null;
      const sprUrl = altShinySprUrl || shinySprUrl || normalSprUrl;
      const pokeName = withdrawEvolvedTo
        ? (psdkFrenchNamesRef.current?.[withdrawEvolvedTo] ?? depRow?.name ?? "Pokémon")
        : (depRow?.name ?? (myDeposit?.nickname || "Pokémon"));
      setWithdrawAnimInfo({
        spriteUrl: sprUrl,
        name: withdrawEvolvedTo ? pokeName : (myDeposit?.nickname || pokeName),
        isShiny: myDeposit?.isShiny ?? false,
        isAltShiny: myDeposit?.isAltShiny ?? false,
        boxName,
      });
      setShowWithdrawAnim(true);
      setWithdrawBoxName(boxName);
      setWithdrawAction("done");
      setIsDepositTraded(false);
      setMyDeposit(null);
      setMyDepositOnlineId(null);
      onProfileReload?.();
    } catch (e: any) {
      setWithdrawError(String(e?.message || e));
      setWithdrawAction("error");
    }
  }, [myDepositOnlineId, checkMyDeposit, savePath, profile, onProfileReload, myDeposit, speciesByInternal, base, isDepositTraded, psdkFrenchNames]);

  /* ─── Échange : sélection et exécution ─── */

  const handleTradeSelect = useCallback((poke: import("../types").BoxPokemon, boxIdx: number) => {
    setTradePoke(poke);
    setTradeBoxIdx(boxIdx);
    setTradeStep("confirm");
  }, []);

  const cancelTrade = useCallback(() => {
    setTradeTarget(null);
    setTradeMode(false);
    setTradeStep("idle");
    setTradePoke(null);
    setTradeError("");
  }, []);

  const openHistory = useCallback(async () => {
    try {
      const raw = await invoke<string>("cmd_gts_read_history");
      const entries = JSON.parse(raw);
      setTradeHistory(Array.isArray(entries) ? entries.reverse() : []);
    } catch {
      setTradeHistory([]);
    }
    setHistoryPage(0);
    setShowHistory(true);
  }, []);

  const executeTrade = useCallback(async () => {
    if (!tradeTarget || !tradePoke || !savePath) return;
    setTradeStep("trading");
    setTradeError("");
    const targetOnlineId = parseInt(tradeTarget.onlineId, 10);
    try {
      // 1. Vérifier que le jeu n'est pas lancé
      const running = await invoke<boolean>("cmd_is_game_running");
      if (running) { setTradeError("Le jeu est en cours d'exécution ! Fermez-le avant d'échanger."); setTradeStep("error"); return; }

      // 2. Charger la save
      const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
      if (!blob) { setTradeError("Impossible de charger la sauvegarde."); setTradeStep("error"); return; }
      const rawBytes = Uint8Array.from(atob(blob.bytes_b64), c => c.charCodeAt(0));

      const {
        loadSaveForEdit, extractPokemonFromBox, encodePokemonForGts,
        patchSlotToNil, findFirstEmptySlot, insertPokemonIntoSave,
        decodePokemonFromGts, bytesToBase64, getOnlineId,
      } = await import("../saveWriter");
      const ctx = loadSaveForEdit(rawBytes);

      // 3. Extraire et encoder notre Pokémon
      const myPokemon = extractPokemonFromBox(ctx.root, tradeBoxIdx, tradePoke.slot);
      const myPokemonB64 = encodePokemonForGts(myPokemon);

      // 4. Télécharger le Pokémon reçu AVANT d'uploader le nôtre
      // (sinon uploadNewPokemon remplace le blob et on re-télécharge notre propre Pokémon)
      const theirBlob = await fetchGtsPokemonBlob(tradeTarget.onlineId);
      console.info(`[GTS Trade] Blob téléchargé AVANT upload: ${theirBlob ? theirBlob.length + " chars" : "null"}`);
      if (!theirBlob) {
        setTradeError("Impossible de télécharger le Pokémon depuis le serveur.");
        setTradeStep("error");
        return;
      }

      // 5. Verrouiller le dépôt sur le serveur
      const taken = await invoke<boolean>("cmd_gts_take_pokemon", {
        gameId: GTS_GAME_ID, onlineId: targetOnlineId,
      });
      if (!taken) {
        setTradeError("Ce Pokémon a déjà été échangé par un autre joueur.");
        setTradeStep("error");
        return;
      }

      // 6. Envoyer notre Pokémon au serveur
      const uploaded = await invoke<boolean>("cmd_gts_upload_new_pokemon", {
        gameId: GTS_GAME_ID, onlineId: targetOnlineId, pokemonB64: myPokemonB64,
      });
      if (!uploaded) {
        setTradeError("Erreur lors de l'envoi de votre Pokémon au serveur. Le dépôt est verrouillé — contactez le support.");
        setTradeStep("error");
        return;
      }

      // 7. Retirer notre Pokémon de la save
      console.info(`[GTS Trade] Patching slot [${tradeBoxIdx}][${tradePoke.slot}] to nil...`);
      const patchedAfterRemove = patchSlotToNil(ctx.rawBytes, ctx.marshalOffset, tradeBoxIdx, tradePoke.slot);
      console.info(`[GTS Trade] Save patched: ${ctx.rawBytes.length} → ${patchedAfterRemove.length} bytes`);

      {
        // 8. Décoder et insérer le blob téléchargé à l'étape 4
        let theirBytes = decodePokemonFromGts(theirBlob);
        console.info(`[GTS Trade] Blob décodé: ${theirBytes.length} bytes self-contained`);

        // 8b. Vérifier l'évolution par échange
        const dep = depositByOnlineId[tradeTarget.onlineId];
        let gtsEvolvedTo: number | null = null;
        let gtsEvolvedForm: number | null = null;
        if (dep && dep.speciesInternalId > 0) {
          try {
            const { loadTradeEvolutions, checkTradeEvolution } = await import("../tradeP2P");
            const evolutions = await loadTradeEvolutions();
            const mySpeciesId = typeof tradePoke.code === "number" ? tradePoke.code : parseInt(String(tradePoke.code), 10);
            const evoResult = checkTradeEvolution(dep.speciesInternalId, dep.form, dep.itemHolding, evolutions, mySpeciesId);
            if (evoResult) {
              gtsEvolvedTo = evoResult.to;
              gtsEvolvedForm = evoResult.form;
              console.info(`[GTS Trade] Évolution détectée: ${dep.speciesInternalId} → ${evoResult.to} (forme ${evoResult.form}, consumeItem=${evoResult.consumeItem})`);
              const { load: marshalLoad, dump: marshalDump } = await import("@hyrious/marshal");
              const fullBytes = new Uint8Array(theirBytes.length + 2);
              fullBytes[0] = 0x04; fullBytes[1] = 0x08;
              fullBytes.set(theirBytes, 2);
              const pokeObj = marshalLoad(fullBytes);
              if (pokeObj && typeof pokeObj === "object") {
                for (const k of Reflect.ownKeys(pokeObj as object)) {
                  const name = typeof k === "symbol" ? String(k).slice(7, -1) : String(k);
                  if (name === "@id") (pokeObj as any)[k] = evoResult.to;
                  else if (name === "@form") (pokeObj as any)[k] = evoResult.form;
                  else if (name === "@item_holding" && evoResult.consumeItem) (pokeObj as any)[k] = 0;
                }
                const evolved = marshalDump(pokeObj);
                theirBytes = evolved.slice(2);
              }
            }
          } catch (e) {
            console.warn("[GTS Trade] Évolution échouée, insertion sans évolution:", e);
          }
        }

        const ctx2 = loadSaveForEdit(patchedAfterRemove);
        const emptySlot = findFirstEmptySlot(ctx2.rawBytes, ctx2.marshalOffset);
        console.info(`[GTS Trade] Slot vide trouvé:`, emptySlot);

        if (emptySlot) {
          const finalBytes = insertPokemonIntoSave(
            ctx2.rawBytes, ctx2.marshalOffset,
            emptySlot.boxIndex, emptySlot.slotIndex, theirBytes,
          );
          console.info(`[GTS Trade] Save finale: ${finalBytes.length} bytes. Écriture...`);
          await invoke("cmd_write_save_blob", { savePath, bytesB64: bytesToBase64(finalBytes) });
          console.info(`[GTS Trade] Save écrite avec succès !`);

          // Préparer les infos d'animation (utiliser l'espèce évoluée si applicable)
          const dep = depositByOnlineId[tradeTarget.onlineId];
          const theirDisplaySpecies = gtsEvolvedTo ?? dep?.speciesInternalId ?? 0;
          const theirDisplayForm = gtsEvolvedForm ?? dep?.form ?? 0;
          const theirIsShiny = dep?.isShiny ?? false;
          const theirIsAltShiny = dep?.isAltShiny ?? false;

          // Charger le sprite (shiny si applicable) via Tauri
          let theirSprUrl: string | null = null;
          try {
            const formArg = theirDisplayForm > 0 ? theirDisplayForm : null;
            if (theirIsAltShiny) {
              theirSprUrl = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId: theirDisplaySpecies, form: formArg });
            }
            if (!theirSprUrl && theirIsShiny) {
              theirSprUrl = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId: theirDisplaySpecies, form: formArg });
            }
            if (!theirSprUrl) {
              theirSprUrl = await invoke<string | null>("cmd_get_normal_sprite", { speciesId: theirDisplaySpecies, form: formArg });
            }
          } catch {}
          // Fallback vers l'image web
          if (!theirSprUrl) {
            const depRow = speciesByInternal.get(theirDisplaySpecies);
            const depImg = depRow?.imageUrl;
            if (depImg) {
              theirSprUrl = depImg.startsWith("http") ? depImg : `${base}${depImg.startsWith("/") ? "" : "/"}${depImg}`;
            }
          }
          const depRowForName = speciesByInternal.get(theirDisplaySpecies);
          const theirPokeName = gtsEvolvedTo
            ? (psdkFrenchNamesRef.current?.[gtsEvolvedTo] ?? depRowForName?.name ?? resolveSpeciesName(theirDisplaySpecies, null))
            : (dep ? resolveSpeciesName(dep.speciesInternalId, dep.nickname) : "Pokémon");
          const boxName = profile?.boxes?.[emptySlot.boxIndex]?.name ?? `Boîte ${emptySlot.boxIndex + 1}`;

          // Sprite + nom de notre Pokémon (avec shiny si applicable)
          const mySpeciesId = typeof tradePoke.code === "string" ? parseInt(tradePoke.code, 10) : (tradePoke.code ?? 0);
          const myFormNum = typeof tradePoke.form === "number" ? tradePoke.form : 0;
          let mySprUrl: string | null = null;
          try {
            const myFormArg = myFormNum > 0 ? myFormNum : null;
            if (tradePoke.isAltShiny) {
              mySprUrl = await invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId: mySpeciesId, form: myFormArg });
            }
            if (!mySprUrl && tradePoke.isShiny) {
              mySprUrl = await invoke<string | null>("cmd_get_shiny_sprite", { speciesId: mySpeciesId, form: myFormArg });
            }
            if (!mySprUrl) {
              mySprUrl = await invoke<string | null>("cmd_get_normal_sprite", { speciesId: mySpeciesId, form: myFormArg });
            }
          } catch {}
          if (!mySprUrl) {
            const myRow = speciesByInternal.get(mySpeciesId);
            const myImg = myRow?.imageUrl;
            if (myImg) {
              mySprUrl = myImg.startsWith("http") ? myImg : `${base}${myImg.startsWith("/") ? "" : "/"}${myImg}`;
            }
          }
          const myPokeName = resolveSpeciesName(mySpeciesId, tradePoke.nickname);

          setTradeAnimInfo({
            mySpriteUrl: mySprUrl,
            myName: tradePoke.nickname || myPokeName,
            myShiny: tradePoke.isShiny ?? false,
            myAltShiny: tradePoke.isAltShiny ?? false,
            theirSpriteUrl: theirSprUrl,
            theirName: theirPokeName,
            theirShiny: dep?.isShiny ?? false,
            theirAltShiny: dep?.isAltShiny ?? false,
            boxName,
          });
          setShowTradeAnim(true);
          setTradeStep("success");

          // Sauvegarder dans l'historique des échanges
          const sentIvTotal = (tradePoke.ivHp ?? 0) + (tradePoke.ivAtk ?? 0) + (tradePoke.ivDfe ?? 0)
            + (tradePoke.ivSpd ?? 0) + (tradePoke.ivAts ?? 0) + (tradePoke.ivDfs ?? 0);
          const recvIvTotal = dep
            ? (dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0)
            : 0;
          // Résoudre les sprites shiny pour l'historique
          const myShinyHistKey = `${mySpeciesId}_${tradePoke.form ?? 0}`;
          const myShinySpr = (tradePoke.isShiny && shinySpriteCache[myShinyHistKey]) ? shinySpriteCache[myShinyHistKey] : null;
          const theirSpecId = gtsEvolvedTo ?? dep?.speciesInternalId ?? 0;
          const theirShinyHistKey = `${theirSpecId}_${gtsEvolvedForm ?? dep?.form ?? 0}`;
          const theirShinySpr = (dep?.isShiny && shinySpriteCache[theirShinyHistKey]) ? shinySpriteCache[theirShinyHistKey] : null;

          invoke("cmd_gts_append_history", {
            jsonEntry: JSON.stringify({
              date: new Date().toISOString(),
              sent: {
                name: tradePoke.nickname || myPokeName,
                species: mySpeciesId,
                form: tradePoke.form ?? 0,
                level: tradePoke.level ?? 0,
                shiny: tradePoke.isShiny ?? false,
                altShiny: tradePoke.isAltShiny ?? false,
                gender: tradePoke.gender,
                nature: tradePoke.nature,
                ivTotal: sentIvTotal,
                spriteUrl: myShinySpr || mySprUrl,
                shinySpriteUrl: myShinySpr,
                trainerName: tradePoke.trainerName ?? null,
              },
              received: {
                name: theirPokeName,
                species: gtsEvolvedTo ?? dep?.speciesInternalId ?? 0,
                form: gtsEvolvedForm ?? dep?.form ?? 0,
                level: dep?.level ?? 0,
                shiny: dep?.isShiny ?? false,
                altShiny: dep?.isAltShiny ?? false,
                gender: dep?.gender,
                nature: dep?.nature,
                ivTotal: recvIvTotal,
                spriteUrl: theirShinySpr || theirSprUrl,
                shinySpriteUrl: theirShinySpr,
                trainerName: dep?.trainerName ?? null,
              },
              otherTrainerId: tradeTarget.onlineId,
              boxName,
            }),
          }).catch((e) => console.warn("[GTS] Erreur sauvegarde historique:", e));

          // Recharger le profil après un court délai pour laisser le write se terminer
          setTimeout(() => onProfileReload?.(), 500);
        } else {
          // Pas de slot vide — écrire quand même la save sans le reçu
          await invoke("cmd_write_save_blob", { savePath, bytesB64: bytesToBase64(patchedAfterRemove) });
          setTradeError("Échange effectué, mais vos boîtes sont pleines. Ouvrez le GTS en jeu pour récupérer le Pokémon.");
          setTradeStep("error");
          setTimeout(() => onProfileReload?.(), 500);
        }
      }
    } catch (e: any) {
      setTradeError(String(e?.message || e));
      setTradeStep("error");
    }
  }, [tradeTarget, tradePoke, tradeBoxIdx, savePath, depositByOnlineId, speciesByInternal, base, profile, onProfileReload, cancelTrade]);

  useEffect(() => {
    if (results.length === 0) {
      setDepositByOnlineId({});
      return;
    }
    const gen = ++depositFetchGen.current;
    const ids = results.map((r) => r.onlineId);
    setDepositByOnlineId((prev) => {
      const next: Record<string, GtsDepositedParsed | null | undefined> = { ...prev };
      for (const id of ids) next[id] = undefined;
      return next;
    });
    void (async () => {
      await Promise.all(
        ids.map(async (id) => {
          const raw = await fetchGtsPokemonBlob(id);
          if (gen !== depositFetchGen.current) return;
          const parsed = raw ? parseGtsDepositedPokemon(raw) : null;
          if (import.meta.env.DEV && parsed) {
            console.debug(`[GTS] Pokémon déposé #${id} — chromatique détecté: ${parsed.isShiny}`, parsed);
          }
          setDepositByOnlineId((prev) => ({ ...prev, [id]: parsed }));
        }),
      );
    })();
  }, [results]);

  /* ---- Cache sprites normaux (VD local) pour Pokémon non trouvés dans l'API Pokédex ---- */
  const [normalSpriteCache, setNormalSpriteCache] = useState<Record<string, string | null>>({});

  /* ---- Cache sprites shiny (extraits du VD local, mis en cache sur disque) ---- */
  const [shinySpriteCache, setShinySpriteCache] = useState<Record<string, string | null>>({});

  /* ---- Cache sprites alt shiny (loose files graphics/pokedex/pokefrontshiny/{id}a.png) ---- */
  const [altShinySpriteCache, setAltShinySpriteCache] = useState<Record<string, string | null>>({});

  useEffect(() => {
    // Pour chaque Pokémon déposé qui est shiny, charger son sprite shiny
    const toFetch: { key: string; speciesId: number; form: number }[] = [];
    for (const dep of Object.values(depositByOnlineId)) {
      if (!dep || !dep.isShiny) continue;
      const key = `${dep.speciesInternalId}_${dep.form}`;
      if (key in shinySpriteCache) continue;
      toFetch.push({ key, speciesId: dep.speciesInternalId, form: dep.form });
    }
    // Aussi charger le sprite shiny de myDeposit (pour le popup traded)
    if (myDeposit?.isShiny) {
      const key = `${myDeposit.speciesInternalId}_${myDeposit.form}`;
      if (!(key in shinySpriteCache)) {
        toFetch.push({ key, speciesId: myDeposit.speciesInternalId, form: myDeposit.form });
      }
    }
    // Charger le sprite shiny du Pokémon sélectionné pour l'échange
    if (tradePoke?.isShiny) {
      const specId = typeof tradePoke.code === "string" ? parseInt(tradePoke.code, 10) : (tradePoke.code ?? 0);
      const form = typeof tradePoke.form === "string" ? parseInt(tradePoke.form, 10) : (tradePoke.form ?? 0);
      const key = `${specId}_${form}`;
      if (!(key in shinySpriteCache)) {
        toFetch.push({ key, speciesId: specId, form });
      }
    }
    // Charger les sprites shiny pour l'historique
    if (showHistory) {
      for (const entry of tradeHistory) {
        for (const p of [entry.sent, entry.received]) {
          if (p?.shiny && p?.species) {
            const key = `${p.species}_${p.form ?? 0}`;
            if (!(key in shinySpriteCache)) {
              toFetch.push({ key, speciesId: p.species, form: p.form ?? 0 });
            }
          }
        }
      }
    }
    // Charger les sprites shiny pour les dépôts browse
    for (const dep of Object.values(browseDepositByOnlineId)) {
      if (!dep || !dep.isShiny) continue;
      const key = `${dep.speciesInternalId}_${dep.form}`;
      if (key in shinySpriteCache) continue;
      toFetch.push({ key, speciesId: dep.speciesInternalId, form: dep.form });
    }
    if (toFetch.length === 0) return;

    // Marquer comme "en cours" pour éviter les doublons
    setShinySpriteCache((prev) => {
      const next = { ...prev };
      for (const { key } of toFetch) next[key] = null;
      return next;
    });

    for (const { key, speciesId, form } of toFetch) {
      invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: form > 0 ? form : null })
        .then((dataUrl) => {
          setShinySpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch(() => {
          setShinySpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
  }, [depositByOnlineId, shinySpriteCache, myDeposit, tradePoke, showHistory, tradeHistory, browseDepositByOnlineId]);

  /* ---- Prefetch alt shiny sprites ---- */
  useEffect(() => {
    const toFetch: { key: string; speciesId: number; form: number }[] = [];
    for (const dep of Object.values(depositByOnlineId)) {
      if (!dep || !dep.isAltShiny) continue;
      const key = `${dep.speciesInternalId}_${dep.form}`;
      if (key in altShinySpriteCache) continue;
      toFetch.push({ key, speciesId: dep.speciesInternalId, form: dep.form });
    }
    if (myDeposit?.isAltShiny) {
      const key = `${myDeposit.speciesInternalId}_${myDeposit.form}`;
      if (!(key in altShinySpriteCache)) {
        toFetch.push({ key, speciesId: myDeposit.speciesInternalId, form: myDeposit.form });
      }
    }
    if (tradePoke?.isAltShiny) {
      const specId = typeof tradePoke.code === "string" ? parseInt(tradePoke.code, 10) : (tradePoke.code ?? 0);
      const form = typeof tradePoke.form === "string" ? parseInt(tradePoke.form, 10) : (tradePoke.form ?? 0);
      const key = `${specId}_${form}`;
      if (!(key in altShinySpriteCache)) {
        toFetch.push({ key, speciesId: specId, form });
      }
    }
    // Charger les sprites alt shiny pour les dépôts browse
    for (const dep of Object.values(browseDepositByOnlineId)) {
      if (!dep || !dep.isAltShiny) continue;
      const key = `${dep.speciesInternalId}_${dep.form}`;
      if (key in altShinySpriteCache) continue;
      toFetch.push({ key, speciesId: dep.speciesInternalId, form: dep.form });
    }
    if (toFetch.length === 0) return;
    setAltShinySpriteCache((prev) => {
      const next = { ...prev };
      for (const { key } of toFetch) next[key] = null;
      return next;
    });
    for (const { key, speciesId, form } of toFetch) {
      invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: form > 0 ? form : null })
        .then((dataUrl) => {
          setAltShinySpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch(() => {
          setAltShinySpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
  }, [depositByOnlineId, altShinySpriteCache, myDeposit, tradePoke, browseDepositByOnlineId]);

  /* ---- Charger sprites normaux (VD) pour les Pokémon demandés non trouvés dans l'API ---- */
  useEffect(() => {
    if (!isTauriShell()) return;
    const toFetch: { key: string; speciesId: number }[] = [];
    for (const entry of results) {
      if (!entry.wanted) continue;
      const sid = entry.wanted.species;
      // Si on a déjà le sprite via l'API Pokédex, pas besoin du VD
      if (speciesByInternal.has(sid)) continue;
      const key = `normal_${sid}`;
      if (key in normalSpriteCache) continue;
      toFetch.push({ key, speciesId: sid });
    }
    if (toFetch.length === 0) return;

    setNormalSpriteCache((prev) => {
      const next = { ...prev };
      for (const { key } of toFetch) next[key] = null;
      return next;
    });

    for (const { key, speciesId } of toFetch) {
      invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: null })
        .then((dataUrl) => {
          setNormalSpriteCache((prev) => ({ ...prev, [key]: dataUrl ?? null }));
        })
        .catch(() => {
          setNormalSpriteCache((prev) => ({ ...prev, [key]: null }));
        });
    }
  }, [results, speciesByInternal, normalSpriteCache]);

  useEffect(() => {
    if (!suggestOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // Ne pas fermer si on clique dans le champ Pokémon ou dans la dropdown
      if (suggestRef.current?.contains(t)) return;
      const dropdown = document.querySelector(".gts-suggest-list");
      if (dropdown?.contains(t)) return;
      setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [suggestOpen]);

  const pickPokemon = useCallback((row: DexRow) => {
    setPokemonQuery(`${row.name} (#${row.id})`);
    setResolvedPickId(row.id);
    setSuggestOpen(false);
  }, []);

  const doSearch = useCallback(async () => {
    setSuggestOpen(false);

    // Mode direct : on a déjà l'ID interne GTS (depuis le popup browse)
    if (directSearchInternalId != null) {
      setLoading(true);
      setError(null);
      setResults([]);
      setSearched(true);
      try {
        const genderParam = gender === 0 ? -1 : gender;
        const entries = await gtsSearch(directSearchInternalId, levelMin, levelMax, genderParam);
        setResults(entries);
      } catch (e: any) {
        const msg = String(e?.message || e);
        setError(
          /Failed to fetch|NetworkError|blocked by CORS|CORS/i.test(msg)
            ? "Connexion au serveur GTS impossible."
            : msg,
        );
      } finally {
        setLoading(false);
        setDirectSearchInternalId(null);
      }
      return;
    }

    const resolved =
      resolvedPickId != null
        ? { id: resolvedPickId }
        : resolveSpeciesFromQuery(pokemonQuery, dexRows);

    if (resolved.id == null || resolved.id < 1) {
      setError(resolved.error ?? "Impossible de déterminer le Pokémon recherché.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setSearched(true);

    try {
      if (psdkFrenchNames === null) {
        setError("Lecture de Data/2.dat en cours…");
        return;
      }
      if (!psdkNameToInternal || psdkNameToInternal.size === 0) {
        setError(
          "Impossible de lire les espèces depuis le jeu (Data/2.dat). Installez le jeu et configurez son dossier dans le launcher, ou lancez l'application installée (pas seulement « npm run dev »).",
        );
        return;
      }
      const row = dexRows.find((r) => r.id === resolved.id);
      if (!row) {
        setError("Choisissez un Pokémon dans la liste pour associer le nom aux données du jeu.");
        return;
      }
      const internalId = internalIdFromPokemonName(row, psdkNameToInternal);
      if (internalId == null) {
        setError(
          `Aucun ID d'espèce trouvé dans Data/2.dat pour « ${row.name} ». Vérifiez que le nom du site correspond au jeu ou mettez à jour le jeu.`,
        );
        return;
      }
      const genderParam = gender === 0 ? -1 : gender;
      const entries = await gtsSearch(internalId, levelMin, levelMax, genderParam);
      setResults(entries);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(
        /Failed to fetch|NetworkError|blocked by CORS|CORS/i.test(msg)
          ? "Connexion au serveur GTS impossible. Vérifiez votre connexion ou utilisez le launcher installé."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }, [
    directSearchInternalId,
    resolvedPickId,
    pokemonQuery,
    dexRows,
    levelMin,
    levelMax,
    gender,
    psdkNameToInternal,
    psdkFrenchNames,
  ]);

  // Déclenche doSearch après mise à jour des states (depuis popup browse)
  useEffect(() => {
    if (searchTrigger > 0) {
      void doSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  const fullImageUrl = (url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const searchedName =
    resolvedPickId != null
      ? speciesById.get(resolvedPickId)?.name ?? `n°${resolvedPickId}`
      : pokemonQuery.trim();

  return (
    <main className="gts-page launcher-home animate-in">
      <div className="gts-container">
        {onBack && (
          <button type="button" className="bst-back" onClick={onBack} aria-label="Retour">
            <FaArrowLeft size={14} aria-hidden /> Retour
          </button>
        )}

        {/* ─── Hero (même "hero" glass que l'accueil — pas section.glass pour éviter le style du 1er div) ─── */}
        <section className="gts-hero hero" aria-labelledby="gts-heading">
          <div className="gts-hero-icon-wrap">
            <FaArrowRightArrowLeft className="gts-hero-icon" />
          </div>
          <div className="gts-hero-text">
            <h1 id="gts-heading" className="gts-title">
              Global Trade System
            </h1>
            <p className="gts-subtitle">
              Recherchez les Pokémon déposés en échange sur le serveur GTS.
            </p>
          </div>
          <div className="gts-hero-actions">
            <div className="gts-hero-stat">
              <FaGlobe className="gts-hero-stat-icon" />
              <div className="gts-hero-stat-text">
                <span className="gts-hero-stat-value">{dexLoading ? "…" : dexRows.length}</span>
                <span className="gts-hero-stat-label">espèces connues</span>
              </div>
            </div>
            <button
              type="button"
              className="gts-hero-stat gts-pcbox-btn"
              onClick={openHistory}
              title="Historique des échanges"
            >
              <FaClockRotateLeft className="gts-hero-stat-icon" />
              <div className="gts-hero-stat-text">
                <span className="gts-hero-stat-value" style={{fontSize:".85rem"}}>Historique</span>
              </div>
            </button>
            {profile?.boxes && profile.boxes.length > 0 && (
              <button
                type="button"
                className="gts-hero-stat gts-pcbox-btn"
                onClick={() => setShowPCBox(true)}
              >
                <FaBoxesStacked className="gts-hero-stat-icon" />
                <div className="gts-hero-stat-text">
                  <span className="gts-hero-stat-value" style={{fontSize:".85rem"}}>Boîtes PC</span>
                </div>
              </button>
            )}
            <button
              type="button"
              className="gts-hero-stat gts-pcbox-btn"
              onClick={() => {
                if (!chatProfile) { setWishlistGateReason("login"); }
                else if (!isPatreon) { setWishlistGateReason("patreon"); }
                else { setShowWishlist(true); }
              }}
              style={{ position: "relative" }}
            >
              <FaBell className="gts-hero-stat-icon" style={{ color: "#f96854" }} />
              <div className="gts-hero-stat-text">
                <span className="gts-hero-stat-value" style={{fontSize:".85rem"}}>Wishlist</span>
              </div>
              {isPatreon && wishlistMatchCount > 0 && (
                <span className="gts-wish-notif-badge">{wishlistMatchCount}</span>
              )}
            </button>
          </div>
        </section>

        {/* ─── PC Box Panel (trade mode or normal) ─── */}
        {tradeMode && tradeTarget?.wanted ? (
          <PCBoxView
            profile={profile ?? null}
            onBack={cancelTrade}
            embedded
            savePath={savePath}
            onProfileReload={onProfileReload}
            tradeFilter={{
              wantedSpecies: tradeTarget.wanted.species,
              wantedLevelMin: tradeTarget.wanted.levelMin,
              wantedLevelMax: tradeTarget.wanted.levelMax,
              wantedGender: tradeTarget.wanted.gender,
            }}
            onTradeSelect={handleTradeSelect}
            dexRows={dexRowsNoMega}
            siteUrl={siteUrl}
          />
        ) : showPCBox ? (
          <PCBoxView profile={profile ?? null} onBack={() => setShowPCBox(false)} embedded savePath={savePath} onProfileReload={onProfileReload} dexRows={dexRowsNoMega} siteUrl={siteUrl} onDepositDone={() => {
            // Upsert complet dans Supabase avec les données parsées du blob
            const myId = myDepositOnlineIdRef.current;
            if (myId) {
              const oid = parseInt(myId, 10);
              // D'abord supprimer pour reset first_seen_at, puis fetch blob et insert complet
              supabaseGts.from("gts_deposits").delete().eq("online_id", oid).then(() => {
                fetchGtsPokemonBlob(myId).then((blob) => {
                  const dep = blob ? parseGtsDepositedPokemon(blob) : null;
                  const entry: BrowseEntry = {
                    onlineId: myId,
                    depositedSpecies: dep?.speciesInternalId ?? 0,
                    wanted: null, // sera rempli au prochain scan
                    parsed: dep,
                    firstSeenAt: Date.now(),
                  };
                  supabaseGts.from("gts_deposits")
                    .insert([browseEntryToSupabaseRow(entry)])
                    .then(() => console.log("[GTS] Dépôt complet enregistré dans Supabase"));
                });
              });
            }
            void startBrowseScan(false);
            checkMyDeposit();
          }} />
        ) : (
        <>

        {/* ─── Mes dépôts (retrait) ─── */}
        {savePath && (
          <section className="gts-withdraw-section glass">
            <h2 className="gts-withdraw-heading" style={{display:"flex",alignItems:"center",gap:8}}>
              <FaBoxOpen size={14} /> Mon dépôt GTS
              <button
                type="button"
                className="gts-withdraw-btn gts-withdraw-btn--take"
                style={{fontSize:".5rem",padding:"2px 7px",marginLeft:"auto",fontWeight:500}}
                onClick={() => { setWithdrawAction("idle"); setWithdrawError(""); checkMyDeposit(); }}
                title="Rafraîchir"
              >
                <FaArrowsRotate size={9} />
              </button>
            </h2>
            {myDepositStatus === "loading" && (
              <div className="gts-withdraw-loading">
                <FaSpinner2 className="gts-spin" size={12} /> Vérification de votre dépôt...
              </div>
            )}
            {myDepositStatus === "error" && (
              <div className="gts-withdraw-empty">
                <FaWarn2 size={11} /> Impossible de vérifier votre dépôt.
                <button type="button" className="gts-withdraw-btn gts-withdraw-btn--take" onClick={checkMyDeposit} style={{marginLeft:8,fontSize:".55rem"}}>
                  Réessayer
                </button>
              </div>
            )}
            {myDepositStatus === "loaded" && !myDeposit && withdrawAction === "done" && withdrawBoxName && (
              <div className="gts-withdraw-empty" style={{color:"#6ee7b7",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                <FaCheck2 size={13} /> Pokémon retiré et placé dans {withdrawBoxName} !
              </div>
            )}
            {myDepositStatus === "loaded" && !myDeposit && withdrawAction !== "done" && (
              <div className="gts-withdraw-empty">
                <FaCircleInfo size={11} /> Vous n'avez aucun Pokémon déposé sur le GTS.
              </div>
            )}
            {myDepositStatus === "loaded" && myDeposit && (() => {
              const depRow = speciesByInternal.get(myDeposit.speciesInternalId);
              const sprUrl = depRow?.imageUrl ? fullImageUrl(depRow.imageUrl) : null;
              const myDepName = depRow?.name ?? (psdkFrenchNamesRef.current?.[myDeposit.speciesInternalId] ?? `#${myDeposit.speciesInternalId}`);
              const wantedName = myDepositWanted ? (psdkFrenchNamesRef.current?.[myDepositWanted.species] ?? `#${myDepositWanted.species}`) : null;
              const wantedRow = myDepositWanted ? speciesByInternal.get(myDepositWanted.species) : null;
              const wantedSprUrl = wantedRow?.imageUrl ? fullImageUrl(wantedRow.imageUrl) : null;
              return (
              <div className="gts-mydep-card">
                {/* ─── Pokémon déposé ─── */}
                <div className="gts-mydep-main">
                  <div className="gts-mydep-sprite">
                    {sprUrl ? <img src={sprUrl} alt="" /> : <FaCircleQuestion size={24} style={{color:"rgba(255,255,255,.3)"}} />}
                  </div>
                  <div className="gts-mydep-info">
                    <div className="gts-mydep-name">
                      {myDepName}
                      {myDeposit.nickname && <span className="gts-mydep-nick">({myDeposit.nickname})</span>}
                      {myDeposit.isShiny && <FaStar size={10} className="gts-mydep-shiny-star" />}
                    </div>
                    <div className="gts-mydep-chips">
                      <span className="gts-mydep-chip"><FaStairs size={8} /> Nv. {myDeposit.level}</span>
                      <span className="gts-mydep-chip">{myDeposit.gender === 0 ? <><FaMars size={8} /> Mâle</> : myDeposit.gender === 1 ? <><FaVenus size={8} /> Femelle</> : "—"}</span>
                      <span className="gts-mydep-chip"><FaLeaf size={8} /> {NATURE_FR[myDeposit.nature] ?? "—"}</span>
                    </div>
                    {/* Extras résumé */}
                    {myExtras && !isDepositTraded && (
                      <div className="gts-mydep-extras">
                        {myExtras.shiny !== "any" && <span className="gts-mydep-extras-tag">{myExtras.shiny === "yes" ? "✨ Shiny" : "Non-shiny"}</span>}
                        {myExtras.nature !== null && <span className="gts-mydep-extras-tag">{NATURE_FR[myExtras.nature]}</span>}
                        {Object.values(myExtras.ivs).some(v => v > 0) && <span className="gts-mydep-extras-tag"><FaDna size={8} /> IVs requis</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* ─── Demandé en retour ─── */}
                {isDepositTraded ? (
                  <div className="gts-mydep-traded">
                    <FaStar style={{color:"#6ee7b7"}} /> Échange effectué ! Récupérez votre nouveau Pokémon.
                  </div>
                ) : myDepositWanted ? (
                  <div className="gts-mydep-wanted">
                    <div className="gts-mydep-wanted-label">Demandé en retour</div>
                    <div className="gts-mydep-wanted-row">
                      <div className="gts-mydep-wanted-sprite">
                        {wantedSprUrl ? <img src={wantedSprUrl} alt="" /> : <FaCircleQuestion size={16} />}
                      </div>
                      <span className="gts-mydep-wanted-name">{wantedName}</span>
                      <span className="gts-mydep-wanted-detail">
                        Nv. {myDepositWanted.levelMin}–{myDepositWanted.levelMax}
                        {myDepositWanted.gender === 1 ? " ♂" : myDepositWanted.gender === 2 ? " ♀" : ""}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* ─── Actions ─── */}
                <div className="gts-mydep-actions">
                  {withdrawAction === "idle" && (
                    <>
                      {!isDepositTraded && (
                        <button type="button" className="gts-mydep-btn gts-mydep-btn--edit" onClick={startEditExtras}>
                          <FaPen size={9} /> Modifier
                        </button>
                      )}
                      <button
                        type="button"
                        className={`gts-mydep-btn gts-mydep-btn--take${isDepositTraded ? " gts-mydep-btn--traded" : ""}`}
                        onClick={() => withdrawMyDeposit(false)}
                      >
                        <FaArrowDown size={10} /> {isDepositTraded ? "Récupérer" : "Retirer"}
                      </button>
                    </>
                  )}
                  {(withdrawAction === "withdrawing" || withdrawAction === "deleting") && (
                    <span className="gts-mydep-loading"><FaSpinner2 className="gts-spin" size={11} /> {withdrawAction === "withdrawing" ? "Retrait..." : "Suppression..."}</span>
                  )}
                  {withdrawAction === "done" && (
                    <span className="gts-mydep-done"><FaCheck2 size={11} /> {withdrawBoxName ? `Placé dans ${withdrawBoxName} !` : "OK !"}</span>
                  )}
                  {withdrawAction === "error" && (
                    <span style={{color:"#fca5a5",fontSize:".6rem",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span>{withdrawError || "Erreur"}</span>
                      <button
                        type="button"
                        className="gts-withdraw-btn gts-withdraw-btn--take"
                        style={{fontSize:".55rem",padding:"2px 8px"}}
                        onClick={() => { setWithdrawAction("idle"); setWithdrawError(""); }}
                      >
                        Réessayer
                      </button>
                    </span>
                  )}
                </div>
              </div>
              );
            })()}

            {/* ─── Modal modification extras ─── */}
            {editingExtras && createPortal(
              <div className="gts-editmod-overlay" onClick={() => setEditingExtras(false)}>
                <div className="gts-editmod" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="gts-editmod-close" onClick={() => setEditingExtras(false)}>✕</button>
                  <h2 className="gts-editmod-title">
                    <FaPen size={12} /> Modifier les critères du Pokémon demandé
                  </h2>

                  <div className="gts-editmod-section">
                    <div className="gts-editmod-row">
                      <div className="gts-editmod-field">
                        <label className="gts-label"><FaStar size={9} style={{color:"#f0c420"}} /> Shiny</label>
                        <CustomSelect
                          value={editShiny}
                          onChange={(v) => setEditShiny(v as "any"|"yes"|"no")}
                          options={[
                            { value: "any", label: "Indifférent" },
                            { value: "yes", label: "Oui (shiny)", icon: <FaStar size={9} style={{color:"#f0c420"}} /> },
                            { value: "no", label: "Non" },
                          ]}
                        />
                      </div>
                      <div className="gts-editmod-field" style={{flex:"1 1 200px"}}>
                        <label className="gts-label"><FaLeaf size={9} style={{color:"#6ecf8a"}} /> Nature souhaitée</label>
                        <CustomSelect
                          value={editNature !== null ? String(editNature) : "-1"}
                          onChange={(v) => { const n = Number(v); setEditNature(n < 0 ? null : n); }}
                          options={[
                            { value: "-1", label: "Indifférente" },
                            ...NATURE_FR.map((n, i) => {
                              const NATURE_EFFECTS: Record<number, [string, string] | null> = {
                                0:null,6:null,12:null,18:null,24:null,
                                1:["Atk","Déf"],2:["Atk","Vit"],3:["Atk","Sp.A"],4:["Atk","Sp.D"],
                                5:["Déf","Atk"],7:["Déf","Vit"],8:["Déf","Sp.A"],9:["Déf","Sp.D"],
                                10:["Vit","Atk"],11:["Vit","Déf"],13:["Vit","Sp.A"],14:["Vit","Sp.D"],
                                15:["Sp.A","Atk"],16:["Sp.A","Déf"],17:["Sp.A","Vit"],19:["Sp.A","Sp.D"],
                                20:["Sp.D","Atk"],21:["Sp.D","Déf"],22:["Sp.D","Vit"],23:["Sp.D","Sp.A"],
                              };
                              const eff = NATURE_EFFECTS[i];
                              return { value: String(i), label: `${n}${eff ? ` (+${eff[0]} / -${eff[1]})` : " (neutre)"}` };
                            }),
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  {/* IVs section — style identique aux filtres avancés */}
                  <div className="gts-advanced-iv-section">
                    <div className="gts-advanced-iv-header">
                      <span className="gts-label" style={{ margin: 0 }}>
                        <FaDna size={9} style={{ marginRight: 4 }} /> IVs minimum par stat
                      </span>
                      <div className="gts-advanced-iv-actions">
                        <button type="button" className="gts-advanced-iv-pill" onClick={() => setEditIvs({ hp: 31, atk: 31, def: 31, spd: 31, spa: 31, spd2: 31 })}>Tous à 31</button>
                        <button type="button" className="gts-advanced-iv-pill gts-advanced-iv-pill--reset" onClick={() => setEditIvs({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 })}>Reset</button>
                      </div>
                    </div>
                    <div className="gts-advanced-iv-grid">
                      {([
                        { key: "hp" as const, label: "PV", Icon: FaHeart, cls: "hp" },
                        { key: "atk" as const, label: "Atk", Icon: FaHandFist, cls: "atk" },
                        { key: "def" as const, label: "Déf", Icon: FaShield, cls: "def" },
                        { key: "spd" as const, label: "Vit", Icon: FaBolt, cls: "spe" },
                        { key: "spa" as const, label: "Sp.A", Icon: FaWandMagicSparkles, cls: "spa" },
                        { key: "spd2" as const, label: "Sp.D", Icon: FaShieldHalved, cls: "spd" },
                      ] as const).map(({ key, label, Icon, cls }) => (
                        <div key={key} className="gts-advanced-iv-item">
                          <Icon className={`gts-advanced-iv-ico gts-advanced-iv-ico--${cls}`} />
                          <span className="gts-advanced-iv-label">{label}</span>
                          <input
                            type="range" min={0} max={31}
                            className={`gts-advanced-iv-slider gts-advanced-iv-slider--${cls}`}
                            value={editIvs[key]}
                            style={{ background: `linear-gradient(90deg, var(--iv-color-${cls}) ${(editIvs[key] / 31) * 100}%, rgba(255,255,255,.07) ${(editIvs[key] / 31) * 100}%)` }}
                            onChange={(e) => setEditIvs((p) => ({ ...p, [key]: Number(e.target.value) }))}
                          />
                          <span className={`gts-advanced-iv-val${editIvs[key] === 31 ? " gts-advanced-iv-val--max" : ""}`}>{editIvs[key]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="gts-editmod-actions">
                    <button type="button" className="gts-editmod-btn gts-editmod-btn--cancel" onClick={() => setEditingExtras(false)}>
                      Annuler
                    </button>
                    <button type="button" className="gts-editmod-btn gts-editmod-btn--save" onClick={saveEditExtras}>
                      <FaFloppyDisk size={10} /> Enregistrer
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </section>
        )}

        {/* ─── Recherche ─── */}
        <div className="gts-search-wrap" ref={suggestRef}>
        <section className="gts-search-section glass" ref={searchSectionRef}>
          <h2 className="gts-section-heading">
            <FaMagnifyingGlass className="gts-section-heading-icon" />
            Rechercher un Pokémon
          </h2>

          <div className="gts-search-grid">
            {/* Pokémon name */}
            <div className="gts-field gts-field--pokemon">
              <label className="gts-label">Pokémon</label>
              <div className="gts-autocomplete-wrap">
                <FaMagnifyingGlass className="gts-input-icon" />
                <input
                  type="text"
                  className="gts-input gts-input--with-icon"
                  placeholder={dexLoading ? "Chargement du Pokédex…" : "Nom ou numéro…"}
                  autoComplete="off"
                  disabled={dexLoading}
                  value={pokemonQuery}
                  onChange={(e) => {
                    setPokemonQuery(e.target.value);
                    setResolvedPickId(null);
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void doSearch();
                    }
                    if (e.key === "Escape") setSuggestOpen(false);
                  }}
                />
              </div>
            </div>

            {/* Filters — inline avec le champ Pokémon */}
            <div className="gts-field gts-field--filter">
              <label className="gts-label">Niveau min</label>
              <input
                type="number"
                min={1}
                max={100}
                className="gts-input gts-input--compact"
                value={levelMin}
                onChange={(e) => setLevelMin(Number(e.target.value))}
              />
            </div>
            <div className="gts-field gts-field--filter">
              <label className="gts-label">Niveau max</label>
              <input
                type="number"
                min={1}
                max={100}
                className="gts-input gts-input--compact"
                value={levelMax}
                onChange={(e) => setLevelMax(Number(e.target.value))}
              />
            </div>
            <div className="gts-field gts-field--filter">
              <label className="gts-label">Genre</label>
              <CustomSelect
                value={String(gender)}
                onChange={(v) => setGender(Number(v))}
                options={[
                  { value: "0", label: "Indifférent", icon: <FaVenusMars size={10} /> },
                  { value: "1", label: "Mâle", icon: <FaMars size={10} style={{color:"#60a5fa"}} /> },
                  { value: "2", label: "Femelle", icon: <FaVenus size={10} style={{color:"#f472b6"}} /> },
                ]}
              />
            </div>
            <button
                type="button"
                className="gts-search-btn accent-glow-btn"
                onClick={() => void doSearch()}
                disabled={loading || dexLoading || !psdkDataReady}
              >
                {loading ? <FaSpinner className="gts-spin" /> : <FaMagnifyingGlass />}
                <span>{loading ? "Recherche…" : "Rechercher"}</span>
              </button>
          </div>

          {/* ─── Toggle filtres avancés ─── */}
          {(() => {
            const activeCount = (filterNature !== null ? 1 : 0)
              + (filterShiny !== "any" ? 1 : 0)
              + (Object.values(filterIvs).some(v => v > 0) ? 1 : 0)
              + (filterWantedQuery.trim() ? 1 : 0);
            return (
              <button
                type="button"
                className={`gts-advanced-toggle${showAdvancedFilters ? " gts-advanced-toggle--open" : ""}`}
                onClick={() => setShowAdvancedFilters(v => !v)}
              >
                <FaFilter size={10} />
                Filtres avancés
                {activeCount > 0 && <span className="gts-advanced-toggle-count">{activeCount}</span>}
                <FaArrowDown className="gts-advanced-toggle-chevron" size={9} />
              </button>
            );
          })()}

          {/* ─── Panneau filtres avancés ─── */}
          <div className={`gts-advanced-panel${showAdvancedFilters ? " gts-advanced-panel--open" : ""}`}>
            <div className="gts-advanced-panel-inner">
              <div className="gts-advanced-row">
                {/* Pokémon demandé en retour */}
                <div className="gts-field" style={{ flex: "1 1 180px" }}>
                  <label className="gts-label">Pokémon demandé en retour</label>
                  <input
                    type="text"
                    className="gts-input gts-input--compact"
                    placeholder="Qui cherche ce Pokémon ?"
                    value={filterWantedQuery}
                    onChange={(e) => setFilterWantedQuery(e.target.value)}
                  />
                </div>

                {/* Nature */}
                <div className="gts-field" style={{ flex: "0 0 160px" }}>
                  <label className="gts-label">Nature</label>
                  <CustomSelect
                    value={filterNature !== null ? String(filterNature) : ""}
                    onChange={(v) => setFilterNature(v === "" ? null : Number(v))}
                    options={[
                      { value: "", label: "Indifférent", icon: <FaLeaf size={9} style={{color:"rgba(255,255,255,.3)"}} /> },
                      ...NATURE_FR.map((n, i) => ({ value: String(i), label: n, icon: <FaLeaf size={9} style={{color:"#6ecf8a"}} /> })),
                    ]}
                  />
                </div>

                {/* Shiny */}
                <div className="gts-field" style={{ flex: "0 0 150px" }}>
                  <label className="gts-label">Shiny</label>
                  <CustomSelect
                    value={filterShiny}
                    onChange={(v) => setFilterShiny(v as "any" | "yes" | "no")}
                    options={[
                      { value: "any", label: "Indifférent" },
                      { value: "yes", label: "Shiny uniquement", icon: <FaStar size={9} style={{color:"#f0c420"}} /> },
                      { value: "no", label: "Non-shiny" },
                    ]}
                  />
                </div>
              </div>

              {/* IVs minimum */}
              <div className="gts-advanced-iv-section">
                <div className="gts-advanced-iv-header">
                  <span className="gts-label" style={{ margin: 0 }}>
                    <FaDna size={9} style={{ marginRight: 4 }} /> IVs minimum
                  </span>
                  <div className="gts-advanced-iv-actions">
                    <button
                      type="button"
                      className="gts-advanced-iv-pill"
                      onClick={() => setFilterIvs({ hp: 31, atk: 31, def: 31, spd: 31, spa: 31, spd2: 31 })}
                    >Tous à 31</button>
                    <button
                      type="button"
                      className="gts-advanced-iv-pill gts-advanced-iv-pill--reset"
                      onClick={() => setFilterIvs({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 })}
                    >Reset</button>
                  </div>
                </div>
                <div className="gts-advanced-iv-grid">
                  {([
                    { key: "hp" as const, label: "PV", Icon: FaHeart, cls: "hp" },
                    { key: "atk" as const, label: "Atk", Icon: FaHandFist, cls: "atk" },
                    { key: "def" as const, label: "Déf", Icon: FaShield, cls: "def" },
                    { key: "spd" as const, label: "Vit", Icon: FaBolt, cls: "spe" },
                    { key: "spa" as const, label: "Sp.A", Icon: FaWandMagicSparkles, cls: "spa" },
                    { key: "spd2" as const, label: "Sp.D", Icon: FaShieldHalved, cls: "spd" },
                  ] as const).map(({ key, label, Icon, cls }) => (
                    <div key={key} className="gts-advanced-iv-item">
                      <Icon className={`gts-advanced-iv-ico gts-advanced-iv-ico--${cls}`} />
                      <span className="gts-advanced-iv-label">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={31}
                        className={`gts-advanced-iv-slider gts-advanced-iv-slider--${cls}`}
                        value={filterIvs[key]}
                        style={{
                          background: `linear-gradient(90deg, var(--iv-color-${cls}) ${(filterIvs[key] / 31) * 100}%, rgba(255,255,255,.07) ${(filterIvs[key] / 31) * 100}%)`,
                        }}
                        onChange={(e) => setFilterIvs(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                      />
                      <span className={`gts-advanced-iv-val${filterIvs[key] === 31 ? " gts-advanced-iv-val--max" : ""}`}>
                        {filterIvs[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Dropdown suggestions (sous la section recherche) ─── */}
        {suggestOpen && !dexLoading && dexRows.length > 0 && (() => {
          const pokedexRows = filteredDexRows.filter((r) => !r.isExtradex);
          const extradexRows = filteredDexRows.filter((r) => r.isExtradex);
          const renderRow = (row: DexRow, idx: number) => {
            const sprite = row.imageUrl ? fullImageUrl(row.imageUrl) : "";
            return (
              <li key={`${row.id}-${normalizeName(row.name)}-${idx}`}>
                <button
                  type="button"
                  className="gts-suggest-item"
                  role="option"
                  onClick={() => pickPokemon(row)}
                >
                  <span className="gts-suggest-thumb-wrap">
                    {sprite ? (
                      <img src={sprite} alt="" className="gts-suggest-thumb" loading="lazy" />
                    ) : (
                      <span className="gts-suggest-thumb gts-suggest-thumb--empty" aria-hidden />
                    )}
                  </span>
                  <span className="gts-suggest-num">
                    {row.isExtradex ? (
                      <span className="gts-suggest-extradex-badge">EX</span>
                    ) : (
                      <FaHashtag className="gts-suggest-hash" />
                    )}
                    {row.isExtradex ? row.extradexNum : row.id}
                  </span>
                  <span className="gts-suggest-name">{row.name}</span>
                </button>
              </li>
            );
          };
          return pokedexRows.length === 0 && extradexRows.length === 0 ? (
            <div className="gts-suggest-list">
              <p className="gts-suggest-empty">Aucun Pokémon ne correspond à cette recherche.</p>
            </div>
          ) : (
            <div className="gts-suggest-columns">
              <div className="gts-suggest-col pnw-scrollbar">
                <div className="gts-suggest-col-header">Pokédex</div>
                <ul className="gts-suggest-col-list" role="listbox">
                  {pokedexRows.length === 0 ? (
                    <li className="gts-suggest-empty">Aucun résultat</li>
                  ) : pokedexRows.map(renderRow)}
                </ul>
              </div>
              <div className="gts-suggest-col gts-suggest-col--extradex pnw-scrollbar">
                <div className="gts-suggest-col-header gts-suggest-col-header--extradex">Extradex</div>
                <ul className="gts-suggest-col-list" role="listbox">
                  {extradexRows.length === 0 ? (
                    <li className="gts-suggest-empty">Aucun résultat</li>
                  ) : extradexRows.map(renderRow)}
                </ul>
              </div>
            </div>
          );
        })()}
        </div>

        {/* ─── Erreur ─── */}
        {error && (
          <div className="gts-error">
            <FaCircleInfo className="gts-error-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* ─── État vide ─── */}
        {searched && !loading && results.length === 0 && !error && (
          <section className="gts-empty hero" aria-live="polite">
            <div className="gts-empty-icon-wrap">
              <FaArrowRightArrowLeft className="gts-empty-icon" />
            </div>
            <p className="gts-empty-title">Aucun échange trouvé</p>
            <p className="gts-empty-desc">
              Personne ne propose {searchedName} avec ces critères pour le moment.
            </p>
          </section>
        )}

        {/* ─── Loader ─── */}
        {loading && (
          <div className="gts-loading">
            <FaSpinner className="gts-spin gts-loading-icon" />
            <span>Interrogation du serveur GTS…</span>
          </div>
        )}

        {/* ─── Résultats (popup) ─── */}
        {results.length > 0 && createPortal(
          <div className="gts-results-popup-overlay" onClick={() => { setResults([]); setSearched(false); setPokemonQuery(""); setResolvedPickId(null); }}>
            <div className="gts-results-popup pnw-scrollbar" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="gts-results-popup-close" onClick={() => { setResults([]); setSearched(false); setPokemonQuery(""); setResolvedPickId(null); }}>✕</button>
              <h2 className="gts-results-heading">
                <span className="gts-results-count">{results.length}</span>
                échange{results.length > 1 ? "s" : ""} disponible{results.length > 1 ? "s" : ""}
                {searchedName ? ` pour ${searchedName}` : ""}
              </h2>
              <div className="gts-grid">
                {results.map((entry, i) => {
                const wantedRow = entry.wanted
                  ? speciesByInternal.get(entry.wanted.species) ?? null
                  : null;
                // Sprite demandé : API Pokédex > VD normal (fallback)
                const wantedSpriteApi = wantedRow?.imageUrl ? fullImageUrl(wantedRow.imageUrl) : "";
                const wantedSpriteVd = !wantedRow && entry.wanted
                  ? normalSpriteCache[`normal_${entry.wanted.species}`] ?? ""
                  : "";
                const wantedSprite = wantedSpriteApi || wantedSpriteVd;
                // Nom demandé : API Pokédex > psdkFrenchNames (fallback)
                const wantedName = wantedRow?.name
                  ?? (entry.wanted && psdkFrenchNames && psdkFrenchNames[entry.wanted.species]
                    ? psdkFrenchNames[entry.wanted.species]
                    : null);
                const dep = depositByOnlineId[entry.onlineId];
                const depRow =
                  dep != null
                    ? speciesByInternal.get(dep.speciesInternalId) ?? null
                    : null;
                const depSpriteBase = depRow?.imageUrl ? fullImageUrl(depRow.imageUrl) : "";
                const depShinyKey = dep ? `${dep.speciesInternalId}_${dep.form}` : "";
                const depShinyUrl = dep?.isShiny ? shinySpriteCache[depShinyKey] : null;
                const depSprite = depShinyUrl || depSpriteBase;
                return (
                  <div
                    key={`gts-${entry.onlineId}-${i}`}
                    className="gts-card"
                    style={{ animationDelay: `${i * 0.04}s` }}
                  >
                    <div className="gts-card-accent" />

                    <div className="gts-card-header">
                      <div className="gts-card-header-main">
                        <span className="gts-card-id-label">ID en ligne</span>
                        <span className="gts-card-id" title="Identifiant de l'emplacement sur le serveur GTS">
                          <FaHashtag className="gts-card-id-hash" />
                          {entry.onlineId}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {onShareToChat && (
                          <button
                            className="gts-card-badge gts-card-badge--share"
                            onClick={(e) => {
                              e.stopPropagation();
                              const depName = depRow?.name ?? (dep && psdkFrenchNames ? psdkFrenchNames[dep.speciesInternalId] : "") ?? `#${dep?.speciesInternalId}`;
                              const nature = dep?.nature != null ? NATURE_FR[dep.nature] || "" : "";
                              onShareToChat({
                                onlineId: entry.onlineId,
                                deposited: {
                                  name: depName,
                                  sprite: depSprite,
                                  level: dep?.level ?? 0,
                                  shiny: dep?.isShiny ?? false,
                                  altShiny: dep?.isAltShiny ?? false,
                                  nature,
                                  gender: dep?.gender ?? 2,
                                },
                                wanted: entry.wanted && wantedName ? {
                                  name: wantedName,
                                  sprite: wantedSprite,
                                  levelMin: entry.wanted.levelMin,
                                  levelMax: entry.wanted.levelMax,
                                  gender: entry.wanted.gender,
                                } : null,
                                trainer: dep?.trainerName || "Inconnu",
                              });
                              // Close the results popup
                              setResults([]); setSearched(false);
                            }}
                          >
                            <FaShareNodes />
                            Partager
                          </button>
                        )}
                        {savePath && isTauriShell() && entry.wanted ? (
                          <button
                            className="gts-card-badge gts-card-badge--trade"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTradeTarget(entry);
                              setTradeMode(true);
                              setTradeStep("selecting");
                            }}
                          >
                            <FaArrowRightArrowLeft />
                            Échanger
                          </button>
                        ) : (
                          <span className="gts-card-badge">
                            <FaArrowRightArrowLeft />
                            Échange
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="gts-card-split">
                      <div className="gts-card-col gts-card-col--offer">
                        <div className="gts-card-panel gts-card-panel--offer">
                          <div className="gts-card-panel-head">
                            <span className="gts-card-panel-title gts-card-panel-title--icon">
                              <FaGift className="gts-card-panel-ico" aria-hidden />
                              Pokémon proposé
                            </span>
                            {dep && dep.isAltShiny && (
                              <span className="gts-card-pill gts-card-pill--alt-shiny">
                                <FaStar className="gts-card-pill-icon" />
                                Shiny Alt
                              </span>
                            )}
                            {dep && dep.isShiny && !dep.isAltShiny && (
                              <span className="gts-card-pill gts-card-pill--shiny">
                                <FaStar className="gts-card-pill-icon" />
                                Shiny
                              </span>
                            )}
                          </div>
                          {dep === undefined ? (
                            <div className="gts-card-skel" aria-busy>
                              <span className="gts-card-skel-line" />
                              <span className="gts-card-skel-line gts-card-skel-line--short" />
                            </div>
                          ) : dep === null ? (
                            <p className="gts-card-muted">
                              Impossible de lire le Pokémon déposé (réponse serveur vide ou invalide).
                            </p>
                          ) : (
                            <>
                              <div className="gts-card-wanted-main gts-card-wanted-main--large">
                                {depSprite ? (
                                  <img
                                    src={depSprite}
                                    alt=""
                                    className="gts-card-sprite gts-card-sprite--large"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="gts-card-sprite-fallback" aria-hidden>
                                    <FaCircleQuestion />
                                  </div>
                                )}
                                <div className="gts-card-offer-text">
                                  <span className="gts-card-species-name">
                                    {depRow?.name ?? `Espèce #${dep.speciesInternalId}`}
                                  </span>
                                  {dep.nickname && (
                                    <span className="gts-card-nick">« {dep.nickname} »</span>
                                  )}
                                  <div className="gts-offer-chips">
                                    <div className="gts-chip gts-chip--level">
                                      <div className="gts-chip-ico-ring" aria-hidden>
                                        <FaStairs />
                                      </div>
                                      <div className="gts-chip-body">
                                        <span className="gts-chip-kicker">Niveau</span>
                                        <span className="gts-chip-highlight">{dep.level}</span>
                                      </div>
                                    </div>
                                    <div className={`gts-chip gts-chip--pgender gts-chip--pg${dep.gender}`}>
                                      <div className="gts-chip-ico-ring gts-chip-ico-ring--gender" aria-hidden>
                                        {POKEMON_GENDER_ICONS[dep.gender]}
                                      </div>
                                      <div className="gts-chip-body">
                                        <span className="gts-chip-kicker">Genre</span>
                                        <span className="gts-chip-highlight">
                                          {POKEMON_GENDER_LABELS[dep.gender] ?? `—`}
                                        </span>
                                      </div>
                                    </div>
                                    {dep.form > 0 && (
                                      <div className="gts-chip gts-chip--form">
                                        <div className="gts-chip-ico-ring" aria-hidden>
                                          <FaLayerGroup />
                                        </div>
                                        <div className="gts-chip-body">
                                          <span className="gts-chip-kicker">Forme</span>
                                          <span className="gts-chip-highlight">{dep.form}</span>
                                        </div>
                                      </div>
                                    )}
                                    <div className="gts-chip gts-chip--nature">
                                      <div className="gts-chip-ico-ring gts-chip-ico-ring--leaf" aria-hidden>
                                        <FaLeaf />
                                      </div>
                                      <div className="gts-chip-body gts-chip-body--grow">
                                        <span className="gts-chip-kicker">Nature</span>
                                        <span className="gts-chip-nature-name">
                                          {NATURE_FR[dep.nature] ?? `Nature #${dep.nature}`}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="gts-card-details gts-card-details--dense gts-card-details--ivtone">
                                <div className="gts-detail gts-detail--ivhp">
                                  <span className="gts-detail-key">
                                    <FaUser className="gts-detail-ico" aria-hidden />
                                    Dresseur
                                  </span>
                                  <span className="gts-detail-value">{dep.trainerName}</span>
                                </div>
                                <div className="gts-detail gts-detail--ivatk">
                                  <span className="gts-detail-key">
                                    <FaFingerprint className="gts-detail-ico" aria-hidden />
                                    ID visible
                                  </span>
                                  <span className="gts-detail-value gts-detail-mono">
                                    {dep.trainerVisibleId.toString().padStart(5, "0")}
                                  </span>
                                </div>
                                <div className="gts-detail gts-detail--ivdef">
                                  <span className="gts-detail-key">
                                    <FaKey className="gts-detail-ico" aria-hidden />
                                    ID complet (OT)
                                  </span>
                                  <span className="gts-detail-value gts-detail-mono">{dep.trainerIdRaw}</span>
                                </div>
                                <div className="gts-detail gts-detail--ivspe">
                                  <span className="gts-detail-key">
                                    <FaChartLine className="gts-detail-ico" aria-hidden />
                                    Expérience
                                  </span>
                                  <span className="gts-detail-value">{dep.exp.toLocaleString("fr-FR")}</span>
                                </div>
                                <div className="gts-detail gts-detail--ivspa">
                                  <span className="gts-detail-key">
                                    <FaHashtag className="gts-detail-ico" aria-hidden />
                                    ID espèce (jeu)
                                  </span>
                                  <span className="gts-detail-value gts-detail-mono">{dep.speciesInternalId}</span>
                                </div>
                                <div className="gts-detail gts-detail--ivspd">
                                  <span className="gts-detail-key">
                                    <FaWandMagicSparkles className="gts-detail-ico" aria-hidden />
                                    Talent (index)
                                  </span>
                                  <span className="gts-detail-value gts-detail-mono">{dep.ability}</span>
                                </div>
                                <div className="gts-detail gts-detail--span gts-detail--ivbag">
                                  <span className="gts-detail-key">
                                    <FaBagShopping className="gts-detail-ico" aria-hidden />
                                    Objet tenu
                                  </span>
                                  <span className="gts-detail-value gts-detail-mono">
                                    {dep.itemHolding === 0 ? "Aucun" : `#${dep.itemHolding}`}
                                  </span>
                                </div>
                                {(dep.marshalRareness != null || dep.marshalShinyRate != null) && (
                                  <div className="gts-detail gts-detail--span">
                                    <span className="gts-detail-key">
                                      <FaStar className="gts-detail-ico" aria-hidden />
                                      Rareté / seuil (Marshal)
                                    </span>
                                    <span className="gts-detail-value gts-detail-mono" title="PSDK : rareness et shiny_rate dans le blob serveur">
                                      {dep.marshalRareness ?? "—"} / {dep.marshalShinyRate ?? "—"}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <GtsIvSpread dep={dep} />
                              {dep.moves.length > 0 && (
                                <GtsMoveList moves={dep.moves} skillNames={psdkSkillNames} />
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="gts-card-col gts-card-col--want">
                        {entry.wanted ? (
                          <div className="gts-card-panel gts-card-panel--want">
                            <div className="gts-card-panel-head">
                              <span className="gts-card-panel-title gts-card-panel-title--icon">
                                <FaArrowRightArrowLeft className="gts-card-panel-ico" aria-hidden />
                                Demandé en retour
                              </span>
                              <span className="gts-card-pill gts-card-pill--want">Souhaité</span>
                            </div>
                            <div className="gts-card-wanted-main gts-card-wanted-main--large">
                              {wantedSprite ? (
                                <img
                                  src={wantedSprite}
                                  alt=""
                                  className="gts-card-sprite gts-card-sprite--large"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="gts-card-sprite-fallback" aria-hidden>
                                    <FaCircleQuestion />
                                  </div>
                              )}
                              <div className="gts-card-offer-text">
                                <span className="gts-card-species-name">
                                  {wantedName ?? `n°${entry.wanted.species}`}
                                </span>
                                {wantedRow && wantedRow.id > 0 && (
                                  <span className="gts-want-dex-badge">
                                    <FaHashtag className="gts-want-dex-ico" aria-hidden />
                                    Pokédex régional n°{wantedRow.id}
                                  </span>
                                )}
                                <div className="gts-want-chips">
                                  <div
                                    className={`gts-chip gts-chip--want-g gts-chip--wg${entry.wanted.gender}`}
                                  >
                                    <div className="gts-chip-ico-ring gts-chip-ico-ring--gender" aria-hidden>
                                      {GENDER_ICONS[entry.wanted.gender]}
                                    </div>
                                    <div className="gts-chip-body">
                                      <span className="gts-chip-kicker">Genre souhaité</span>
                                      <span className="gts-chip-highlight">
                                        {GENDER_LABELS[entry.wanted.gender] ?? "Indifférent"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="gts-want-level-block">
                              <div className="gts-want-level-head">
                                <span className="gts-want-level-title">
                                  <FaStairs className="gts-want-level-title-ico" aria-hidden />
                                  Niveaux acceptés
                                </span>
                                <span className="gts-want-level-values gts-detail-mono">
                                  {entry.wanted.levelMin} — {entry.wanted.levelMax}
                                </span>
                              </div>
                              <div className="gts-want-level-track" aria-hidden>
                                <div className="gts-want-level-ticks">
                                  <span>1</span>
                                  <span>50</span>
                                  <span>100</span>
                                </div>
                                <div className="gts-want-level-rail">
                                  <div
                                    className="gts-want-level-fill"
                                    style={wantLevelRangeStyle(
                                      entry.wanted.levelMin,
                                      entry.wanted.levelMax,
                                    )}
                                  />
                                </div>
                              </div>
                            </div>
                            {(() => {
                              const extras = extrasByOnlineId[entry.onlineId] ?? null;
                              if (extras) {
                                const hasIvs = Object.values(extras.ivs).some(v => v > 0);
                                const hasChips = extras.shiny !== "any" || extras.nature !== null;
                                return (
                                  <div className="gts-want-extras">
                                    <div className="gts-want-extras-badge">
                                      <FaBoxesStacked size={9} /> Critères launcher
                                    </div>
                                    {hasChips && (
                                      <div className="gts-want-extras-list">
                                        {extras.shiny !== "any" && (
                                          <div className="gts-want-extras-chip">
                                            <FaStar size={9} className={extras.shiny === "yes" ? "gts-want-extras-shiny" : ""} />
                                            {extras.shiny === "yes" ? "Shiny" : "Non-shiny"}
                                          </div>
                                        )}
                                        {extras.nature !== null && (
                                          <div className="gts-want-extras-chip">
                                            <FaLeaf size={9} style={{color:"#6ecf8a"}} />
                                            {NATURE_FR[extras.nature] ?? `Nature #${extras.nature}`}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {hasIvs && (
                                      <div className="gts-iv-block" style={{ marginTop: ".25rem" }}>
                                        <div className="gts-iv-head">
                                          <FaDna className="gts-iv-head-ico" aria-hidden />
                                          <span className="gts-iv-head-title">IVs minimum</span>
                                        </div>
                                        <div className="gts-iv-rows">
                                          {([
                                            { key: "hp" as const, label: "PV", Icon: FaHeart, cls: "hp" },
                                            { key: "atk" as const, label: "Atk", Icon: FaHandFist, cls: "atk" },
                                            { key: "def" as const, label: "Déf", Icon: FaShield, cls: "def" },
                                            { key: "spd" as const, label: "Vit", Icon: FaBolt, cls: "spe" },
                                            { key: "spa" as const, label: "Sp.A", Icon: FaWandMagicSparkles, cls: "spa" },
                                            { key: "spd2" as const, label: "Sp.D", Icon: FaShieldHalved, cls: "spd" },
                                          ] as const).map(({ key, label, Icon, cls }) => {
                                            const v = extras.ivs[key];
                                            if (v <= 0) return null;
                                            return (
                                              <div key={key} className="gts-iv-row">
                                                <div className="gts-iv-meta">
                                                  <Icon className="gts-iv-stat-ico" aria-hidden />
                                                  <span className="gts-iv-lab">{label}</span>
                                                </div>
                                                <div className="gts-iv-bar-track" aria-hidden>
                                                  <div
                                                    className={`gts-iv-bar-fill gts-iv-fill--${cls}`}
                                                    style={{ width: `${(v / 31) * 100}%` }}
                                                  />
                                                </div>
                                                <span className="gts-iv-val">{v}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <p className="gts-want-api-note">
                                  <FaCircleInfo className="gts-want-api-note-ico" aria-hidden />
                                  Le serveur GTS n'envoie que l'espèce, la plage de niveau et le genre. Il n'y a pas de
                                  critères nature, talent, objet ou chromatique pour la demande.
                                </p>
                              );
                            })()}
                            <div className="gts-card-details gts-card-details--stack">
                              <div className="gts-detail">
                                <span className="gts-detail-key">
                                  <FaHashtag className="gts-detail-ico" aria-hidden />
                                  ID espèce (jeu / GTS)
                                </span>
                                <span className="gts-detail-value gts-detail-mono">
                                  {entry.wanted.species}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="gts-card-panel gts-card-panel--want gts-card-panel--empty">
                            <div className="gts-card-panel-head">
                              <span className="gts-card-panel-title gts-card-panel-title--icon">
                                <FaArrowRightArrowLeft className="gts-card-panel-ico" aria-hidden />
                                Demandé en retour
                              </span>
                            </div>
                            <p className="gts-card-muted">Critères demandés indisponibles.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          </div>,
          document.body,
        )}

        {/* ─── Tous les dépôts GTS (chargement automatique) ─── */}
          {/* Résultats browse — affichés dès que Supabase a chargé, même pendant le scan */}
          {browseEntries.length > 0 && (
            <section className="gts-browse-section">
              <div className="gts-browse-header">
                <h2 className="gts-section-heading">
                  <FaListUl className="gts-section-heading-icon" />
                  {filteredBrowseEntries.length} dépôt{filteredBrowseEntries.length > 1 ? "s" : ""} sur le GTS
                  {filteredBrowseEntries.length !== browseEntries.length && (
                    <span className="gts-browse-header-total"> (sur {browseEntries.length})</span>
                  )}
                </h2>
                <div className="gts-browse-meta">
                  {browseAgoText && (
                    <span className="gts-browse-timestamp">
                      Mis à jour {browseAgoText}
                    </span>
                  )}
                  {browseLoading && <FaSpinner className="gts-spin" size={11} style={{ color: "rgba(255,255,255,.4)" }} />}
                  <button
                    type="button"
                    className="gts-browse-refresh"
                    onClick={() => void startBrowseScan()}
                    disabled={browseLoading}
                    title="Rafraîchir"
                  >
                    <FaArrowsRotate size={11} />
                  </button>
                </div>
              </div>

              {/* Contrôles tri / filtre shiny */}
              <div className="gts-browse-controls">
                <button
                  type="button"
                  className={`gts-browse-control-btn${filterShiny === "yes" ? " gts-browse-control-btn--active" : ""}`}
                  onClick={() => setFilterShiny((v) => v === "yes" ? "any" : "yes")}
                  title={filterShiny === "yes" ? "Afficher tous les dépôts" : "Afficher uniquement les shinys"}
                >
                  <FaStar size={11} /> Shiny
                </button>
                <button
                  type="button"
                  className="gts-browse-control-btn"
                  onClick={() => setBrowseSortOrder((v) => v === "newest" ? "oldest" : "newest")}
                  title={browseSortOrder === "newest" ? "Trier du plus ancien" : "Trier du plus récent"}
                >
                  <FaArrowDown size={11} style={{ transform: browseSortOrder === "oldest" ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
                  {browseSortOrder === "newest" ? "Plus récents" : "Plus anciens"}
                </button>
              </div>

              <div className="gts-browse-grid">
                {filteredBrowseEntries.map((entry, i) => {
                  const depInfo = resolveBrowseSpecies(entry.depositedSpecies);
                  const depName = depInfo.name;
                  const wantedRaw = entry.wanted ? resolveBrowseSpecies(entry.wanted.species) : null;
                  const wantedInfo = wantedRaw ? { name: wantedRaw.name, sprite: wantedRaw.imageUrl ? fullImageUrl(wantedRaw.imageUrl) : "" } : null;
                  const dep = entry.parsed ?? browseDepositByOnlineId[entry.onlineId];
                  const isShiny = dep?.isShiny === true;
                  const isAltShiny = dep?.isAltShiny === true;
                  const depSpriteBase = depInfo.imageUrl ? fullImageUrl(depInfo.imageUrl) : "";
                  const depShinyKey = dep ? `${dep.speciesInternalId}_${dep.form}` : "";
                  const depAltShinyUrl = dep?.isAltShiny ? altShinySpriteCache[depShinyKey] : null;
                  const depShinyUrl = dep?.isShiny ? shinySpriteCache[depShinyKey] : null;
                  const depSprite = depAltShinyUrl || depShinyUrl || depSpriteBase;

                  return (
                    <button
                      key={`browse-${entry.onlineId}-${i}`}
                      type="button"
                      className={`gts-browse-item${isAltShiny ? " gts-browse-item--alt-shiny" : isShiny ? " gts-browse-item--shiny" : ""}`}
                      style={{ animationDelay: `${Math.min(i, 30) * 0.02}s` }}
                      title={`Voir l'échange #${entry.onlineId} — ${depName}${isAltShiny ? " ✨ Shiny Alt" : isShiny ? " ✨ Shiny" : ""}`}
                      onClick={() => {
                        // Ouvrir directement le popup d'échange
                        const depRow = speciesByInternal.get(entry.depositedSpecies);
                        if (depRow) {
                          setPokemonQuery(`${depRow.name} (#${depRow.id})`);
                          setResolvedPickId(depRow.id);
                        } else {
                          const pName = psdkFrenchNamesRef.current?.[entry.depositedSpecies];
                          if (pName) setPokemonQuery(pName);
                        }
                        setResults([{
                          onlineId: entry.onlineId,
                          wanted: entry.wanted,
                        }]);
                        setSearched(true);
                        setError(null);
                      }}
                    >
                      {/* Badge shiny / alt shiny */}
                      {isAltShiny && (
                        <span className="gts-browse-item-alt-shiny-badge">
                          <FaStar size={9} /> Shiny Alt
                        </span>
                      )}
                      {isShiny && !isAltShiny && (
                        <span className="gts-browse-item-shiny-badge">
                          <FaStar size={9} /> Shiny
                        </span>
                      )}

                      {/* Sprite proposé */}
                      <div className="gts-browse-item-sprite">
                        {depSprite ? (
                          <img src={depSprite} alt="" loading="lazy" />
                        ) : (
                          <span className="gts-browse-item-sprite-fallback"><FaCircleQuestion /></span>
                        )}
                      </div>

                      {/* Infos */}
                      <div className="gts-browse-item-info">
                        <span className="gts-browse-item-name">{depName}</span>
                        <span className="gts-browse-item-id">
                          #{entry.onlineId}
                          {launcherDepositIds.has(String(entry.onlineId)) && (
                            <span className="gts-browse-item-launcher-badge">Launcher</span>
                          )}
                        </span>
                      </div>

                      {/* Flèche échange + demandé */}
                      {entry.wanted && wantedInfo && (
                        <div className="gts-browse-item-want">
                          <FaArrowRightArrowLeft className="gts-browse-item-arrow" />
                          <div className="gts-browse-item-want-sprite">
                            {wantedInfo.sprite ? (
                              <img src={wantedInfo.sprite} alt="" loading="lazy" />
                            ) : (
                              <span className="gts-browse-item-sprite-fallback"><FaCircleQuestion size={12} /></span>
                            )}
                          </div>
                          <span className="gts-browse-item-want-name">{wantedInfo.name}</span>
                        </div>
                      )}

                      <FaMagnifyingGlass className="gts-browse-item-go" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* État vide browse */}
          {!browseLoading && browseEntries.length === 0 && browseLastFetchTime > 0 && (
            <section className="gts-empty hero">
              <div className="gts-empty-icon-wrap">
                <FaListUl className="gts-empty-icon" />
              </div>
              <p className="gts-empty-title">Aucun dépôt trouvé</p>
              <p className="gts-empty-desc">Il n'y a aucun Pokémon déposé sur le GTS pour le moment.</p>
            </section>
          )}

        </>
        )}
      </div>

      {/* Animation de retrait GTS */}
      {showWithdrawAnim && withdrawAnimInfo && (
        <GtsTransferAnim
          mode="withdraw"
          spriteUrl={withdrawAnimInfo.spriteUrl}
          pokemonName={withdrawAnimInfo.name}
          isShiny={withdrawAnimInfo.isShiny}
          isAltShiny={withdrawAnimInfo.isAltShiny}
          boxName={withdrawAnimInfo.boxName}
          onComplete={() => {
            setShowWithdrawAnim(false);
            setWithdrawAnimInfo(null);
            setWithdrawAction("idle");
            setWithdrawBoxName(null);
            checkMyDeposit();
          }}
        />
      )}

      {/* ─── Popup : Échange effectué (trade detected) ─── */}
      {showTradedPopup && myDeposit && createPortal(
        <div className="gts-traded-popup-overlay" onClick={() => setShowTradedPopup(false)}>
          <div className="gts-traded-popup" onClick={(e) => e.stopPropagation()}>
            <div className="gts-traded-popup-icon">🎉</div>
            <h2 className="gts-traded-popup-title">Félicitations !</h2>
            <p className="gts-traded-popup-subtitle">Votre échange a bien été effectué !</p>
            <p className="gts-traded-popup-desc">Un dresseur a accepté votre offre. Voici votre nouveau Pokémon :</p>
            <div className={`gts-traded-popup-pokemon${myDeposit.isAltShiny ? " gts-traded-popup-pokemon--alt-shiny" : myDeposit.isShiny ? " gts-traded-popup-pokemon--shiny" : ""}`}>
              <div className="gts-traded-popup-sprite">
                {(() => {
                  const depRow = speciesByInternal.get(myDeposit.speciesInternalId);
                  const normalUrl = depRow?.imageUrl ? fullImageUrl(depRow.imageUrl) : null;
                  const shinyKey = `${myDeposit.speciesInternalId}_${myDeposit.form}`;
                  const altShinyUrl = myDeposit.isAltShiny ? altShinySpriteCache[shinyKey] : null;
                  const shinyUrl = myDeposit.isShiny ? shinySpriteCache[shinyKey] : null;
                  const sprUrl = altShinyUrl || shinyUrl || normalUrl;
                  return sprUrl ? <img src={sprUrl} alt="" /> : <span style={{fontSize:32}}>?</span>;
                })()}
              </div>
              <div className="gts-traded-popup-info">
                <span className="gts-traded-popup-name">
                  {(() => {
                    const depRow = speciesByInternal.get(myDeposit.speciesInternalId);
                    return depRow?.name ?? (psdkFrenchNamesRef.current?.[myDeposit.speciesInternalId] ?? `#${myDeposit.speciesInternalId}`);
                  })()}
                </span>
                {myDeposit.isAltShiny && (
                  <span className="gts-traded-popup-alt-shiny-badge">
                    <FaStar size={9} /> Shiny Alt
                  </span>
                )}
                {myDeposit.isShiny && !myDeposit.isAltShiny && (
                  <span className="gts-traded-popup-shiny-badge">
                    <FaStar size={9} /> Shiny
                  </span>
                )}
                <span className="gts-traded-popup-level">Nv. {myDeposit.level}</span>
                <span className="gts-traded-popup-nature">{NATURE_FR[myDeposit.nature] ?? ""}</span>
              </div>
            </div>
            <div className="gts-traded-popup-actions">
              <button
                type="button"
                className="gts-traded-popup-btn gts-traded-popup-btn--recover"
                onClick={() => { setShowTradedPopup(false); withdrawMyDeposit(false); }}
              >
                <FaArrowDown size={11} /> Récupérer maintenant
              </button>
              <button
                type="button"
                className="gts-traded-popup-btn gts-traded-popup-btn--later"
                onClick={() => setShowTradedPopup(false)}
              >
                Plus tard
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Trade confirmation dialog (portal) ─── */}
      {tradeStep === "confirm" && tradePoke && tradeTarget && (() => {
        const dep = depositByOnlineId[tradeTarget.onlineId];
        const depRow = dep ? speciesByInternal.get(dep.speciesInternalId) : null;
        const depImg = depRow?.imageUrl;
        const theirSprUrl = depImg
          ? (depImg.startsWith("http") ? depImg : `${base}${depImg.startsWith("/") ? "" : "/"}${depImg}`)
          : null;
        const mySpeciesId = typeof tradePoke.code === "string" ? parseInt(tradePoke.code, 10) : (tradePoke.code ?? 0);
        const myRow = speciesByInternal.get(mySpeciesId);
        const myImg = myRow?.imageUrl;
        const mySprUrl = myImg
          ? (myImg.startsWith("http") ? myImg : `${base}${myImg.startsWith("/") ? "" : "/"}${myImg}`)
          : null;

        const myIvTotal = (tradePoke.ivHp ?? 0) + (tradePoke.ivAtk ?? 0) + (tradePoke.ivDfe ?? 0) + (tradePoke.ivSpd ?? 0) + (tradePoke.ivAts ?? 0) + (tradePoke.ivDfs ?? 0);
        const theirIvTotal = dep ? ((dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0)) : 0;
        const myNatureName = tradePoke.nature != null ? (NATURE_FR[tradePoke.nature] ?? null) : null;
        const theirNatureName = dep?.nature != null ? (NATURE_FR[dep.nature] ?? null) : null;

        // Validation des critères (base GTS + extras launcher)
        const tradeExtras = extrasByOnlineId[tradeTarget.onlineId] ?? null;
        const criteriaViolations = validateTradeCriteria(tradePoke, tradeExtras, tradeTarget.wanted);

        // Sprite shiny pour le Pokémon envoyé (depuis PC)
        const myShinyKey = `${mySpeciesId}_${tradePoke.form ?? 0}`;
        const myShinyUrl = tradePoke.isShiny ? shinySpriteCache[myShinyKey] : null;
        const myFinalSprUrl = (tradePoke.isShiny && myShinyUrl) ? myShinyUrl : mySprUrl;

        // Sprite shiny pour le Pokémon reçu (depuis GTS)
        const theirShinyKey = dep ? `${dep.speciesInternalId}_${dep.form}` : "";
        const theirShinyUrl = dep?.isShiny ? shinySpriteCache[theirShinyKey] : null;
        const theirFinalSprUrl = (dep?.isShiny && theirShinyUrl) ? theirShinyUrl : theirSprUrl;

        return createPortal(
          <div className="gts-confirm-overlay" onClick={cancelTrade}>
            <div className="gts-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h2 className="gts-confirm-title">
                <FaArrowRightArrowLeft style={{ fontSize: ".9em" }} />
                Confirmer l'échange
              </h2>

              <div className="gts-confirm-cards">
                {/* ─── Mon Pokémon (départ) ─── */}
                <div className={`gts-confirm-card gts-confirm-card--mine${tradePoke.isAltShiny ? " gts-confirm-card--alt-shiny" : tradePoke.isShiny ? " gts-confirm-card--shiny" : ""}`}>
                  <div className="gts-confirm-card-label">Vous envoyez</div>
                  <div className="gts-confirm-card-sprite">
                    {myFinalSprUrl ? <img src={myFinalSprUrl} alt="" /> : <span className="gts-confirm-card-placeholder">?</span>}
                  </div>
                  <div className="gts-confirm-card-name">{tradePoke.nickname || resolveSpeciesName(mySpeciesId)}</div>
                  <div className="gts-confirm-card-level">Nv. {tradePoke.level ?? "?"}</div>
                  <div className="gts-confirm-card-tags">
                    {tradePoke.isAltShiny && <span className="gts-confirm-tag gts-confirm-tag--alt-shiny"><FaStar /> Shiny Alt</span>}
                    {tradePoke.isShiny && !tradePoke.isAltShiny && <span className="gts-confirm-tag gts-confirm-tag--shiny"><FaStar /> Shiny</span>}
                    {myNatureName && <span className="gts-confirm-tag">{myNatureName}</span>}
                    <span className="gts-confirm-tag">IV: {myIvTotal}/186</span>
                  </div>
                </div>

                {/* ─── Flèche ─── */}
                <div className="gts-confirm-arrow">
                  <FaArrowRightArrowLeft />
                </div>

                {/* ─── Leur Pokémon (réception) ─── */}
                <div className={`gts-confirm-card gts-confirm-card--theirs${dep?.isAltShiny ? " gts-confirm-card--alt-shiny" : dep?.isShiny ? " gts-confirm-card--shiny" : ""}`}>
                  <div className="gts-confirm-card-label">Vous recevez</div>
                  <div className="gts-confirm-card-sprite">
                    {theirFinalSprUrl ? <img src={theirFinalSprUrl} alt="" /> : <span className="gts-confirm-card-placeholder">?</span>}
                  </div>
                  <div className="gts-confirm-card-name">{dep ? resolveSpeciesName(dep.speciesInternalId, dep.nickname) : "?"}</div>
                  <div className="gts-confirm-card-level">Nv. {dep?.level ?? "?"}</div>
                  <div className="gts-confirm-card-tags">
                    {dep?.isAltShiny && <span className="gts-confirm-tag gts-confirm-tag--alt-shiny"><FaStar /> Shiny Alt</span>}
                    {dep?.isShiny && !dep?.isAltShiny && <span className="gts-confirm-tag gts-confirm-tag--shiny"><FaStar /> Shiny</span>}
                    {theirNatureName && <span className="gts-confirm-tag">{theirNatureName}</span>}
                    {dep && <span className="gts-confirm-tag">IV: {theirIvTotal}/186</span>}
                  </div>
                </div>
              </div>

              {tradePoke.isShiny && (
                <div className="gts-confirm-warning">
                  <FaStar style={{ color: "#facc15" }} />
                  Attention : vous envoyez un Pokémon Shiny !
                </div>
              )}

              {criteriaViolations.length > 0 && (
                <div className="gts-violations">
                  <div className="gts-violations-header">
                    <FaWarn2 /> Critères non respectés
                  </div>
                  <div className="gts-violations-row gts-violations-row--head">
                    <span className="gts-violations-cell">Critère</span>
                    <span className="gts-violations-cell gts-violations-cell--demanded">Demandé</span>
                    <span className="gts-violations-cell" style={{ justifyContent: "center" }}>Votre Pokémon</span>
                  </div>
                  {criteriaViolations.map((v, i) => (
                    <div key={i} className="gts-violations-row">
                      <span className="gts-violations-cell gts-violations-cell--label">
                        <span className="gts-violations-ico gts-violations-ico--fail"><FaXmark /></span>
                        {v.label}
                      </span>
                      <span className="gts-violations-cell gts-violations-cell--demanded">{v.demanded}</span>
                      <span className="gts-violations-cell gts-violations-cell--actual gts-violations-cell--fail">{v.actual}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="gts-confirm-notice">
                Votre Pokémon sera retiré de votre sauvegarde.
              </p>

              <div className="gts-confirm-buttons">
                <button
                  className="gts-confirm-btn gts-confirm-btn--confirm"
                  onClick={executeTrade}
                  disabled={criteriaViolations.length > 0}
                  style={criteriaViolations.length > 0 ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                >
                  <FaArrowRightArrowLeft /> Confirmer l'échange
                </button>
                <button className="gts-confirm-btn gts-confirm-btn--cancel" onClick={cancelTrade}>
                  Annuler
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* ─── Trade in progress overlay ─── */}
      {tradeStep === "trading" && createPortal(
        <div className="gts-swap-overlay">
          <FaSpinner className="gts-spinner" style={{ fontSize: "2rem", color: "rgba(100,180,255,.8)" }} />
          <p style={{ color: "rgba(255,255,255,.7)", marginTop: "1rem" }}>Échange en cours...</p>
        </div>,
        document.body,
      )}

      {/* ─── Trade error overlay ─── */}
      {tradeStep === "error" && tradeError && createPortal(
        <div className="gts-swap-overlay" onClick={cancelTrade}>
          <div className="gts-swap-result" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "#ef4444" }}>Erreur</h2>
            <p style={{ color: "rgba(255,255,255,.7)", marginBottom: "1rem" }}>{tradeError}</p>
            <button className="gts-action-btn" onClick={cancelTrade}>Fermer</button>
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Swap animation ─── */}
      {showTradeAnim && tradeAnimInfo && (
        <GtsSwapAnim
          mySpriteUrl={tradeAnimInfo.mySpriteUrl}
          myName={tradeAnimInfo.myName}
          myShiny={tradeAnimInfo.myShiny}
          myAltShiny={tradeAnimInfo.myAltShiny}
          theirSpriteUrl={tradeAnimInfo.theirSpriteUrl}
          theirName={tradeAnimInfo.theirName}
          theirShiny={tradeAnimInfo.theirShiny}
          theirAltShiny={tradeAnimInfo.theirAltShiny}
          boxName={tradeAnimInfo.boxName}
          onComplete={() => {
            setShowTradeAnim(false);
            setTradeAnimInfo(null);
            cancelTrade();
            // Relancer la recherche
            if (resolvedPickId) {
              doSearch();
            }
          }}
        />
      )}

      {/* ─── Wishlist Gate Popup ─── */}
      {wishlistGateReason && createPortal(
        <div className="gts-editmod-overlay" onClick={() => setWishlistGateReason(null)}>
          <div className="gts-wish-gate" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gts-editmod-close" onClick={() => setWishlistGateReason(null)}>✕</button>
            <div className="gts-wish-gate-icon">
              {wishlistGateReason === "login" ? <FaBell size={24} /> : <FaHeart size={24} />}
            </div>
            <h2 className="gts-wish-gate-title">
              {wishlistGateReason === "login" ? "Connexion requise" : "Fonctionnalité Patreon"}
            </h2>
            <p className="gts-wish-gate-desc">
              {wishlistGateReason === "login"
                ? "Connectez-vous au Chat PNW pour accéder à la Wishlist GTS et recevoir des notifications quand un Pokémon recherché est déposé."
                : "La Wishlist GTS est une fonctionnalité exclusive réservée aux supporters Patreon. Soutenez le projet pour débloquer les notifications automatiques de dépôts !"
              }
            </p>
            <div className="gts-wish-gate-features">
              <div className="gts-wish-gate-feature"><FaBell size={10} /> Notifications de dépôts</div>
              <div className="gts-wish-gate-feature"><FaMagnifyingGlass size={10} /> Suivi de 5 Pokémon</div>
              <div className="gts-wish-gate-feature"><FaStar size={10} /> Filtres shiny, nature, IV…</div>
            </div>
            <button
              type="button"
              className="gts-wish-gate-btn"
              onClick={() => setWishlistGateReason(null)}
            >
              {wishlistGateReason === "login" ? "Compris" : "Compris"}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Wishlist Modal ─── */}
      {showWishlist && isPatreon && chatProfile && createPortal(
        <div className="gts-editmod-overlay" onClick={() => setShowWishlist(false)}>
          <div className="gts-wish-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gts-editmod-close" onClick={() => setShowWishlist(false)}>✕</button>

            {/* Header */}
            <div className="gts-wish-header">
              <div className="gts-wish-header-icon"><FaBell size={16} /></div>
              <div>
                <h2 className="gts-wish-title">Wishlist GTS</h2>
                <p className="gts-wish-subtitle">Recevez une notification quand un Pokémon correspondant est déposé</p>
              </div>
              <span className="gts-wish-patreon-badge"><FaHeart size={8} /> Patreon</span>
            </div>

            {/* Liste existante + matchs */}
            <div className="gts-wish-list">
              {wishlists.length === 0 ? (
                <div className="gts-wish-empty">
                  <FaBell size={20} style={{ opacity: .2 }} />
                  <p>Aucune recherche enregistrée</p>
                  <span>Ajoutez un Pokémon ci-dessous pour être notifié !</span>
                </div>
              ) : wishlists.map((w) => {
                const specRow = speciesByInternal.get(w.wanted_species);
                const specName = specRow?.name ?? (psdkFrenchNamesRef.current?.[w.wanted_species] ?? `#${w.wanted_species}`);
                const sprUrl = specRow?.imageUrl ? fullImageUrl(specRow.imageUrl) : null;
                // Trouver les dépôts qui matchent cette wishlist
                const matches = browseEntries.filter((entry) => {
                  if (!entry.parsed) return false;
                  if (entry.depositedSpecies !== w.wanted_species) return false;
                  const dep = entry.parsed;
                  if (w.wanted_shiny === "yes" && !dep.isShiny && !dep.isAltShiny) return false;
                  if (w.wanted_shiny === "no" && (dep.isShiny || dep.isAltShiny)) return false;
                  if (w.wanted_nature !== null && dep.nature !== w.wanted_nature) return false;
                  if (w.wanted_gender > 0 && dep.gender !== w.wanted_gender) return false;
                  const ivTotal = (dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0);
                  if (w.wanted_iv_min > 0 && ivTotal < w.wanted_iv_min) return false;
                  return true;
                });
                const isExpanded = wishExpandedIds.has(w.id);
                const toggleExpand = () => {
                  setWishExpandedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                    return next;
                  });
                  // Marquer les matchs comme vus quand on ouvre
                  if (!isExpanded && matches.length > 0) {
                    setWishSeenOids((prev) => {
                      const next = new Set(prev);
                      for (const m of matches) next.add(m.onlineId);
                      return next;
                    });
                  }
                };
                return (
                  <div key={w.id} className={`gts-wish-entry${matches.length > 0 ? " gts-wish-entry--has-matches" : ""}${isExpanded ? " gts-wish-entry--open" : ""}`}>
                    <div className="gts-wish-item" onClick={matches.length > 0 ? toggleExpand : undefined} style={matches.length > 0 ? { cursor: "pointer" } : undefined}>
                      {matches.length > 0 && (
                        <span className={`gts-wish-chevron${isExpanded ? " gts-wish-chevron--open" : ""}`}>
                          <FaArrowDown size={8} />
                        </span>
                      )}
                      <div className="gts-wish-item-sprite">
                        {sprUrl ? <img src={sprUrl} alt="" /> : <FaCircleQuestion size={18} style={{ color: "rgba(255,255,255,.2)" }} />}
                      </div>
                      <div className="gts-wish-item-info">
                        <span className="gts-wish-item-name">{specName}</span>
                        <div className="gts-wish-item-chips">
                          {w.wanted_shiny === "yes" && <span className="gts-wish-chip gts-wish-chip--shiny"><FaStar size={7} /> Shiny</span>}
                          {w.wanted_shiny === "no" && <span className="gts-wish-chip">Non-shiny</span>}
                          {w.wanted_nature !== null && <span className="gts-wish-chip"><FaLeaf size={7} /> {NATURE_FR[w.wanted_nature]}</span>}
                          {w.wanted_iv_min > 0 && <span className="gts-wish-chip"><FaDna size={7} /> IV≥{w.wanted_iv_min}</span>}
                          {w.wanted_gender === 1 && <span className="gts-wish-chip"><FaMars size={7} style={{ color: "#60a5fa" }} /> Mâle</span>}
                          {w.wanted_gender === 2 && <span className="gts-wish-chip"><FaVenus size={7} style={{ color: "#f472b6" }} /> Femelle</span>}
                        </div>
                      </div>
                      {(() => {
                        const unseenCount = matches.filter((m) => !wishSeenOids.has(m.onlineId)).length;
                        return unseenCount > 0 ? (
                          <span className="gts-wish-match-count gts-wish-match-count--new">{unseenCount}</span>
                        ) : matches.length > 0 ? (
                          <span className="gts-wish-match-count">{matches.length}</span>
                        ) : null;
                      })()}
                      <button
                        type="button"
                        className="gts-wish-item-delete"
                        title="Supprimer"
                        onClick={(e) => {
                          e.stopPropagation();
                          supabaseGts.from("gts_wishlists").delete().eq("id", w.id)
                            .then(() => setWishlists((prev) => prev.filter((x) => x.id !== w.id)));
                        }}
                      ><FaTrash size={10} /></button>
                    </div>
                    {/* Dépôts correspondants (dropdown) */}
                    {matches.length > 0 && isExpanded && (
                      <div className="gts-wish-matches">
                        <div className="gts-wish-matches-label"><FaBolt size={8} /> {matches.length} dépôt{matches.length > 1 ? "s" : ""} disponible{matches.length > 1 ? "s" : ""}</div>
                        {matches.slice(0, 10).map((entry) => {
                          const dep = entry.parsed!;
                          const depRow = speciesByInternal.get(entry.depositedSpecies);
                          const depSprite = depRow?.imageUrl ? fullImageUrl(depRow.imageUrl) : "";
                          const depName = depRow?.name ?? psdkFrenchNamesRef.current?.[entry.depositedSpecies] ?? `#${entry.depositedSpecies}`;
                          const ivTotal = (dep.ivHp ?? 0) + (dep.ivAtk ?? 0) + (dep.ivDfe ?? 0) + (dep.ivSpd ?? 0) + (dep.ivAts ?? 0) + (dep.ivDfs ?? 0);
                          const wantedRow = entry.wanted ? speciesByInternal.get(entry.wanted.species) : null;
                          const wantedName = entry.wanted ? (wantedRow?.name ?? psdkFrenchNamesRef.current?.[entry.wanted.species] ?? `#${entry.wanted.species}`) : "?";
                          return (
                            <button
                              key={entry.onlineId}
                              type="button"
                              className="gts-wish-match-card"
                              onClick={() => { setShowWishlist(false); setDirectSearchInternalId(entry.depositedSpecies); setSearchTrigger((v) => v + 1); }}
                            >
                              <div className="gts-wish-match-sprite">
                                {depSprite ? <img src={depSprite} alt="" /> : <FaCircleQuestion size={14} style={{ color: "rgba(255,255,255,.15)" }} />}
                              </div>
                              <div className="gts-wish-match-info">
                                <span className="gts-wish-match-name">
                                  {depName}
                                  {dep.isAltShiny && <FaStar size={7} style={{ color: "#ff6b6b", filter: "drop-shadow(0 0 4px rgba(255,107,107,.6))" }} />}
                                  {dep.isShiny && !dep.isAltShiny && <FaStar size={7} style={{ color: "#f1c40f", filter: "drop-shadow(0 0 4px rgba(241,196,15,.6))" }} />}
                                </span>
                                <div className="gts-wish-match-details">
                                  <span>Nv. {dep.level}</span>
                                  <span>{NATURE_FR[dep.nature] ?? ""}</span>
                                  {dep.gender === 1 && <span style={{ color: "#60a5fa" }}>♂</span>}
                                  {dep.gender === 2 && <span style={{ color: "#f472b6" }}>♀</span>}
                                  <span style={{ color: "rgba(255,255,255,.35)" }}>IV {ivTotal}/186</span>
                                </div>
                              </div>
                              <div className="gts-wish-match-wanted">
                                <FaArrowRightArrowLeft size={8} style={{ color: "rgba(255,255,255,.2)" }} />
                                <span>{wantedName}</span>
                              </div>
                              <FaMagnifyingGlass className="gts-wish-match-go" size={10} />
                            </button>
                          );
                        })}
                        {matches.length > 10 && (
                          <div className="gts-wish-matches-more">+ {matches.length - 10} autre{matches.length - 10 > 1 ? "s" : ""}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Compteur */}
            <div className="gts-wish-counter">{wishlists.length} / 5 recherches</div>

            {/* Formulaire d'ajout */}
            {wishlists.length < 5 && (
              <div className="gts-wish-add">
                <div className="gts-wish-add-title"><FaPlus size={9} /> Nouvelle recherche</div>
                <div className="gts-wish-add-grid">
                  <div className="gts-field gts-wish-add-field--pokemon" ref={wishSuggestRef}>
                    <label className="gts-label">Pokémon recherché</label>
                    <div className="gts-autocomplete-wrap">
                      <FaMagnifyingGlass className="gts-input-icon" />
                      <input
                        type="text"
                        className="gts-input gts-input--with-icon gts-input--compact"
                        placeholder={dexLoading ? "Chargement du Pokédex…" : "Nom ou numéro…"}
                        autoComplete="off"
                        disabled={dexLoading}
                        value={wishSpeciesQuery}
                        onChange={(e) => {
                          setWishSpeciesQuery(e.target.value);
                          setWishSpeciesId(null);
                          setWishSuggestOpen(true);
                        }}
                        onFocus={() => setWishSuggestOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setWishSuggestOpen(false);
                        }}
                      />
                    </div>
                    {wishSuggestOpen && !dexLoading && dexRows.length > 0 && (() => {
                      const pokedexRows = wishFilteredDexRows.filter((r) => !r.isExtradex);
                      const extradexRows = wishFilteredDexRows.filter((r) => r.isExtradex);
                      const renderRow = (row: DexRow, idx: number) => {
                        const sprite = row.imageUrl ? fullImageUrl(row.imageUrl) : "";
                        return (
                          <li key={`wish-${row.id}-${normalizeName(row.name)}-${idx}`}>
                            <button
                              type="button"
                              className="gts-suggest-item"
                              role="option"
                              onClick={() => pickWishPokemon(row)}
                            >
                              <span className="gts-suggest-thumb-wrap">
                                {sprite ? (
                                  <img src={sprite} alt="" className="gts-suggest-thumb" loading="lazy" />
                                ) : (
                                  <span className="gts-suggest-thumb gts-suggest-thumb--empty" aria-hidden />
                                )}
                              </span>
                              <span className="gts-suggest-num">
                                {row.isExtradex ? (
                                  <span className="gts-suggest-extradex-badge">EX</span>
                                ) : (
                                  <FaHashtag className="gts-suggest-hash" />
                                )}
                                {row.isExtradex ? row.extradexNum : row.id}
                              </span>
                              <span className="gts-suggest-name">{row.name}</span>
                            </button>
                          </li>
                        );
                      };
                      return pokedexRows.length === 0 && extradexRows.length === 0 ? (
                        <div className="gts-wish-suggest-list">
                          <p className="gts-suggest-empty">Aucun Pokémon ne correspond à cette recherche.</p>
                        </div>
                      ) : (
                        <div className="gts-wish-suggest-columns">
                          <div className="gts-suggest-col pnw-scrollbar">
                            <div className="gts-suggest-col-header">Pokédex</div>
                            <ul className="gts-suggest-col-list" role="listbox">
                              {pokedexRows.length === 0 ? (
                                <li className="gts-suggest-empty">Aucun résultat</li>
                              ) : pokedexRows.map(renderRow)}
                            </ul>
                          </div>
                          <div className="gts-suggest-col gts-suggest-col--extradex pnw-scrollbar">
                            <div className="gts-suggest-col-header gts-suggest-col-header--extradex">Extradex</div>
                            <ul className="gts-suggest-col-list" role="listbox">
                              {extradexRows.length === 0 ? (
                                <li className="gts-suggest-empty">Aucun résultat</li>
                              ) : extradexRows.map(renderRow)}
                            </ul>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="gts-field">
                    <label className="gts-label">Shiny</label>
                    <CustomSelect
                      value={wishShiny}
                      onChange={(v) => setWishShiny(v as "any" | "yes" | "no")}
                      options={[
                        { value: "any", label: "Indifférent" },
                        { value: "yes", label: "Shiny", icon: <FaStar size={8} style={{ color: "#f0c420" }} /> },
                        { value: "no", label: "Non-shiny" },
                      ]}
                    />
                  </div>
                  <div className="gts-field">
                    <label className="gts-label">Nature</label>
                    <CustomSelect
                      value={wishNature !== null ? String(wishNature) : ""}
                      onChange={(v) => setWishNature(v === "" ? null : Number(v))}
                      options={[
                        { value: "", label: "Indifférent" },
                        ...NATURE_FR.map((n, i) => ({ value: String(i), label: n })),
                      ]}
                    />
                  </div>
                  <div className="gts-field">
                    <label className="gts-label">Genre</label>
                    <CustomSelect
                      value={String(wishGender)}
                      onChange={(v) => setWishGender(Number(v))}
                      options={[
                        { value: "0", label: "Indifférent" },
                        { value: "1", label: "Mâle", icon: <FaMars size={9} style={{ color: "#60a5fa" }} /> },
                        { value: "2", label: "Femelle", icon: <FaVenus size={9} style={{ color: "#f472b6" }} /> },
                      ]}
                    />
                  </div>
                  <div className="gts-field">
                    <label className="gts-label">IV total min</label>
                    <input
                      type="number" min={0} max={186}
                      className="gts-input gts-input--compact"
                      value={wishIvMin}
                      onChange={(e) => setWishIvMin(Number(e.target.value))}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="gts-wish-add-btn"
                  disabled={!wishSpeciesId}
                  onClick={() => {
                    if (!wishSpeciesId || !chatProfile?.id) return;
                    const specRow = dexRows.find((r) => r.id === wishSpeciesId);
                    const internalId = specRow ? ([...speciesByInternal.entries()].find(([, v]) => v.id === specRow.id)?.[0] ?? wishSpeciesId) : wishSpeciesId;
                    supabaseGts.from("gts_wishlists").insert([{
                      chat_user_id: chatProfile.id,
                      wanted_species: internalId,
                      wanted_shiny: wishShiny,
                      wanted_nature: wishNature,
                      wanted_iv_min: wishIvMin,
                      wanted_gender: wishGender,
                    }]).select().then(({ data }) => {
                      if (data) setWishlists((prev) => [...prev, ...(data as GtsWishlist[])]);
                      setWishSpeciesQuery(""); setWishSpeciesId(null);
                      setWishShiny("any"); setWishNature(null); setWishIvMin(0); setWishGender(0);
                    });
                  }}
                >
                  <FaPlus size={10} /> Ajouter à la wishlist
                </button>
              </div>
            )}
            {wishlists.length >= 5 && (
              <div className="gts-wish-limit">Limite de 5 recherches atteinte</div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ─── Historique des échanges ─── */}
      {showHistory && createPortal(
        <div className="gts-anim-overlay" onClick={() => setShowHistory(false)}>
          <div
            className="gts-history-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gts-history-header">
              <FaClockRotateLeft style={{ color: "#64b5f6" }} />
              <h2>Historique des échanges</h2>
              <span className="gts-history-count">{tradeHistory.length} échange{tradeHistory.length > 1 ? "s" : ""}</span>
              <button className="gts-modal-close" onClick={() => setShowHistory(false)}>✕</button>
            </div>

            {tradeHistory.length === 0 ? (
              <div className="gts-history-empty">
                <FaArrowRightArrowLeft style={{ fontSize: "2rem", opacity: 0.15, marginBottom: ".5rem" }} />
                <p>Aucun échange effectué pour le moment.</p>
              </div>
            ) : (() => {
              const totalPages = Math.ceil(tradeHistory.length / HISTORY_PER_PAGE);
              const pageEntries = tradeHistory.slice(historyPage * HISTORY_PER_PAGE, (historyPage + 1) * HISTORY_PER_PAGE);

              // Helper: résoudre nom + sprite depuis species ID
              const resolvePokeInfo = (p: any) => {
                const specId = p?.species ?? 0;
                const row = specId ? speciesByInternal.get(specId) : null;
                const resolvedName = p?.name && p.name !== "?" ? p.name : (row?.name ?? psdkFrenchNamesRef.current?.[specId] ?? `#${specId}`);
                const normalUrl = row?.imageUrl ? fullImageUrl(row.imageUrl) : (p?.spriteUrl ?? null);
                // Priorité : shinySpriteUrl stocké > shinySpriteCache > spriteUrl stocké > normalUrl
                if (p?.shiny) {
                  if (p.shinySpriteUrl) return { name: resolvedName, spriteUrl: p.shinySpriteUrl };
                  const shinyKey = `${specId}_${p?.form ?? 0}`;
                  const cachedShiny = shinySpriteCache[shinyKey];
                  if (cachedShiny) return { name: resolvedName, spriteUrl: cachedShiny };
                  // Le spriteUrl stocké peut déjà être le shiny (nouveau format)
                  if (p.spriteUrl && p.spriteUrl.startsWith("data:")) return { name: resolvedName, spriteUrl: p.spriteUrl };
                }
                return { name: resolvedName, spriteUrl: p?.spriteUrl || normalUrl };
              };

              return (
                <>
                  <div className="gts-history-list">
                    {pageEntries.map((entry, i) => {
                      const s = entry.sent ?? {};
                      const r = entry.received ?? {};
                      const sInfo = resolvePokeInfo(s);
                      const rInfo = resolvePokeInfo(r);
                      const date = entry.date ? new Date(entry.date) : null;
                      const dateStr = date
                        ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
                        + " à " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                        : "";
                      const genderIcon = (g: number | undefined) =>
                        g === 0 ? "♂" : g === 1 ? "♀" : "";
                      const genderColor = (g: number | undefined) =>
                        g === 0 ? "#42a5f5" : g === 1 ? "#ec407a" : "transparent";
                      const sNature = typeof s.nature === "number" ? (NATURE_FR[s.nature] ?? "") : "";
                      const rNature = typeof r.nature === "number" ? (NATURE_FR[r.nature] ?? "") : "";

                      return (
                        <div key={`h${historyPage}-${i}`} className="gts-history-entry">
                          {/* Pokémon envoyé */}
                          <div className="gts-history-pokemon gts-history-sent">
                            <span className="gts-history-label">Envoyé</span>
                            <div className="gts-history-sprite-wrap">
                              {sInfo.spriteUrl ? (
                                <img src={sInfo.spriteUrl} alt={sInfo.name} className="gts-history-sprite" />
                              ) : (
                                <div className="gts-history-sprite gts-history-sprite--placeholder">?</div>
                              )}
                              {s.altShiny && <span className="gts-history-alt-shiny-star">★</span>}
                              {s.shiny && !s.altShiny && <span className="gts-history-shiny-star">★</span>}
                            </div>
                            <span className="gts-history-name">{sInfo.name}</span>
                            <div className="gts-history-tags">
                              <span className="gts-history-tag">Nv. {s.level ?? "?"}</span>
                              {genderIcon(s.gender) && (
                                <span className="gts-history-tag" style={{ color: genderColor(s.gender) }}>
                                  {genderIcon(s.gender)}
                                </span>
                              )}
                              {sNature && <span className="gts-history-tag">{sNature}</span>}
                              {typeof s.ivTotal === "number" && (
                                <span className="gts-history-tag">IV: {s.ivTotal}/186</span>
                              )}
                            </div>
                            {s.trainerName && (
                              <span className="gts-history-do">D.O. {s.trainerName}</span>
                            )}
                          </div>

                          {/* Flèche swap */}
                          <div className="gts-history-arrow">
                            <FaArrowRightArrowLeft />
                          </div>

                          {/* Pokémon reçu */}
                          <div className="gts-history-pokemon gts-history-recv">
                            <span className="gts-history-label">Reçu</span>
                            <div className="gts-history-sprite-wrap">
                              {rInfo.spriteUrl ? (
                                <img src={rInfo.spriteUrl} alt={rInfo.name} className="gts-history-sprite" />
                              ) : (
                                <div className="gts-history-sprite gts-history-sprite--placeholder">?</div>
                              )}
                              {r.altShiny && <span className="gts-history-alt-shiny-star">★</span>}
                              {r.shiny && !r.altShiny && <span className="gts-history-shiny-star">★</span>}
                            </div>
                            <span className="gts-history-name">{rInfo.name}</span>
                            <div className="gts-history-tags">
                              <span className="gts-history-tag">Nv. {r.level ?? "?"}</span>
                              {genderIcon(r.gender) && (
                                <span className="gts-history-tag" style={{ color: genderColor(r.gender) }}>
                                  {genderIcon(r.gender)}
                                </span>
                              )}
                              {rNature && <span className="gts-history-tag">{rNature}</span>}
                              {typeof r.ivTotal === "number" && (
                                <span className="gts-history-tag">IV: {r.ivTotal}/186</span>
                              )}
                            </div>
                            {r.trainerName && (
                              <span className="gts-history-do">D.O. {r.trainerName}</span>
                            )}
                          </div>

                          {/* Métadonnées */}
                          <div className="gts-history-meta">
                            <span className="gts-history-date">{dateStr}</span>
                            {entry.boxName && <span className="gts-history-box">→ {entry.boxName}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="gts-history-pagination">
                      <button
                        className="gts-history-page-btn"
                        disabled={historyPage === 0}
                        onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                      >
                        ‹ Précédent
                      </button>
                      <span className="gts-history-page-info">
                        {historyPage + 1} / {totalPages}
                      </span>
                      <button
                        className="gts-history-page-btn"
                        disabled={historyPage >= totalPages - 1}
                        onClick={() => setHistoryPage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        Suivant ›
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>,
        document.body,
      )}
    </main>
  );
}
