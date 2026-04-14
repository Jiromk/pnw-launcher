import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  FaArrowLeft,
  FaChevronLeft,
  FaChevronRight,
  FaBoxOpen,
  FaStar,
  FaMars,
  FaVenus,
  FaHeart,
  FaHandFist,
  FaShield,
  FaBolt,
  FaWandMagicSparkles,
  FaShieldHalved,
  FaXmark,
  FaBoxesStacked,
  FaLayerGroup,
  FaDna,
  FaChartPie,
  FaLeaf,
  FaMagnifyingGlass,
  FaUpload,
  FaTriangleExclamation,
  FaCheck,
  FaSpinner,
  FaHashtag,
} from "react-icons/fa6";
import type { PlayerProfile, PCBox, BoxPokemon } from "../types";
import { NATURE_FR } from "../gtsDepositedPokemon";
import { normalizeName } from "../utils/pokedexLookup";
import GtsTransferAnim from "../components/GtsTransferAnim";
import { dump } from "@hyrious/marshal";
import {
  loadSaveForEdit,
  extractPokemonFromBox,
  encodePokemonForGts,
  patchSlotToNil,
  bytesToBase64,
  getOnlineId,
} from "../saveWriter";

const BOX_SIZE = 30;
const COLS = 6;

/* Nature stat effects: [+stat, -stat] or null for neutral */
const NATURE_EFFECTS: Record<number, [string, string] | null> = {
  0: null, 6: null, 12: null, 18: null, 24: null, // Hardy,Docile,Serious,Bashful,Quirky
  1: ["Atk", "Déf"], 2: ["Atk", "Vit"], 3: ["Atk", "Sp.A"], 4: ["Atk", "Sp.D"],
  5: ["Déf", "Atk"], 7: ["Déf", "Vit"], 8: ["Déf", "Sp.A"], 9: ["Déf", "Sp.D"],
  10: ["Vit", "Atk"], 11: ["Vit", "Déf"], 13: ["Vit", "Sp.A"], 14: ["Vit", "Sp.D"],
  15: ["Sp.A", "Atk"], 16: ["Sp.A", "Déf"], 17: ["Sp.A", "Vit"], 19: ["Sp.A", "Sp.D"],
  20: ["Sp.D", "Atk"], 21: ["Sp.D", "Déf"], 22: ["Sp.D", "Vit"], 23: ["Sp.D", "Sp.A"],
};

const GTS_GAME_ID = 128;

type DepositStep = "idle" | "form" | "confirm" | "depositing" | "success" | "error";

export type TradeFilter = {
  wantedSpecies: number;
  wantedLevelMin: number;
  wantedLevelMax: number;
  wantedGender: number; // 0=indifférent, 1=mâle, 2=femelle
};

export type DexRow = { id: number; name: string; imageUrl?: string; isExtradex?: boolean; extradexNum?: number };

