import { useState, useEffect } from "react";
import {
  FaCrown,
  FaArrowLeft,
  FaUsers,
  FaStar,
  FaSuitcase,
  FaChevronDown,
  FaChevronUp,
  FaLightbulb,
  FaChartBar,
  FaSpinner,
  FaTriangleExclamation,
  FaQuestion,
  FaBookOpen,
} from "react-icons/fa6";

/* ── Types ── */
interface BossPokemon {
  name: string;
  imageUrl?: string;
  level: number;
  types: string[];
  ability?: string;
  item?: string;
  moves: string[];
  evs?: Record<string, number>;
}

interface Boss {
  name: string;
  class: string;
  difficulty: string;
  description?: string;
  artworkUrl?: string;
  storyUrl?: string;
  reward?: string;
  tips?: string[];
  team: BossPokemon[];
}

/* ── Couleurs et labels de type ── */
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  plante: { bg: "rgba(126,200,80,.35)", border: "rgba(126,200,80,.6)", text: "#a6e88a" },
  feu: { bg: "rgba(240,128,48,.35)", border: "rgba(240,128,48,.6)", text: "#f5a962" },
  eau: { bg: "rgba(104,144,240,.35)", border: "rgba(104,144,240,.6)", text: "#7eb8f2" },
  glace: { bg: "rgba(126,206,206,.35)", border: "rgba(126,206,206,.6)", text: "#98d8d8" },
  malice: { bg: "rgba(112,88,152,.35)", border: "rgba(112,88,152,.6)", text: "#b8a8d8" },
  poison: { bg: "rgba(160,64,160,.35)", border: "rgba(160,64,160,.6)", text: "#c183c1" },
  vol: { bg: "rgba(168,144,240,.35)", border: "rgba(168,144,240,.6)", text: "#c6b7f5" },
  dragon: { bg: "rgba(112,56,248,.35)", border: "rgba(112,56,248,.6)", text: "#a78bfa" },
  sol: { bg: "rgba(224,192,104,.35)", border: "rgba(224,192,104,.6)", text: "#e8d68c" },
  combat: { bg: "rgba(192,48,40,.35)", border: "rgba(192,48,40,.6)", text: "#f07878" },
  spectre: { bg: "rgba(112,88,152,.35)", border: "rgba(112,88,152,.6)", text: "#a890f0" },
  psy: { bg: "rgba(248,88,136,.35)", border: "rgba(248,88,136,.6)", text: "#f8a8c8" },
  electr: { bg: "rgba(248,208,48,.35)", border: "rgba(248,208,48,.6)", text: "#f8d030" },
  fee: { bg: "rgba(238,153,172,.35)", border: "rgba(238,153,172,.6)", text: "#f0b0c0" },
  tenebres: { bg: "rgba(112,88,72,.35)", border: "rgba(112,88,72,.6)", text: "#a09080" },
  roche: { bg: "rgba(184,160,56,.35)", border: "rgba(184,160,56,.6)", text: "#d8c878" },
  acier: { bg: "rgba(168,168,192,.35)", border: "rgba(168,168,192,.6)", text: "#c0c0e0" },
  normal: { bg: "rgba(168,168,120,.25)", border: "rgba(168,168,120,.5)", text: "#c6c6a7" },
  insecte: { bg: "rgba(168,184,32,.35)", border: "rgba(168,184,32,.6)", text: "#c6d16e" },
  aspic: { bg: "rgba(160,128,96,.35)", border: "rgba(160,128,96,.6)", text: "#d4b896" },
};

const TYPE_LABELS: Record<string, string> = {
  acier: "Acier", aspic: "Aspic", combat: "Combat", dragon: "Dragon", eau: "Eau",
  electr: "Electrik", fee: "Fée", feu: "Feu", glace: "Glace", insecte: "Insecte",
  malice: "Malice", normal: "Normal", plante: "Plante", poison: "Poison",
  psy: "Psy", roche: "Roche", sol: "Sol", spectre: "Spectre", tenebres: "Ténèbres", vol: "Vol",
};

const EV_LABELS: Record<string, string> = {
  hp: "PV", atk: "Atk", def: "Déf", spa: "Atk Spé", spd: "Déf Spé", spe: "Vit",
};

