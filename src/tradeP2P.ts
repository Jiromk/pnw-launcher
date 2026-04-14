/**
 * tradeP2P.ts — Logique d'échange P2P temps réel entre joueurs.
 *
 * Réutilise les fonctions de saveWriter.ts pour la manipulation des saves.
 * Communication via Supabase Broadcast (canal game-live).
 */
import { invoke } from "@tauri-apps/api/core";
import type { TradeSelectionPreview, TradeMessageData } from "./types";
import {
  loadSaveForEdit,
  extractPokemonFromBox,
  encodePokemonForGts,
  decodePokemonFromGts,
  patchSlotToNil,
  findFirstEmptySlot,
  insertPokemonIntoSave,
  bytesToBase64,
} from "./saveWriter";

/* ==================== Constantes ==================== */

export const TRADE_PREFIX = "🔁TRADE🔁";

/** Timeouts en millisecondes */
export const TRADE_PENDING_TIMEOUT = 60_000;
export const TRADE_SELECTING_TIMEOUT = 120_000;
export const TRADE_CONFIRMING_TIMEOUT = 60_000;
export const TRADE_EXECUTING_TIMEOUT = 60_000;

/* ==================== Trade Evolution ==================== */

export type TradeEvolutionEntry = {
  from: number;
  to: number;
  form?: number;
  item_hold?: number;
  trade_with?: number;
};

export type TradeEvolutionResult = {
  to: number;
  form: number;
  consumeItem: boolean;
};

/** Charge le mapping des évolutions par échange depuis le fichier caché écrit par le jeu. */
export async function loadTradeEvolutions(): Promise<TradeEvolutionEntry[]> {
  try {
    // Try file first
    const raw = await invoke<string | null>("cmd_read_trade_evolutions");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Cache in localStorage
        try { localStorage.setItem("pnw_trade_evolutions", raw); } catch {}
        return parsed;
      }
    }
  } catch {}
  // Fallback to localStorage cache
  try {
    const cached = localStorage.getItem("pnw_trade_evolutions");
    if (cached) return JSON.parse(cached);
  } catch {}
  return [];
}

/** Vérifie si un Pokémon doit évoluer après un échange.
 * @param speciesId - ID de l'espèce du Pokémon reçu
 * @param form - Forme du Pokémon reçu
 * @param itemHolding - Objet tenu par le Pokémon reçu
 * @param evolutions - Table des évolutions par échange
 * @param sentSpeciesId - ID de l'espèce du Pokémon envoyé (pour trade_with : Karrablast/Shelmet)
 * @returns le résultat de l'évolution, ou null si pas d'évolution. */
export function checkTradeEvolution(
  speciesId: number,
  form: number,
  itemHolding: number | null | undefined,
  evolutions: TradeEvolutionEntry[],
  sentSpeciesId?: number,
): TradeEvolutionResult | null {
  for (const evo of evolutions) {
    if (evo.from !== speciesId) continue;
    if (evo.form != null && evo.form !== 0 && evo.form !== form) continue;
    // Si l'évolution nécessite un échange contre un Pokémon spécifique
    if (evo.trade_with != null && evo.trade_with > 0) {
      if (sentSpeciesId == null || sentSpeciesId !== evo.trade_with) continue;
    }
    // Si l'évolution nécessite un objet tenu, vérifier
    if (evo.item_hold != null && evo.item_hold > 0) {
      if (itemHolding == null || itemHolding !== evo.item_hold) continue;
    }
    return {
      to: evo.to,
      form: evo.form ?? form,
      consumeItem: evo.item_hold != null && evo.item_hold > 0,
    };
  }
  return null;
}

/* ==================== Utilitaires ==================== */

export function generateTradeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Vérifie que les bytes entrants sont valides (base64 → gunzip → Marshal). */
export function validateIncomingBytes(b64: string): boolean {
  try {
    if (!b64 || b64.length < 10 || b64.length > 50_000) return false;
    const bytes = decodePokemonFromGts(b64);
    return bytes.length > 10 && bytes.length < 30_000;
  } catch {
    return false;
  }
}

/** Encode un Pokémon depuis la save pour l'échange. */
export function extractAndEncode(
  rawBytes: Uint8Array,
  boxIdx: number,
  slotIdx: number,
): { pokemonB64: string; pokemon: unknown } {
  const ctx = loadSaveForEdit(rawBytes);
  const pokemon = extractPokemonFromBox(ctx.root, boxIdx, slotIdx);
  const pokemonB64 = encodePokemonForGts(pokemon);
  return { pokemonB64, pokemon };
}

/**
 * Exécute l'échange localement :
 * 1. Retire notre Pokémon de sa boîte
 * 2. Vérifie si le Pokémon reçu doit évoluer par échange
 * 3. Insère le Pokémon reçu (éventuellement évolué) dans un slot vide
 * 4. Écrit la save
 *
 * @returns le nom de la boîte et l'ID de l'évolution si applicable
 */