export default function PCBoxView({
  profile,
  onBack,
  embedded,
  savePath,
  onProfileReload,
  tradeFilter,
  onTradeSelect,
  p2pTradeMode,
  dexRows,
  siteUrl,
  onDepositDone,
}: {
  profile: PlayerProfile | null;
  onBack?: () => void;
  embedded?: boolean;
  savePath?: string | null;
  onProfileReload?: () => void;
  tradeFilter?: TradeFilter | null;
  onTradeSelect?: (poke: BoxPokemon, boxIdx: number) => void;
  /** Mode échange P2P : tous les Pokémon sont sélectionnables, click direct. */
  p2pTradeMode?: boolean;
  /** Liste Pokédex pour le dropdown de dépôt (si fourni, remplace speciesNames). */
  dexRows?: DexRow[];
  /** URL de base du site (pour résoudre les imageUrl du Pokédex). */
  siteUrl?: string;
  /** Appelé après un dépôt GTS réussi (pour rafraîchir la liste browse). */
  onDepositDone?: () => void;
}) {
  const [activeBox, setActiveBox] = useState(0);
  const [speciesNames, setSpeciesNames] = useState<string[] | null>(null);
  const [skillNames, setSkillNames] = useState<string[] | null>(null);
  const [spriteCache, setSpriteCache] = useState<Record<string, string | null>>({});
  const [selectedPoke, setSelectedPoke] = useState<BoxPokemon | null>(null);
  const [selectedPokeBoxIdx, setSelectedPokeBoxIdx] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [shinyFilter, setShinyFilter] = useState(false);

  /* ─── Dépôt GTS ─── */
  const [depositStep, setDepositStep] = useState<DepositStep>("idle");
  const [depositError, setDepositError] = useState("");
  const [showDepositAnim, setShowDepositAnim] = useState(false);
  const [wantedSpecies, setWantedSpecies] = useState(1);
  const [wantedLevelMin, setWantedLevelMin] = useState(1);
  const [wantedLevelMax, setWantedLevelMax] = useState(100);
  const [wantedGender, setWantedGender] = useState(0);
  const [wantedSpeciesQuery, setWantedSpeciesQuery] = useState("");
  const [wantedSuggestOpen, setWantedSuggestOpen] = useState(false);
  const isEditingSpeciesRef = useRef(false);
  const [wantedIvs, setWantedIvs] = useState({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 });
  const [wantedShiny, setWantedShiny] = useState<"any" | "yes" | "no">("any");
  const [wantedNature, setWantedNature] = useState<number | null>(null);
  const wantedSuggestRef = useRef<HTMLDivElement>(null);

  const boxes = profile?.boxes ?? [];
  const box: PCBox | null = boxes[activeBox] ?? null;

  /** Vérifie si un Pokémon correspond aux critères d'échange */
  const isTradeMatch = useCallback((pm: BoxPokemon | null): boolean => {
    if (!pm || !tradeFilter) return false;
    // Ne filtre que par espèce — niveau et genre sont vérifiés au moment de la confirmation
    const speciesId = typeof pm.code === "string" ? parseInt(pm.code, 10) : (pm.code ?? 0);
    return speciesId === tradeFilter.wantedSpecies;
  }, [tradeFilter]);

  /** En trade mode : liste plate de tous les Pokémon compatibles à travers toutes les boîtes */
  const tradeMatches = useMemo(() => {
    if (!tradeFilter) return null;
    const matches: { poke: BoxPokemon; boxIdx: number; boxName: string }[] = [];
    for (let b = 0; b < boxes.length; b++) {
      const bx = boxes[b];
      if (!bx) continue;
      for (const pm of bx.pokemon) {
        if (pm && isTradeMatch(pm)) {
          matches.push({ poke: pm, boxIdx: b, boxName: bx.name || `Boîte ${b + 1}` });
        }
      }
    }
    return matches;
  }, [tradeFilter, boxes, isTradeMatch]);

  // Load species names + skill names
  useEffect(() => {
    invoke<string>("cmd_psdk_french_species_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 100) setSpeciesNames(arr);
          else setSpeciesNames([]);
        } catch { setSpeciesNames([]); }
      })
      .catch(() => setSpeciesNames([]));

    invoke<string>("cmd_psdk_french_skill_names")
      .then((raw) => {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 50) setSkillNames(arr);
          else setSkillNames([]);
        } catch { setSkillNames([]); }
      })
      .catch(() => setSkillNames([]));
  }, []);

  // Load sprites for current box
  useEffect(() => {
    if (!box) return;
    let cancelled = false;
    for (const pm of box.pokemon) {
      if (!pm) continue;
      const speciesId = typeof pm.code === "string" ? parseInt(String(pm.code), 10) : (pm.code ?? 0);
      const form = typeof pm.form === "string" ? parseInt(String(pm.form), 10) : (pm.form ?? 0);
      const keyS = `${speciesId}_${form}_s`;
      const keyN = `${speciesId}_${form}_n`;
      if (spriteCache[keyN] === undefined) {
        setSpriteCache((p) => ({ ...p, [keyN]: "" }));
        invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: form > 0 ? form : null })
          .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyN]: url ?? null })); })
          .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyN]: null })); });
      }
      if (pm.isShiny && spriteCache[keyS] === undefined) {
        setSpriteCache((p) => ({ ...p, [keyS]: "" }));
        invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: form > 0 ? form : null })
          .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyS]: url ?? null })); })
          .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyS]: null })); });
      }
      if (pm.isAltShiny) {
        const keyA = `${speciesId}_${form}_a`;
        if (spriteCache[keyA] === undefined) {
          setSpriteCache((p) => ({ ...p, [keyA]: "" }));
          invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: form > 0 ? form : null })
            .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyA]: url ?? null })); })
            .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyA]: null })); });
        }
      }
    }
    return () => { cancelled = true; };
  }, [box, activeBox]);

  // Load sprites for a list of Pokémon from any box (trade matches + search results)
  // Uses a ref to track already-requested keys to avoid depending on spriteCache
  const requestedSprites = useRef(new Set<string>());
  const loadSpritesForList = useCallback((list: BoxPokemon[]) => {
    let cancelled = false;
    for (const pm of list) {
      const speciesId = typeof pm.code === "string" ? parseInt(String(pm.code), 10) : (pm.code ?? 0);
      const form = typeof pm.form === "string" ? parseInt(String(pm.form), 10) : (pm.form ?? 0);
      const keyN = `${speciesId}_${form}_n`;
      const keyS = `${speciesId}_${form}_s`;
      if (!requestedSprites.current.has(keyN)) {
        requestedSprites.current.add(keyN);
        invoke<string | null>("cmd_get_normal_sprite", { speciesId, form: form > 0 ? form : null })
          .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyN]: url ?? null })); })
          .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyN]: null })); });
      }
      if (pm.isShiny && !requestedSprites.current.has(keyS)) {
        requestedSprites.current.add(keyS);
        invoke<string | null>("cmd_get_shiny_sprite", { speciesId, form: form > 0 ? form : null })
          .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyS]: url ?? null })); })
          .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyS]: null })); });
      }
      if (pm.isAltShiny) {
        const keyA = `${speciesId}_${form}_a`;
        if (!requestedSprites.current.has(keyA)) {
          requestedSprites.current.add(keyA);
          invoke<string | null>("cmd_get_alt_shiny_sprite", { speciesId, form: form > 0 ? form : null })
            .then((url) => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyA]: url ?? null })); })
            .catch(() => { if (!cancelled) setSpriteCache((p) => ({ ...p, [keyA]: null })); });
        }
      }
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tradeMatches || tradeMatches.length === 0) return;
    return loadSpritesForList(tradeMatches.map(m => m.poke));
  }, [tradeMatches, loadSpritesForList]);

  const totalPokemon = useMemo(() => {
    let count = 0;
    for (const b of boxes) for (const p of b.pokemon) if (p) count++;
    return count;
  }, [boxes]);

  const boxCount = useMemo(() => {
    if (!box) return 0;
    return box.pokemon.filter(Boolean).length;
  }, [box]);

  const shinyCount = useMemo(() => {
    let count = 0;
    for (const b of boxes) for (const p of b.pokemon) if (p?.isShiny) count++;
    return count;
  }, [boxes]);

  const altShinyCount = useMemo(() => {
    let count = 0;
    for (const b of boxes) for (const p of b.pokemon) if (p?.isAltShiny) count++;
    return count;
  }, [boxes]);

  // Filtered species for deposit dropdown
  const fullImageUrl = useCallback((url: string | undefined) => {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    const base = (siteUrl ?? "").replace(/\/$/, "");
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }, [siteUrl]);

  /** dexRows dédupliqué par id (une seule entrée par espèce). */
  const uniqueDexRows = useMemo(() => {
    if (!dexRows?.length) return [];
    const seen = new Set<number>();
    const out: typeof dexRows = [];
    for (const r of dexRows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [dexRows]);

  const filteredSpecies = useMemo(() => {
    if (uniqueDexRows.length > 0) {
      const q = wantedSpeciesQuery.trim().toLowerCase();
      if (!q) return uniqueDexRows.map((r) => ({ id: r.id, name: r.name, imageUrl: r.imageUrl, isExtradex: r.isExtradex, extradexNum: r.extradexNum }));
      const digits = q.replace(/\D/g, "");
      return uniqueDexRows
        .filter((r) => {
          if (r.name.toLowerCase().includes(q)) return true;
          if (digits.length > 0 && String(r.isExtradex ? r.extradexNum : r.id).startsWith(digits)) return true;
          return false;
        })
        .map((r) => ({ id: r.id, name: r.name, imageUrl: r.imageUrl, isExtradex: r.isExtradex, extradexNum: r.extradexNum }));
    }
    if (!speciesNames) return [];
    const q = wantedSpeciesQuery.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const list: { id: number; name: string; imageUrl?: string; isExtradex?: boolean; extradexNum?: number }[] = [];
    for (let i = 1; i < speciesNames.length; i++) {
      const name = speciesNames[i];
      if (!name) continue;
      if (name.startsWith("Méga-") || name.startsWith("Méga ")) continue;
      if (q) {
        if (!name.toLowerCase().includes(q) && !(digits.length > 0 && String(i).startsWith(digits))) continue;
      }
      list.push({ id: i, name });
    }
    return list;
  }, [uniqueDexRows, speciesNames, wantedSpeciesQuery]);

  /** Mapping ID Pokédex site → ID PSDK interne (pour l'envoi au GTS). */
  const nationalToPsdk = useMemo(() => {
    if (!speciesNames || !uniqueDexRows.length) return null;
    const m = new Map<number, number>();
    const psdkByName = new Map<string, number>();
    speciesNames.forEach((name, idx) => {
      if (name) {
        const k = normalizeName(name);
        if (!psdkByName.has(k)) psdkByName.set(k, idx);
      }
    });
    for (const r of uniqueDexRows) {
      const psdkId = psdkByName.get(normalizeName(r.name));
      if (psdkId != null) m.set(r.id, psdkId);
    }
    return m;
  }, [speciesNames, uniqueDexRows]);

  /** Résout le nom d'affichage pour l'espèce souhaitée (dropdown). */
  const resolveWantedName = useCallback((id: number): string => {
    if (uniqueDexRows.length) {
      const row = uniqueDexRows.find((r) => r.id === id);
      if (row) return `${row.name} (#${row.id})`;
    }
    return speciesNames?.[id] ? `${speciesNames[id]} (#${id})` : String(id);
  }, [uniqueDexRows, speciesNames]);

  // Close suggest on outside click
  useEffect(() => {
    if (!wantedSuggestOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wantedSuggestRef.current?.contains(e.target as Node)) return;
      setWantedSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wantedSuggestOpen]);

  function getSpeciesName(pm: BoxPokemon): string {
    const id = typeof pm.code === "string" ? parseInt(String(pm.code), 10) : (pm.code ?? 0);
    return (speciesNames && id > 0 ? speciesNames[id] : null) ?? `#${id}`;
  }

  function getMoveName(id: number): string {
    return (skillNames && id > 0 ? skillNames[id] : null) ?? `#${id}`;
  }

  function getSpriteUrl(pm: BoxPokemon): string | null {
    const speciesId = typeof pm.code === "string" ? parseInt(String(pm.code), 10) : (pm.code ?? 0);
    const form = typeof pm.form === "string" ? parseInt(String(pm.form), 10) : (pm.form ?? 0);
    if (pm.isAltShiny) {
      const aUrl = spriteCache[`${speciesId}_${form}_a`];
      if (aUrl) return aUrl;
    }
    if (pm.isShiny) {
      const sUrl = spriteCache[`${speciesId}_${form}_s`];
      if (sUrl) return sUrl;
    }
    const nUrl = spriteCache[`${speciesId}_${form}_n`];
    return nUrl || null;
  }

  function genderIcon(g?: 0 | 1 | 2) {
    if (g === 0) return <FaMars className="pcbox-gender pcbox-gender--m" />;
    if (g === 1) return <FaVenus className="pcbox-gender pcbox-gender--f" />;
    return null;
  }

  const slots: (BoxPokemon | null)[] = useMemo(() => {
    if (!box) return Array(BOX_SIZE).fill(null);
    const arr = [...box.pokemon];
    while (arr.length < BOX_SIZE) arr.push(null);
    return arr.slice(0, BOX_SIZE);
  }, [box]);

  // Search filter: find pokemon across all boxes
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !shinyFilter) return null;
    const results: { boxIdx: number; boxName: string; pm: BoxPokemon }[] = [];
    for (let b = 0; b < boxes.length; b++) {
      for (const pm of boxes[b].pokemon) {
        if (!pm) continue;
        if (shinyFilter && !pm.isShiny && !pm.isAltShiny) continue;
        if (q) {
          const name = getSpeciesName(pm).toLowerCase();
          const nick = (pm.nickname ?? "").toLowerCase();
          if (!name.includes(q) && !nick.includes(q)) continue;
        }
        results.push({ boxIdx: b, boxName: boxes[b].name, pm });
      }
    }
    return results;
  }, [searchQuery, shinyFilter, boxes, speciesNames]);

  // Load sprites for search results (cross-box)
  useEffect(() => {
    if (!searchResults || searchResults.length === 0) return;
    return loadSpritesForList(searchResults.map(r => r.pm));
  }, [searchResults, loadSpritesForList]);

  function natureName(n?: number | null): string {
    if (n == null) return "—";
    return NATURE_FR[n] ?? `Nature ${n}`;
  }

  function natureEffects(n?: number | null): [string, string] | null {
    if (n == null) return null;
    return NATURE_EFFECTS[n] ?? null;
  }

  /* ─── Dépôt GTS: logique ─── */
  const canDeposit = !!savePath && !!selectedPoke;

  const startDeposit = useCallback(() => {
    setDepositStep("form");
    setDepositError("");
    setWantedSpecies(1);
    setWantedLevelMin(1);
    setWantedLevelMax(100);
    setWantedGender(0);
    setWantedSpeciesQuery("");
    setWantedSuggestOpen(false);
    setWantedIvs({ hp: 0, atk: 0, def: 0, spd: 0, spa: 0, spd2: 0 });
    setWantedShiny("any");
    setWantedNature(null);
  }, []);

  const executeDeposit = useCallback(async () => {
    if (!selectedPoke || !savePath) return;
    setDepositStep("depositing");
    setDepositError("");
    try {
      // 1. Vérifier que le jeu n'est pas lancé
      const running = await invoke<boolean>("cmd_is_game_running");
      if (running) {
        setDepositError("Le jeu est en cours d'exécution ! Fermez-le avant de modifier la sauvegarde.");
        setDepositStep("error");
        return;
      }

      // 2. Charger la save brute
      const blob = await invoke<{ path: string; modified: number; bytes_b64: string } | null>(
        "cmd_get_save_blob",
        { savePath },
      );
      if (!blob) {
        setDepositError("Impossible de charger la sauvegarde.");
        setDepositStep("error");
        return;
      }
      const rawBytes = Uint8Array.from(atob(blob.bytes_b64), c => c.charCodeAt(0));

      // 3. Charger la save pour édition
      const ctx = loadSaveForEdit(rawBytes);

      // 4. Trouver le box/slot du Pokémon sélectionné
      const boxIdx = selectedPokeBoxIdx;
      const slotIdx = selectedPoke.slot;

      // 5. Extraire le Pokémon Marshal
      const pokemon = extractPokemonFromBox(ctx.root, boxIdx, slotIdx);

      // 6. Récupérer l'online ID du joueur
      let onlineId = getOnlineId(ctx.root);
      if (!onlineId || onlineId <= 0) {
        setDepositError("Impossible de trouver votre ID en ligne GTS. Avez-vous déjà utilisé le GTS dans le jeu ?");
        setDepositStep("error");
        return;
      }

      // 7. Vérifier si un Pokémon est déjà déposé
      const hasUploaded = await invoke<boolean>("cmd_gts_has_pokemon_uploaded", {
        gameId: GTS_GAME_ID,
        onlineId,
      });
      if (hasUploaded) {
        setDepositError("Vous avez déjà un Pokémon déposé sur le GTS. Récupérez-le ou attendez qu'il soit échangé avant d'en déposer un autre.");
        setDepositStep("error");
        return;
      }

      // 8. Encoder le Pokémon pour le GTS
      const pokemonB64 = encodePokemonForGts(pokemon);

      // 9. Upload sur le serveur GTS
      const speciesId = typeof selectedPoke.code === "string"
        ? parseInt(String(selectedPoke.code), 10)
        : (selectedPoke.code ?? 0);
      const gtsGender = wantedGender === 0 ? -1 : wantedGender;

      const uploadResult = await invoke<string>("cmd_gts_upload_pokemon", {
        gameId: GTS_GAME_ID,
        onlineId,
        pokemonB64: pokemonB64,
        species: speciesId,
        level: selectedPoke.level ?? 1,
        gender: selectedPoke.gender ?? 0,
        wantedSpecies: nationalToPsdk?.get(wantedSpecies) ?? wantedSpecies,
        wantedLevelMin: wantedLevelMin,
        wantedLevelMax: wantedLevelMax,
        wantedGender: gtsGender,
      });

      if (uploadResult.trim() !== "success") {
        setDepositError(`Le serveur GTS a refusé le dépôt : ${uploadResult.trim()}`);
        setDepositStep("error");
        return;
      }

      // 10. Produire des bytes self-contained via dump() (pour retrait/échange sûr)
      // dump() est valide pour les Pokémon car ils n'ont pas de hash à clés non-primitives
      const selfContainedB64 = bytesToBase64(dump(pokemon).slice(2)); // strip header 0x04 0x08

      // 11. Patcher la save : remplacer le slot par nil (chirurgical, pas de re-sérialisation)
      const patchedBytes = patchSlotToNil(rawBytes, ctx.marshalOffset, boxIdx, slotIdx);
      const newB64 = bytesToBase64(patchedBytes);

      const backupPath = await invoke<string>("cmd_write_save_blob", {
        savePath,
        bytesB64: newB64,
      });

      console.info(`[GTS] Dépôt réussi ! Backup: ${backupPath}`);

      // 12b. Sauvegarder les critères bonus + bytes self-contained + info du Pokémon original
      const extras: Record<string, unknown> = {
        shiny: wantedShiny,
        nature: wantedNature,
        ivs: wantedIvs,
        depositedAt: Date.now(),
        rawSlotB64: selfContainedB64, // bytes self-contained (dump() sans header)
        // Info du Pokémon original pour l'historique des échanges
        originalName: selectedPoke.speciesName ?? selectedPoke.nickname ?? "?",
        originalSpecies: typeof selectedPoke.code === "string" ? parseInt(selectedPoke.code, 10) : (selectedPoke.code ?? 0),
        originalLevel: selectedPoke.level ?? 0,
        originalShiny: selectedPoke.isShiny ?? false,
        originalAltShiny: selectedPoke.isAltShiny ?? false,
      };
      await invoke("cmd_gts_save_extras", {
        onlineId,
        jsonData: JSON.stringify(extras, null, 2),
      }).catch((e) => console.warn("[GTS] Impossible de sauvegarder les extras:", e));

      // 12. Lancer l'animation de dépôt
      setShowDepositAnim(true);

      // Recharger le profil + actualiser la liste GTS
      setTimeout(() => {
        onProfileReload?.();
        onDepositDone?.();
      }, 500);
    } catch (e: any) {
      console.error("[GTS] Erreur dépôt:", e);
      setDepositError(String(e?.message || e));
      setDepositStep("error");
    }
  }, [selectedPoke, savePath, activeBox, wantedSpecies, wantedLevelMin, wantedLevelMax, wantedGender, wantedShiny, wantedNature, wantedIvs, onProfileReload, onDepositDone]);

  const ivRows = selectedPoke ? [
    { Icon: FaHeart, label: "PV", value: selectedPoke.ivHp ?? 0, cls: "hp" },
    { Icon: FaHandFist, label: "Atk", value: selectedPoke.ivAtk ?? 0, cls: "atk" },
    { Icon: FaShield, label: "Déf", value: selectedPoke.ivDfe ?? 0, cls: "def" },
    { Icon: FaBolt, label: "Vit", value: selectedPoke.ivSpd ?? 0, cls: "spe" },
    { Icon: FaWandMagicSparkles, label: "Sp.A", value: selectedPoke.ivAts ?? 0, cls: "spa" },
    { Icon: FaShieldHalved, label: "Sp.D", value: selectedPoke.ivDfs ?? 0, cls: "spd" },
  ] : [];
  const ivTotal = ivRows.reduce((s, r) => s + r.value, 0);

  if (!profile || boxes.length === 0) {
    return (
      <div className={`pcbox-section ${embedded ? "" : "pcbox-page"}`}>
        {onBack && (
          <button type="button" className="bst-back" onClick={onBack}>
            <FaArrowLeft size={14} /> Retour
          </button>
        )}
        <div className="pcbox-empty">
          <FaBoxOpen size={48} />
          <p>Aucune sauvegarde chargée ou aucune boîte PC trouvée.</p>
        </div>
      </div>
    );
  }

  const effects = selectedPoke ? natureEffects(selectedPoke.nature) : null;

  const closeModal = () => { setSelectedPoke(null); setDepositStep("idle"); };

  const modal = selectedPoke ? createPortal(
    <div className="pcbox-modal-overlay" onClick={closeModal}>
      <div className="pcbox-modal pnw-scrollbar" onClick={(e) => e.stopPropagation()}>
        <button className="pcbox-modal-close" onClick={closeModal}>
          <FaXmark />
        </button>

        {/* Header */}
        <div className="pcbox-modal-header">
          <div className={`pcbox-modal-sprite ${selectedPoke.isAltShiny ? "pcbox-modal-sprite--alt-shiny" : selectedPoke.isShiny ? "pcbox-modal-sprite--shiny" : ""}`}>
            {getSpriteUrl(selectedPoke) ? (
              <img src={getSpriteUrl(selectedPoke)!} alt="" />
            ) : (
              <div className="pcbox-slot-placeholder pcbox-slot-placeholder--lg">?</div>
            )}
            {selectedPoke.isAltShiny && <FaStar className="pcbox-modal-shiny-badge-alt" />}
            {selectedPoke.isShiny && !selectedPoke.isAltShiny && <FaStar className="pcbox-modal-shiny-badge" />}
          </div>
          <div className="pcbox-modal-title-wrap">
            <h2 className="pcbox-modal-name">
              {selectedPoke.nickname || getSpeciesName(selectedPoke)}
            </h2>
            {selectedPoke.nickname && (
              <p className="pcbox-modal-species">{getSpeciesName(selectedPoke)}</p>
            )}
            <div className="pcbox-modal-tags">
              <span className="pcbox-modal-tag pcbox-modal-tag--level">Nv. {selectedPoke.level ?? "?"}</span>
              {selectedPoke.isAltShiny && (
                <span className="pcbox-modal-tag pcbox-modal-tag--alt-shiny">
                  <FaStar size={9} /> Shiny Alt
                </span>
              )}
              {selectedPoke.isShiny && !selectedPoke.isAltShiny && (
                <span className="pcbox-modal-tag pcbox-modal-tag--shiny">
                  <FaStar size={9} /> Shiny
                </span>
              )}
              {selectedPoke.gender === 0 && <span className="pcbox-modal-tag pcbox-modal-tag--male"><FaMars size={10} /></span>}
              {selectedPoke.gender === 1 && <span className="pcbox-modal-tag pcbox-modal-tag--female"><FaVenus size={10} /></span>}
            </div>
            {selectedPoke.trainerName && (
              <div style={{ fontSize: ".75rem", color: "rgba(255,255,255,.4)", marginTop: 4, fontStyle: "italic" }}>
                D.O. {selectedPoke.trainerName}
              </div>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="pcbox-modal-info-grid">
          <div className="pcbox-modal-info-item">
            <span className="pcbox-modal-info-label">Nature</span>
            <span className="pcbox-modal-info-value">
              {natureName(selectedPoke.nature)}
              {effects && (
                <span className="pcbox-modal-nature-fx">
                  <span className="pcbox-nature-up">+{effects[0]}</span>
                  <span className="pcbox-nature-down">-{effects[1]}</span>
                </span>
              )}
            </span>
          </div>
          {selectedPoke.exp != null && (
            <div className="pcbox-modal-info-item">
              <span className="pcbox-modal-info-label">Exp.</span>
              <span className="pcbox-modal-info-value">{selectedPoke.exp.toLocaleString("fr-FR")}</span>
            </div>
          )}
        </div>

        {/* Moves */}
        {selectedPoke.moves && selectedPoke.moves.length > 0 && (
          <div className="pcbox-modal-moves">
            <h3 className="pcbox-modal-section-title">
              <FaLayerGroup size={10} /> Attaques
            </h3>
            <div className="pcbox-modal-moves-list">
              {selectedPoke.moves.map((id, i) => (
                <span key={`${id}-${i}`} className="pcbox-modal-move-chip">{getMoveName(id)}</span>
              ))}
            </div>
          </div>
        )}

        {/* IVs */}
        {selectedPoke.ivHp != null && (
          <div className="pcbox-modal-ivs">
            <h3 className="pcbox-modal-section-title">
              <FaChartPie size={10} /> IVs
              <span className="pcbox-modal-iv-total-inline">
                <FaDna size={9} /> {ivTotal}/186
              </span>
            </h3>
            <div className="pcbox-modal-iv-grid">
              {ivRows.map(({ Icon, label, value, cls }) => (
                <div key={label} className="pcbox-modal-iv">
                  <Icon className={`pcbox-modal-iv-icon pcbox-modal-iv-icon--${cls}`} />
                  <span className="pcbox-modal-iv-label">{label}</span>
                  <div className="pcbox-modal-iv-bar">
                    <div
                      className={`pcbox-modal-iv-fill pcbox-modal-iv-fill--${cls}`}
                      style={{ width: `${(value / 31) * 100}%` }}
                    />
                  </div>
                  <span className={`pcbox-modal-iv-val ${value === 31 ? "pcbox-modal-iv-val--max" : ""}`}>
                    {value}
                  </span>
                </div>
              ))}
              {ivTotal === 186 && (
                <div className="pcbox-modal-iv-perfect">6IV Parfait !</div>
              )}
            </div>
          </div>
        )}

        {/* ─── Dépôt GTS ─── */}
        {canDeposit && depositStep === "idle" && (
          <button
            type="button"
            className="pcbox-deposit-btn"
            onClick={startDeposit}
          >
            <FaUpload size={12} /> Déposer sur le GTS
          </button>
        )}

        {depositStep === "form" && (
          <div className="pcbox-deposit-form">
            <h3 className="pcbox-deposit-form-title">
              <FaUpload size={11} /> Dépôt GTS — En échange je veux :
            </h3>
            <div className="pcbox-deposit-fields">
              {/* Species autocomplete */}
              <div className="pcbox-deposit-field" ref={wantedSuggestRef}>
                <label>Espèce souhaitée</label>
                <div className="pcbox-deposit-autocomplete">
                  <FaMagnifyingGlass className="pcbox-deposit-ac-icon" />
                  <input
                    type="text"
                    className="pcbox-deposit-input pcbox-deposit-input--ac"
                    placeholder={resolveWantedName(wantedSpecies)}
                    autoComplete="off"
                    value={wantedSpeciesQuery}
                    onChange={(e) => {
                      setWantedSpeciesQuery(e.target.value);
                      if (!wantedSuggestOpen) setWantedSuggestOpen(true);
                    }}
                    onFocus={() => {
                      isEditingSpeciesRef.current = true;
                      setWantedSpeciesQuery("");
                      setWantedSuggestOpen(true);
                    }}
                    onBlur={() => {
                      isEditingSpeciesRef.current = false;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setWantedSuggestOpen(false);
                    }}
                  />
                  {wantedSpeciesQuery && (
                    <button
                      className="pcbox-deposit-ac-clear"
                      onClick={() => { setWantedSpeciesQuery(""); setWantedSuggestOpen(true); }}
                    >
                      <FaXmark size={10} />
                    </button>
                  )}
                </div>
                {wantedSuggestOpen && filteredSpecies.length > 0 && (() => {
                  const pokedexSp = filteredSpecies.filter((s) => !s.isExtradex);
                  const extradexSp = filteredSpecies.filter((s) => s.isExtradex);
                  const renderItem = (sp: typeof filteredSpecies[number]) => {
                    const apiThumb = sp.imageUrl ? fullImageUrl(sp.imageUrl) : "";
                    let sprUrl = apiThumb;
                    if (!sprUrl) {
                      const sprKey = `${sp.id}_0_n`;
                      sprUrl = spriteCache[sprKey] ?? "";
                      if (spriteCache[sprKey] === undefined) {
                        invoke<string | null>("cmd_get_normal_sprite", { speciesId: sp.id, form: null })
                          .then((url) => setSpriteCache((p) => ({ ...p, [sprKey]: url ?? null })))
                          .catch(() => setSpriteCache((p) => ({ ...p, [sprKey]: null })));
                        setSpriteCache((p) => ({ ...p, [sprKey]: "" }));
                      }
                    }
                    return (
                      <li key={sp.id}>
                        <button
                          type="button"
                          className={`pcbox-deposit-suggest-item ${sp.id === wantedSpecies ? "pcbox-deposit-suggest-item--active" : ""}`}
                          onClick={() => {
                            setWantedSpecies(sp.id);
                            setWantedSpeciesQuery("");
                            setWantedSuggestOpen(false);
                          }}
                        >
                          <span className="pcbox-deposit-suggest-thumb">
                            {sprUrl ? (
                              <img src={sprUrl} alt="" loading="lazy" />
                            ) : (
                              <span className="pcbox-deposit-suggest-thumb--empty" />
                            )}
                          </span>
                          <span className="pcbox-deposit-suggest-num">
                            {sp.isExtradex ? (
                              <span className="gts-suggest-extradex-badge">EX</span>
                            ) : (
                              <FaHashtag size={8} />
                            )}
                            {sp.isExtradex ? sp.extradexNum : sp.id}
                          </span>
                          <span className="pcbox-deposit-suggest-name">{sp.name}</span>
                        </button>
                      </li>
                    );
                  };
                  return extradexSp.length > 0 ? (
                    <div className="pcbox-deposit-suggest-columns">
                      <div className="pcbox-deposit-suggest-col pnw-scrollbar">
                        <div className="gts-suggest-col-header">Pokédex</div>
                        <ul className="pcbox-deposit-suggest-col-list">
                          {pokedexSp.length === 0 ? (
                            <li className="pcbox-deposit-suggest-empty">Aucun résultat</li>
                          ) : pokedexSp.map(renderItem)}
                        </ul>
                      </div>
                      <div className="pcbox-deposit-suggest-col pcbox-deposit-suggest-col--extradex pnw-scrollbar">
                        <div className="gts-suggest-col-header gts-suggest-col-header--extradex">Extradex</div>
                        <ul className="pcbox-deposit-suggest-col-list">
                          {extradexSp.length === 0 ? (
                            <li className="pcbox-deposit-suggest-empty">Aucun résultat</li>
                          ) : extradexSp.map(renderItem)}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <ul className="pcbox-deposit-suggest pnw-scrollbar">
                      {pokedexSp.map(renderItem)}
                    </ul>
                  );
                })()}
              </div>

              {/* Level range */}
              <div className="pcbox-deposit-field pcbox-deposit-field--row">
                <div>
                  <label>Niveau min</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="pcbox-deposit-input"
                    value={wantedLevelMin}
                    onChange={(e) => setWantedLevelMin(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>Niveau max</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="pcbox-deposit-input"
                    value={wantedLevelMax}
                    onChange={(e) => setWantedLevelMax(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Gender */}
              <div className="pcbox-deposit-field">
                <label>Genre</label>
                <select
                  className="pcbox-deposit-input"
                  value={wantedGender}
                  onChange={(e) => setWantedGender(Number(e.target.value))}
                >
                  <option value={0}>Indifférent</option>
                  <option value={1}>Mâle ♂</option>
                  <option value={2}>Femelle ♀</option>
                </select>
              </div>

              {/* ── Extra criteria (bonus, not sent to GTS server) ── */}
              <div className="pcbox-deposit-extras-title">Critères bonus (affichage launcher)</div>

              {/* Shiny */}
              <div className="pcbox-deposit-field">
                <label><FaStar size={9} style={{color:"#f0c420",marginRight:3}} />Chromatique</label>
                <select
                  className="pcbox-deposit-input"
                  value={wantedShiny}
                  onChange={(e) => setWantedShiny(e.target.value as "any" | "yes" | "no")}
                >
                  <option value="any">Indifférent</option>
                  <option value="yes">Oui (shiny)</option>
                  <option value="no">Non</option>
                </select>
              </div>

              {/* Nature */}
              <div className="pcbox-deposit-field">
                <label><FaLeaf size={9} style={{color:"#6ecf8a",marginRight:3}} />Nature souhaitée</label>
                <select
                  className="pcbox-deposit-input"
                  value={wantedNature ?? -1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setWantedNature(v < 0 ? null : v);
                  }}
                >
                  <option value={-1}>Indifférente</option>
                  {NATURE_FR.map((n, i) => {
                    const eff = NATURE_EFFECTS[i];
                    return (
                      <option key={i} value={i}>
                        {n}{eff ? ` (+${eff[0]} / -${eff[1]})` : " (neutre)"}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* IVs minimum par stat */}
              <div className="pcbox-deposit-field">
                <label><FaDna size={9} style={{color:"#7eaaef",marginRight:3}} />IVs minimum par stat (/31)</label>
                <div className="pcbox-deposit-ivs-grid">
                  {([
                    { key: "hp" as const, label: "PV", Icon: FaHeart, cls: "hp" },
                    { key: "atk" as const, label: "Atk", Icon: FaHandFist, cls: "atk" },
                    { key: "def" as const, label: "Déf", Icon: FaShield, cls: "def" },
                    { key: "spd" as const, label: "Vit", Icon: FaBolt, cls: "spe" },
                    { key: "spa" as const, label: "Sp.A", Icon: FaWandMagicSparkles, cls: "spa" },
                    { key: "spd2" as const, label: "Sp.D", Icon: FaShieldHalved, cls: "spd" },
                  ] as const).map(({ key, label, Icon, cls }) => (
                    <div key={key} className="pcbox-deposit-iv-row">
                      <Icon className={`pcbox-deposit-iv-icon pcbox-deposit-iv-icon--${cls}`} />
                      <span className="pcbox-deposit-iv-label">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={31}
                        step={1}
                        className={`pcbox-deposit-range pcbox-deposit-range--${cls}`}
                        value={wantedIvs[key]}
                        onChange={(e) => setWantedIvs((p) => ({ ...p, [key]: Number(e.target.value) }))}
                      />
                      <span className={`pcbox-deposit-iv-val ${wantedIvs[key] === 31 ? "pcbox-deposit-iv-val--max" : ""}`}>{wantedIvs[key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pcbox-deposit-actions">
              <button
                type="button"
                className="pcbox-deposit-cancel"
                onClick={() => setDepositStep("idle")}
              >
                Annuler
              </button>
              <button
                type="button"
                className="pcbox-deposit-confirm-btn"
                onClick={() => setDepositStep("confirm")}
              >
                Continuer
              </button>
            </div>
          </div>
        )}

        {depositStep === "confirm" && (
          <div className="pcbox-deposit-confirm">
            <div className="pcbox-deposit-warning">
              <FaTriangleExclamation size={16} />
              <div>
                <strong>Confirmer le dépôt</strong>
                <p>
                  {getSpeciesName(selectedPoke)} (Nv.{selectedPoke.level}) sera retiré de votre sauvegarde
                  et déposé sur le GTS. Un backup sera créé automatiquement.
                </p>
                <p className="pcbox-deposit-wanted-summary">
                  En échange : {resolveWantedName(wantedSpecies)}, Nv.{wantedLevelMin}–{wantedLevelMax}
                  {wantedGender === 1 ? " (Mâle)" : wantedGender === 2 ? " (Femelle)" : ""}
                </p>
                {(wantedShiny !== "any" || wantedNature !== null || Object.values(wantedIvs).some(v => v > 0)) && (
                  <p className="pcbox-deposit-wanted-extras">
                    {wantedShiny === "yes" && "✨ Shiny "}
                    {wantedShiny === "no" && "Non-shiny "}
                    {wantedNature !== null && `Nature: ${NATURE_FR[wantedNature]} `}
                    {Object.values(wantedIvs).some(v => v > 0) && (
                      <>IVs min: {wantedIvs.hp}/{wantedIvs.atk}/{wantedIvs.def}/{wantedIvs.spa}/{wantedIvs.spd2}/{wantedIvs.spd}</>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="pcbox-deposit-actions">
              <button
                type="button"
                className="pcbox-deposit-cancel"
                onClick={() => setDepositStep("form")}
              >
                Retour
              </button>
              <button
                type="button"
                className="pcbox-deposit-go"
                onClick={executeDeposit}
              >
                <FaUpload size={11} /> Déposer
              </button>
            </div>
          </div>
        )}

        {depositStep === "depositing" && !showDepositAnim && (
          <div className="pcbox-deposit-status">
            <FaSpinner className="pcbox-deposit-spinner" />
            <span>Dépôt en cours...</span>
          </div>
        )}

        {depositStep === "error" && (
          <div className="pcbox-deposit-status pcbox-deposit-status--err">
            <FaTriangleExclamation size={14} />
            <span>{depositError}</span>
            <button
              type="button"
              className="pcbox-deposit-dismiss"
              onClick={() => setDepositStep("idle")}
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className={`pcbox-section ${embedded ? "" : "pcbox-page animate-in"}`}>
      {onBack && (
        <button type="button" className="pcbox-back-btn" onClick={onBack}>
          <FaArrowLeft size={13} />
          {embedded ? "Fermer les boîtes" : "Retour"}
        </button>
      )}

      {/* Glass panel — selector + grid */}
      <div className="pcbox-panel">
        {/* Search + selector row */}
        <div className="pcbox-toolbar">
          <div className="pcbox-search">
            <FaMagnifyingGlass className="pcbox-search-icon" />
            <input
              type="text"
              className="pcbox-search-input"
              placeholder="Rechercher un Pokémon..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="pcbox-search-clear" onClick={() => setSearchQuery("")}>
                <FaXmark />
              </button>
            )}
          </div>

          {/* Box selector */}
          <div className="pcbox-selector">
            <button
              className="pcbox-selector-arrow"
              disabled={activeBox <= 0}
              onClick={() => setActiveBox((p) => Math.max(0, p - 1))}
            >
              <FaChevronLeft />
            </button>
            <select
              className="pcbox-selector-dropdown"
              value={activeBox}
              onChange={(e) => setActiveBox(Number(e.target.value))}
            >
              {boxes.map((b, i) => {
                const count = b.pokemon.filter(Boolean).length;
                return (
                  <option key={i} value={i}>
                    {b.name} ({count}/{BOX_SIZE})
                  </option>
                );
              })}
            </select>
            <button
              className="pcbox-selector-arrow"
              disabled={activeBox >= boxes.length - 1}
              onClick={() => setActiveBox((p) => Math.min(boxes.length - 1, p + 1))}
            >
              <FaChevronRight />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="pcbox-stats-bar">
          <span>{boxCount}/{BOX_SIZE} dans cette boîte</span>
          <span className="pcbox-stats-sep">·</span>
          <span>{totalPokemon} total</span>
          {(shinyCount > 0 || altShinyCount > 0) && (
            <>
              <span className="pcbox-stats-sep">·</span>
              <button
                type="button"
                className={`pcbox-stats-shiny-btn${shinyFilter ? " pcbox-stats-shiny-btn--active" : ""}`}
                onClick={() => setShinyFilter((p) => !p)}
                title={shinyFilter ? "Afficher tous les Pokémon" : "Afficher uniquement les shinys"}
              >
                <FaStar size={9} /> {shinyCount + altShinyCount} shiny
              </button>
            </>
          )}
        </div>

        {/* Search results or Grid */}
        {searchResults ? (
          <div className="pcbox-search-results">
            <div className="pcbox-search-results-header">
              {searchResults.length} résultat{searchResults.length !== 1 ? "s" : ""}
              {searchQuery ? ` pour "${searchQuery}"` : ""}
              {shinyFilter ? " (shinys uniquement)" : ""}
            </div>
            {searchResults.length === 0 ? (
              <div className="pcbox-search-empty">Aucun Pokémon trouvé</div>
            ) : (
              <div className="pcbox-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                {searchResults.map(({ boxIdx, boxName, pm }, i) => (
                  <div
                    key={`sr_${i}`}
                    className={[
                      "pcbox-slot pcbox-slot--filled",
                      pm.isAltShiny ? "pcbox-slot--alt-shiny" : pm.isShiny ? "pcbox-slot--shiny" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (p2pTradeMode && onTradeSelect) {
                        onTradeSelect(pm, boxIdx);
                      } else {
                        setSelectedPoke(pm);
                        setSelectedPokeBoxIdx(boxIdx);
                      }
                    }}
                    title={`${boxName}`}
                  >
                    {pm.isAltShiny && <FaStar className="pcbox-slot-star-alt" />}
                    {pm.isShiny && !pm.isAltShiny && <FaStar className="pcbox-slot-star" />}
                    <div className="pcbox-slot-sprite">
                      {getSpriteUrl(pm) ? (
                        <img src={getSpriteUrl(pm)!} alt="" />
                      ) : (
                        <div className="pcbox-slot-placeholder">?</div>
                      )}
                    </div>
                    <div className="pcbox-slot-info">
                      <span className="pcbox-slot-name">{pm.nickname || getSpeciesName(pm)}</span>
                      <span className="pcbox-slot-level">Nv.{pm.level ?? "?"}</span>
                      <span className="pcbox-slot-box-tag">{boxName}</span>
                      {pm.trainerName && <span className="pcbox-slot-trainer">D.O. {pm.trainerName}</span>}
                    </div>
                    {genderIcon(pm.gender)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tradeFilter && tradeMatches ? (
          /* ─── Trade mode : vue plate de tous les matchs ─── */
          tradeMatches.length === 0 ? (
            <div className="pcbox-search-empty">Aucun Pokémon compatible dans vos boîtes</div>
          ) : (
            <>
              <div style={{ textAlign: "center", fontSize: ".8rem", color: "rgba(255,255,255,.5)", margin: "0 0 .5rem" }}>
                {tradeMatches.length} Pokémon compatible{tradeMatches.length > 1 ? "s" : ""} trouvé{tradeMatches.length > 1 ? "s" : ""} dans toutes vos boîtes
              </div>
              <div className="pcbox-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                {tradeMatches.map(({ poke: pm, boxIdx, boxName }, i) => (
                  <div
                    key={`tm_${boxIdx}_${pm.slot}`}
                    className={[
                      "pcbox-slot pcbox-slot--filled pcbox-slot--trade-match",
                      pm.isAltShiny ? "pcbox-slot--alt-shiny" : pm.isShiny ? "pcbox-slot--shiny" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onTradeSelect?.(pm, boxIdx)}
                    title={boxName}
                  >
                    {pm.isAltShiny && <FaStar className="pcbox-slot-star-alt" />}
                    {pm.isShiny && !pm.isAltShiny && <FaStar className="pcbox-slot-star" />}
                    <div className="pcbox-slot-sprite">
                      {getSpriteUrl(pm) ? (
                        <img src={getSpriteUrl(pm)!} alt="" />
                      ) : (
                        <div className="pcbox-slot-placeholder">?</div>
                      )}
                    </div>
                    <div className="pcbox-slot-info">
                      <span className="pcbox-slot-name">{pm.nickname || getSpeciesName(pm)}</span>
                      <span className="pcbox-slot-level">Nv.{pm.level ?? "?"}</span>
                      <span className="pcbox-slot-box-tag">{boxName}</span>
                      {pm.trainerName && <span className="pcbox-slot-trainer">D.O. {pm.trainerName}</span>}
                    </div>
                    {genderIcon(pm.gender)}
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          <div className="pcbox-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
            {slots.map((pm, i) => (
              <div
                key={`${activeBox}_${i}`}
                className={[
                  "pcbox-slot",
                  pm ? "pcbox-slot--filled" : "pcbox-slot--empty",
                  pm?.isAltShiny ? "pcbox-slot--alt-shiny" : pm?.isShiny ? "pcbox-slot--shiny" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  if (!pm) return;
                  if (p2pTradeMode && onTradeSelect) {
                    onTradeSelect(pm, activeBox);
                  } else {
                    setSelectedPoke(pm);
                    setSelectedPokeBoxIdx(activeBox);
                  }
                }}
              >
                {pm ? (
                  <>
                    {pm.isAltShiny && <FaStar className="pcbox-slot-star-alt" />}
                    {pm.isShiny && !pm.isAltShiny && <FaStar className="pcbox-slot-star" />}
                    <div className="pcbox-slot-sprite">
                      {getSpriteUrl(pm) ? (
                        <img src={getSpriteUrl(pm)!} alt="" />
                      ) : (
                        <div className="pcbox-slot-placeholder">?</div>
                      )}
                    </div>
                    <div className="pcbox-slot-info">
                      <span className="pcbox-slot-name">{pm.nickname || getSpeciesName(pm)}</span>
                      <span className="pcbox-slot-level">Nv.{pm.level ?? "?"}</span>
                      {pm.trainerName && <span className="pcbox-slot-trainer">D.O. {pm.trainerName}</span>}
                    </div>
                    {genderIcon(pm.gender)}
                  </>
                ) : (
                  <div className="pcbox-slot-empty-dot" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal}

      {/* Animation de dépôt GTS */}
      {showDepositAnim && selectedPoke && (
        <GtsTransferAnim
          mode="deposit"
          spriteUrl={getSpriteUrl(selectedPoke)}
          pokemonName={selectedPoke.nickname || getSpeciesName(selectedPoke)}
          isShiny={selectedPoke.isShiny ?? false}
          isAltShiny={selectedPoke.isAltShiny ?? false}
          onComplete={() => {
            setShowDepositAnim(false);
            setDepositStep("idle");
            setSelectedPoke(null);
          }}
        />
      )}
    </div>
  );
}