const DIFFICULTY_LEVELS: Record<string, number> = { facile: 25, moyen: 50, difficile: 75, extreme: 100 };
const DIFFICULTY_LABELS: Record<string, string> = { facile: "Facile", moyen: "Moyen", difficile: "Difficile", extreme: "Extrême" };
const DIFFICULTY_COLORS: Record<string, string> = { facile: "#4ade80", moyen: "#fbbf24", difficile: "#f87171", extreme: "#c084fc" };

function getTypeStyle(type: string) {
  const key = (type || "").toLowerCase().trim();
  const s = TYPE_COLORS[key] || { bg: "rgba(255,255,255,.1)", border: "rgba(255,255,255,.25)", text: "#ccc" };
  return { background: s.bg, border: `1px solid ${s.border}`, color: s.text };
}

function getTypeLabel(key: string) {
  const k = (key || "").toLowerCase().trim();
  return TYPE_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}

/* ── Pokemon Card ── */
function PokemonCard({ pokemon }: { pokemon: BossPokemon }) {
  const evs = pokemon.evs || {};
  const hasEvs = Object.values(evs).some((v) => v > 0);

  return (
    <div className="bg-[rgba(0,0,0,.3)] border border-white/10 rounded-xl p-3 flex flex-col gap-2">
      {/* Header: sprite + name + level */}
      <div className="flex items-center gap-2.5">
        <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden shrink-0">
          {pokemon.imageUrl ? (
            <img src={pokemon.imageUrl} alt="" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <FaQuestion className="text-white/30" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-white">{pokemon.name}</span>
          <span className="text-xs text-white/50">Nv. {pokemon.level}</span>
        </div>
      </div>

      {/* Types */}
      <div className="flex flex-wrap gap-1">
        {(pokemon.types || []).map((t) => (
          <span key={t} className="text-[.68rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full" style={getTypeStyle(t)}>
            {getTypeLabel(t)}
          </span>
        ))}
      </div>

      {/* Ability */}
      {pokemon.ability && (
        <div className="text-xs italic text-white/50 flex items-center gap-1.5">
          <FaStar className="text-yellow-400/50 text-[.6rem]" /> {pokemon.ability}
        </div>
      )}

      {/* Item */}
      {pokemon.item && (
        <div className="text-xs italic text-white/50 flex items-center gap-1.5">
          <FaSuitcase className="text-blue-300/50 text-[.6rem]" /> {pokemon.item}
        </div>
      )}

      {/* Moves */}
      {pokemon.moves?.length > 0 && (
        <ul className="flex flex-col gap-0.5 mt-0.5">
          {pokemon.moves.map((m, i) => (
            <li key={i} className="text-xs text-white/60 pl-3 relative before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-1 before:rounded-full before:bg-white/25">
              {m}
            </li>
          ))}
        </ul>
      )}

      {/* EVs */}
      {hasEvs && (
        <div className="mt-1 bg-black/20 rounded-lg p-2">
          <div className="text-[.65rem] uppercase tracking-wide text-white/40 flex items-center gap-1 mb-1.5">
            <FaChartBar className="text-[.55rem]" /> EVs
          </div>
          <div className="flex flex-col gap-1">
            {Object.entries(EV_LABELS).map(([key, label]) => {
              const val = evs[key] || 0;
              if (val === 0) return null;
              return (
                <div key={key} className="flex items-center gap-1.5 text-[.65rem]">
                  <span className="w-10 text-white/40 text-right">{label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${Math.min(val / 252 * 100, 100)}%` }} />
                  </div>
                  <span className="w-6 text-white/50 text-right">{val}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Boss Card ── */
function BossCard({ boss }: { boss: Boss }) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const hasTips = boss.tips && boss.tips.length > 0;
  const pct = DIFFICULTY_LEVELS[(boss.difficulty || "").toLowerCase()] || 0;
  const diffLabel = DIFFICULTY_LABELS[(boss.difficulty || "").toLowerCase()] || boss.difficulty;
  const diffColor = DIFFICULTY_COLORS[(boss.difficulty || "").toLowerCase()] || "#888";

  return (
    <div className="bg-[rgba(15,15,25,.7)] border border-white/10 rounded-2xl overflow-hidden">
      {/* Trainer section */}
      <div className="p-5 flex gap-5 items-start">
        {/* Artwork */}
        <div className="w-20 h-20 rounded-xl bg-black/30 border border-white/10 shrink-0 overflow-hidden flex items-center justify-center">
          {boss.artworkUrl ? (
            <img src={boss.artworkUrl} alt={boss.name} className="w-full h-full object-contain" />
          ) : (
            <FaCrown className="text-2xl text-white/20" />
          )}
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-white/40">{boss.class}</p>
          <h3 className="text-lg font-bold text-white mt-0.5">{boss.name}</h3>

          {/* Difficulty bar */}
          {pct > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[.7rem] font-semibold" style={{ color: diffColor }}>{diffLabel}</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: diffColor }} />
              </div>
            </div>
          )}

          {boss.description && <p className="text-xs text-white/40 mt-2 leading-relaxed">{boss.description}</p>}

          {boss.reward && (
            <div className="text-xs text-yellow-400/70 mt-2 flex items-center gap-1">
              <FaCrown className="text-[.6rem]" /> {boss.reward}{!/₱/.test(boss.reward) && " ₱"}
            </div>
          )}

          {boss.storyUrl && (
            <a href={boss.storyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-purple-300/70 hover:text-purple-200 mt-2 transition-colors">
              <FaBookOpen className="text-[.6rem]" /> Histoire
            </a>
          )}
        </div>
      </div>

      {/* Team toggle */}
      <button
        type="button"
        className="w-full px-5 py-2.5 flex items-center justify-between text-sm font-semibold text-white/70 hover:text-white/90 bg-white/[.03] hover:bg-white/[.06] border-t border-white/5 transition-colors"
        onClick={() => setTeamOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <FaUsers className="text-xs" /> Voir l'équipe ({boss.team?.length || 0})
        </span>
        {teamOpen ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
      </button>

      {teamOpen && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-white/5">
          {(boss.team || []).map((p, i) => (
            <PokemonCard key={`${p.name}-${i}`} pokemon={p} />
          ))}
        </div>
      )}

      {/* Tips */}
      {hasTips && (
        <>
          <button
            type="button"
            className="w-full px-5 py-2.5 flex items-center justify-between text-sm font-semibold text-amber-300/60 hover:text-amber-300/90 bg-white/[.02] hover:bg-white/[.04] border-t border-white/5 transition-colors"
            onClick={() => setTipsOpen((o) => !o)}
          >
            <span className="flex items-center gap-2">
              <FaLightbulb className="text-xs" /> Astuces
            </span>
            {tipsOpen ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
          </button>

          {tipsOpen && (
            <div className="p-4 flex flex-col gap-2 border-t border-white/5">
              {boss.tips!.map((tip, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-400/10 text-amber-300/60 text-[.65rem] flex items-center justify-center font-bold">{i + 1}</span>
                  <p className="text-xs text-white/50 leading-relaxed">{tip}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Main View ── */
export default function BossView({ siteUrl, onBack }: { siteUrl: string; onBack: () => void }) {
  const [bosses, setBosses] = useState<Boss[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const base = siteUrl.replace(/\/$/, "");
    fetch(`${base}/api/boss?t=${Date.now()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d?.boss) {
          setBosses(d.boss.bosses || []);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [siteUrl]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-6">
        <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors mb-4">
          <FaArrowLeft className="text-xs" /> Retour
        </button>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <FaCrown className="text-yellow-400/70" /> Boss du jeu
        </h1>
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300/70 text-xs">
          <FaTriangleExclamation /> Attention, risque de spoil !
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {loading && (
          <div className="flex items-center justify-center py-12 gap-3 text-white/40">
            <FaSpinner className="animate-spin" /> Chargement...
          </div>
        )}

        {error && !loading && (
          <p className="text-center py-12 text-white/30">Les boss sont temporairement indisponibles.</p>
        )}

        {!loading && !error && bosses.length === 0 && (
          <p className="text-center py-12 text-white/30">Aucun boss pour le moment.</p>
        )}

        {bosses.map((boss, i) => (
          <BossCard key={`${boss.name}-${i}`} boss={boss} />
        ))}
      </div>
    </div>
  );
}