export async function executeTradeLocally(
  savePath: string,
  myBoxIdx: number,
  mySlotIdx: number,
  theirPokemonB64: string,
  theirSpeciesId?: number,
  theirForm?: number,
  theirItemHolding?: number | null,
  mySpeciesId?: number,
): Promise<{ boxName: string; evolvedTo?: number | null; evolvedForm?: number | null }> {
  // Vérifier que le jeu ne tourne pas
  const running = await invoke<boolean>("cmd_is_game_running");
  if (running) throw new Error("Fermez le jeu avant d'échanger.");

  // Charger la save
  const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
  if (!blob) throw new Error("Impossible de charger la sauvegarde.");
  const rawBytes = Uint8Array.from(atob(blob.bytes_b64), (c) => c.charCodeAt(0));

  // Retirer notre Pokémon
  const ctx1 = loadSaveForEdit(rawBytes);
  const patchedBytes = patchSlotToNil(ctx1.rawBytes, ctx1.marshalOffset, myBoxIdx, mySlotIdx);

  // Décoder le Pokémon reçu
  let theirBytes = decodePokemonFromGts(theirPokemonB64);

  // Vérifier l'évolution par échange
  let evolvedTo: number | null = null;
  let evolvedForm: number | null = null;
  if (theirSpeciesId != null && theirSpeciesId > 0) {
    const evolutions = await loadTradeEvolutions();
    const evoResult = checkTradeEvolution(theirSpeciesId, theirForm ?? 0, theirItemHolding, evolutions, mySpeciesId);
    if (evoResult != null) {
      evolvedTo = evoResult.to;
      evolvedForm = evoResult.form;
      // Modifier @id, @form et éventuellement @item_holding dans le Pokémon Marshal
      try {
        const { load: marshalLoad, dump: marshalDump } = await import("@hyrious/marshal");
        // Reconstituer les bytes Marshal complets (ajouter header 0x04 0x08)
        const fullBytes = new Uint8Array(theirBytes.length + 2);
        fullBytes[0] = 0x04; fullBytes[1] = 0x08;
        fullBytes.set(theirBytes, 2);
        const pokeObj = marshalLoad(fullBytes);
        if (pokeObj && typeof pokeObj === "object") {
          for (const k of Reflect.ownKeys(pokeObj as object)) {
            const name = typeof k === "symbol" ? String(k).slice(7, -1) : String(k);
            if (name === "@id") {
              (pokeObj as any)[k] = evoResult.to;
            } else if (name === "@form") {
              (pokeObj as any)[k] = evoResult.form;
            } else if (name === "@item_holding" && evoResult.consumeItem) {
              (pokeObj as any)[k] = 0;
            }
          }
          // Re-sérialiser et retirer le header
          const evolved = marshalDump(pokeObj);
          theirBytes = evolved.slice(2); // strip 0x04 0x08
        }
      } catch (e) {
        // Si l'évolution échoue, on insère quand même le Pokémon non-évolué
        console.warn("[Trade] Évolution échouée, insertion sans évolution:", e);
        evolvedTo = null;
      }
    }
  }

  // Trouver un slot vide et insérer
  const ctx2 = loadSaveForEdit(patchedBytes);
  const emptySlot = findFirstEmptySlot(ctx2.rawBytes, ctx2.marshalOffset);
  if (!emptySlot) throw new Error("Aucun slot vide dans vos boîtes PC.");

  const finalBytes = insertPokemonIntoSave(
    ctx2.rawBytes,
    ctx2.marshalOffset,
    emptySlot.boxIndex,
    emptySlot.slotIndex,
    theirBytes,
  );

  // Écrire la save (backup automatique côté Rust)
  await invoke("cmd_write_save_blob", {
    savePath,
    bytesB64: bytesToBase64(finalBytes),
  });

  return { boxName: `Boîte ${emptySlot.boxIndex + 1}`, evolvedTo, evolvedForm };
}

/** Construit le message embed de trade complété pour le DM. */
export function buildTradeMessage(data: TradeMessageData): string {
  return TRADE_PREFIX + JSON.stringify(data);
}

/** Parse un message embed de trade. */
export function parseTradeMessage(content: string): TradeMessageData | null {
  if (!content.startsWith(TRADE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(TRADE_PREFIX.length));
  } catch {
    return null;
  }
}

/* ==================== Types d'événements Broadcast ==================== */

export type TradeEvent =
  | { event: "trade_request"; payload: { tradeId: string; fromId: string; fromName: string; fromAvatar: string | null; toId: string; dmChannelId: number } }
  | { event: "trade_accept"; payload: { tradeId: string; fromId: string; toId: string } }
  | { event: "trade_decline"; payload: { tradeId: string; fromId: string; toId: string } }
  | { event: "trade_cancel"; payload: { tradeId: string; userId: string } }
  | { event: "trade_select"; payload: { tradeId: string; userId: string; preview: TradeSelectionPreview } }
  | { event: "trade_unselect"; payload: { tradeId: string; userId: string } }
  | { event: "trade_confirm"; payload: { tradeId: string; userId: string } }
  | { event: "trade_confirm_cancel"; payload: { tradeId: string; userId: string } }
  | { event: "trade_execute"; payload: { tradeId: string; userId: string; pokemonB64: string } }
  | { event: "trade_execute_ack"; payload: { tradeId: string; userId: string; pokemonB64: string } }
  | { event: "trade_complete"; payload: { tradeId: string; userId: string } }
  | { event: "trade_error"; payload: { tradeId: string; userId: string; message: string } };
