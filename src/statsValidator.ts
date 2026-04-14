// src/statsValidator.ts
// Vérification anti-triche des statistiques d'une équipe avant un combat PvP.
// Règles standards Pokémon (limites utilisées dans tous les jeux officiels) :
//   - IV : max 31 par stat
//   - EV : max 252 par stat ET max 510 au total
// Toute valeur en dehors de ces limites bloque l'accès au combat.

import type { TeamMember, ChatProfile } from "./types";

export const MAX_IV = 31;
export const MAX_EV_PER_STAT = 252;
export const MAX_EV_TOTAL = 510;

/** Une violation identifiée sur un Pokémon de l'équipe. */
export type StatViolation =
  | { kind: "iv_over"; stat: StatKey; value: number }
  | { kind: "ev_over"; stat: StatKey; value: number }
  | { kind: "ev_total_over"; total: number };

export type StatKey = "hp" | "atk" | "dfe" | "spd" | "ats" | "dfs";

/** Résultat de la vérification d'un Pokémon. */
export type InvalidStatsEntry = {
  slotIdx: number;
  /** Nom affiché (nickname si présent, sinon espèce, sinon #id). */
  label: string;
  violations: StatViolation[];
};

/** Libellés courts des stats (pour affichage dans le popup). */
export const STAT_LABELS_FR: Record<StatKey, string> = {
  hp: "PV",
  atk: "Atq",
  dfe: "Déf",
  spd: "Vit",
  ats: "Atq Spé",
  dfs: "Déf Spé",
};

export const STAT_LABELS_EN: Record<StatKey, string> = {
  hp: "HP",
  atk: "Atk",
  dfe: "Def",
  spd: "Spe",
  ats: "SpA",
  dfs: "SpD",
};

type StatField = {
  key: StatKey;
  iv: keyof TeamMember;
  ev: keyof TeamMember;
};

const STAT_FIELDS: StatField[] = [
  { key: "hp", iv: "ivHp", ev: "evHp" },
  { key: "atk", iv: "ivAtk", ev: "evAtk" },
  { key: "dfe", iv: "ivDfe", ev: "evDfe" },
  { key: "spd", iv: "ivSpd", ev: "evSpd" },
  { key: "ats", iv: "ivAts", ev: "evAts" },
  { key: "dfs", iv: "ivDfs", ev: "evDfs" },
];

/** Récupère un nombre d'un champ TeamMember (retourne 0 si absent/invalide). */
function readStat(tm: TeamMember, key: keyof TeamMember): number {
  const v = tm[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

/**
 * Valide une équipe entière. Retourne la liste (ordonnée par slot) des
 * Pokémons qui ont au moins une violation de règle IV ou EV.
 *
 * @param speciesNames — tableau PSDK (index = ID interne, valeur = nom FR).
 *   Utilisé comme fallback si le TeamMember n'a pas de speciesName.
 */
export function validateTeamStats(
  team: TeamMember[] | undefined | null,
  speciesNames: string[] | null = null,
): InvalidStatsEntry[] {
  if (!team || team.length === 0) return [];
  const invalid: InvalidStatsEntry[] = [];

  for (let i = 0; i < team.length; i++) {
    const tm = team[i];
    if (!tm) continue;
    // On considère un slot "actif" s'il a un code d'espèce > 0
    const speciesId =
      typeof tm.code === "number" ? tm.code : parseInt(String(tm.code ?? ""), 10);
    if (!Number.isFinite(speciesId) || speciesId <= 0) continue;

    const violations: StatViolation[] = [];
    let evTotal = 0;

    for (const f of STAT_FIELDS) {
      const ivVal = readStat(tm, f.iv);
      const evVal = readStat(tm, f.ev);
      if (ivVal > MAX_IV) {
        violations.push({ kind: "iv_over", stat: f.key, value: ivVal });
      }
      if (evVal > MAX_EV_PER_STAT) {
        violations.push({ kind: "ev_over", stat: f.key, value: evVal });
      }
      evTotal += evVal;
    }

    if (evTotal > MAX_EV_TOTAL) {
      violations.push({ kind: "ev_total_over", total: evTotal });
    }

    if (violations.length > 0) {
      // Résolution du nom : nickname > speciesName (VMS) > speciesNames[id] (PSDK) > #id
      const resolvedName =
        tm.nickname?.trim() ||
        tm.speciesName?.trim() ||
        (speciesNames && speciesId < speciesNames.length ? speciesNames[speciesId] : null) ||
        `#${speciesId}`;
      invalid.push({ slotIdx: i, label: resolvedName, violations });
    }
  }

  return invalid;
}

/**
 * Envoie un rapport de triche au serveur PNW (qui forward vers Discord webhook).
 * Fire-and-forget : ne bloque pas le flow UI et ne throw jamais.
 */
export function reportCheatToServer(
  siteUrl: string,
  profile: ChatProfile,
  invalid: InvalidStatsEntry[],
): void {
  if (invalid.length === 0) return;
  const base = siteUrl.replace(/\/$/, "");
  fetch(`${base}/api/report-cheat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerName: profile.display_name || profile.username || "Inconnu",
      playerUsername: profile.username || null,
      discordId: profile.discord_id || null,
      avatarUrl: profile.avatar_url || null,
      violations: invalid.map((e) => ({
        label: e.label,
        slotIdx: e.slotIdx,
        violations: e.violations,
      })),
    }),
  }).catch(() => {}); // silencieux — ne doit jamais impacter le joueur
}
