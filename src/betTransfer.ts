/**
 * betTransfer.ts — Logique de transfert de pari Pokémon.
 *
 * Côté launcher :
 *   - Extraction + encodage du Pokémon mis en jeu (via save blob, lecture seule)
 *   - Écriture du trigger IPC pour le jeu (action "bet_transfer")
 *   - Persistance dans Supabase (pokemon_bet_transfers)
 *   - Fallback save patching si le jeu n'a pas lu le trigger
 *
 * Côté jeu (VMS Ruby) : voir 00004_VMS_UI.rb handler "bet_transfer"
 */
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabaseClient";
import { extractAndEncode } from "./tradeP2P";
import {
  loadSaveForEdit,
  patchSlotToNil,
  decodePokemonFromGts,
  findFirstEmptySlot,
  insertPokemonIntoSave,
} from "./saveWriter";
import type { TradeSelectionPreview, PendingBetTransfer } from "./types";
import { writeBetTransferTrigger } from "./battleRelay";

/* ==================== Extraction (avant combat) ==================== */

/**
 * Extrait et encode un Pokémon depuis la save pour le pari.
 * Lecture seule — fonctionne même si le jeu tourne.
 */
export async function extractBetPokemon(
  savePath: string,
  boxIdx: number,
  slotIdx: number,
): Promise<{ pokemonB64: string } | null> {
  try {
    const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
    if (!blob) return null;
    const rawBytes = Uint8Array.from(atob(blob.bytes_b64), (c) => c.charCodeAt(0));
    const { pokemonB64 } = extractAndEncode(rawBytes, boxIdx, slotIdx);
    return { pokemonB64 };
  } catch (e) {
    console.error("[BetTransfer] extractBetPokemon error:", e);
    return null;
  }
}

/* ==================== Trigger IPC (après combat) ==================== */

/**
 * Envoie le trigger de transfert de pari au jeu.
 * Appelé automatiquement à la fin du combat.
 */
export async function sendBetTransfer(opts: {
  result: "win" | "loss" | "draw";
  receivePokemonB64?: string;
  removeBoxIdx?: number;
  removeSlotIdx?: number;
}): Promise<void> {
  await writeBetTransferTrigger(opts);
}

/**
 * Poll `vms_bet_done.json` pour vérifier si le jeu a appliqué le transfert.
 * Retourne le résultat ou null si pas encore traité.
 */
export async function pollBetDone(): Promise<{ status: string; result: string; pokemon?: string; box?: string; error?: string } | null> {
  try {
    const raw = await invoke<string | null>("cmd_battle_read_bet_done");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ==================== Supabase (persistance) ==================== */

/**
 * Enregistre le pari dans Supabase pour persistance en cas de crash.
 */
export async function saveBetToSupabase(opts: {
  roomCode: string;
  winnerId: string;
  loserId: string;
  winnerReceivesB64: string;
  winnerReceivesPreview: TradeSelectionPreview;
  loserLosesPreview: TradeSelectionPreview;
  loserBoxIdx: number;
  loserSlotIdx: number;
}): Promise<void> {
  try {
    await supabase.from("pokemon_bet_transfers").insert({
      room_code: opts.roomCode,
      winner_id: opts.winnerId,
      loser_id: opts.loserId,
      winner_receives_b64: opts.winnerReceivesB64,
      winner_receives_preview: opts.winnerReceivesPreview,
      loser_loses_preview: opts.loserLosesPreview,
      loser_box_idx: opts.loserBoxIdx,
      loser_slot_idx: opts.loserSlotIdx,
      status: "pending",
    });
    console.log("[BetTransfer] Bet saved to Supabase");
  } catch (e) {
    console.error("[BetTransfer] saveBetToSupabase error:", e);
  }
}

/**
 * Récupère les paris en attente pour l'utilisateur.
 */
export async function fetchPendingBets(userId: string): Promise<PendingBetTransfer[]> {
  try {
    const { data } = await supabase
      .from("pokemon_bet_transfers")
      .select("*")
      .eq("status", "pending")
      .or(`winner_id.eq.${userId},loser_id.eq.${userId}`);
    return (data ?? []) as PendingBetTransfer[];
  } catch {
    return [];
  }
}

/**
 * Marque un pari comme complété dans Supabase.
 */
export async function completeBet(betId: number): Promise<void> {
  await supabase
    .from("pokemon_bet_transfers")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", betId);
}

/* ==================== Fallback save patching ==================== */

/**
 * Applique un pari en attente via save patching (quand le jeu n'a pas lu le trigger).
 * Nécessite que le jeu NE SOIT PAS en train de tourner.
 */
export async function applyPendingBetFallback(
  savePath: string,
  bet: PendingBetTransfer,
  currentUserId: string,
): Promise<boolean> {
  const running = await invoke<boolean>("cmd_is_game_running");
  if (running) return false;

  try {
    const blob = await invoke<{ bytes_b64: string } | null>("cmd_get_save_blob", { savePath });
    if (!blob) return false;
    let rawBytes = new Uint8Array(Uint8Array.from(atob(blob.bytes_b64), (c) => c.charCodeAt(0)).buffer);

    const isWinner = currentUserId === bet.winner_id;

    if (isWinner) {
      // Insérer le Pokémon gagné dans le premier slot vide
      const theirBytes = decodePokemonFromGts(bet.winner_receives_b64);
      const ctx = loadSaveForEdit(rawBytes);
      const emptySlot = findFirstEmptySlot(ctx.rawBytes, ctx.marshalOffset);
      if (!emptySlot) {
        console.warn("[BetTransfer] No empty slot to insert won Pokémon");
        return false;
      }
      rawBytes = insertPokemonIntoSave(ctx.rawBytes, ctx.marshalOffset, emptySlot.boxIndex, emptySlot.slotIndex, theirBytes) as Uint8Array<ArrayBuffer>;
    } else {
      // Retirer le Pokémon perdu
      const ctx = loadSaveForEdit(rawBytes);
      rawBytes = patchSlotToNil(ctx.rawBytes, ctx.marshalOffset, bet.loser_box_idx, bet.loser_slot_idx) as Uint8Array<ArrayBuffer>;
    }

    // Écrire la save modifiée
    const b64 = btoa(String.fromCharCode(...rawBytes));
    await invoke("cmd_write_save_blob", { savePath, bytesB64: b64 });

    // Marquer comme complété
    await completeBet(bet.id);
    console.log("[BetTransfer] Fallback applied for bet", bet.id, isWinner ? "(winner)" : "(loser)");
    return true;
  } catch (e) {
    console.error("[BetTransfer] applyPendingBetFallback error:", e);
    return false;
  }
}
