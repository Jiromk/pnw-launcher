import React, { useEffect, useState } from "react";
import {
  FaUsers, FaVolumeXmark, FaBan, FaMagnifyingGlass, FaXmark,
  FaCheck, FaSpinner, FaTrash, FaCrown, FaHeart,
  FaStar, FaCode, FaArrowLeft, FaClock,
  FaHashtag, FaImage, FaFloppyDisk, FaPen,
} from "react-icons/fa6";
import { supabase } from "../supabaseClient";
import type { ChatProfile, ChatMute, ChatBan, ChatChannel } from "../types";
import {
  getAllProfiles, updateUserRoles, updateUserDisplayName, getAllActiveMutes, getAllActiveBans,
  unmuteUser, unbanUser, updateChannelBackground,
} from "../chatAuth";

const ALL_ROLES = ["admin", "devteam", "patreon", "vip"] as const;

const ROLE_INFO: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  admin:    { icon: <FaCrown />,  color: "#e74c3c", label: "Admin" },
  devteam:  { icon: <FaCode />,   color: "#3498db", label: "Dev Team" },
  patreon:  { icon: <FaHeart />,  color: "#f96854", label: "Patreon" },
  vip:      { icon: <FaStar />,   color: "#f1c40f", label: "VIP" },
};

function displayName(p: ChatProfile): string {
  return p.display_name?.trim() || p.username || "Joueur";
}

function formatExpiry(expires_at: string | null): string {
  if (!expires_at) return "Permanent";
  const d = new Date(expires_at);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Tab = "members" | "channels" | "mutes" | "bans";

type LogEntry = {
  type: "edit" | "delete" | "mute" | "unmute" | "ban" | "unban";
  modName: string; modAvatar?: string | null; modId: string;
  targetName: string; targetAvatar?: string | null; targetId: string;
  detail?: string;
};

export default function AdminPanel({ onClose, onLog, onMemberUpdate }: { onClose: () => void; onLog?: (entry: LogEntry) => void; onMemberUpdate?: (userId: string, fields: Partial<ChatProfile>) => void }) {
  const [tab, setTab] = useState<Tab>("members");
  const [search, setSearch] = useState("");

  // Members
  const [profiles, setProfiles] = useState<ChatProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);

  // Channels
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [editingBg, setEditingBg] = useState<number | null>(null);
  const [bgUrl, setBgUrl] = useState("");
  const [savingBg, setSavingBg] = useState(false);
  const [editingRoles, setEditingRoles] = useState<string | null>(null);
  const [tempRoles, setTempRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  // Name editing
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Mutes & Bans
  const [mutes, setMutes] = useState<(ChatMute & { profiles?: ChatProfile })[]>([]);
  const [bans, setBans] = useState<(ChatBan & { profiles?: ChatProfile })[]>([]);

  useEffect(() => { loadData(); }, [tab]);

  async function loadData() {
    if (tab === "members") {
      setLoadingProfiles(true);
      setProfiles(await getAllProfiles());
      setLoadingProfiles(false);
    } else if (tab === "channels") {
      const { data } = await supabase.from("channels").select("*").in("type", ["public", "moderation"]).order("id");
      setChannels((data as ChatChannel[]) || []);
    } else if (tab === "mutes") {
      setMutes(await getAllActiveMutes());
    } else {
      setBans(await getAllActiveBans());
    }
  }

  // Role editing
  function startEditRoles(p: ChatProfile) {
    setEditingRoles(p.id);
    setTempRoles([...p.roles]);
  }

  function toggleRole(role: string) {
    setTempRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function saveRoles(userId: string) {
    setSavingRoles(true);
    await updateUserRoles(userId, tempRoles);
    setProfiles((prev) => prev.map((p) => p.id === userId ? { ...p, roles: tempRoles } : p));
    onMemberUpdate?.(userId, { roles: tempRoles });
    setEditingRoles(null);
    setSavingRoles(false);
  }

  function startEditName(p: ChatProfile) {
    setEditingName(p.id);
    setTempName(p.display_name || "");
  }

  async function saveName(userId: string) {
    setSavingName(true);
    const newName = tempName.trim() || null;
    const ok = await updateUserDisplayName(userId, tempName);
    if (ok) {
      setProfiles((prev) => prev.map((p) => p.id === userId ? { ...p, display_name: newName } : p));
      onMemberUpdate?.(userId, { display_name: newName });
    }
    setEditingName(null);
    setSavingName(false);
  }

  async function handleSaveBg(channelId: number) {
    setSavingBg(true);
    const url = bgUrl.trim() || null;
    await updateChannelBackground(channelId, url);
    setChannels((prev) => prev.map((c) => c.id === channelId ? { ...c, background_url: url } : c));
    setEditingBg(null);
    setBgUrl("");
    setSavingBg(false);
  }

  async function handleUnmute(id: number) {
    const mute = mutes.find((m) => m.id === id);
    await unmuteUser(id);
    setMutes((prev) => prev.filter((m) => m.id !== id));
    if (mute?.profiles) {
      onLog?.({ type: "unmute", modName: "", modAvatar: null, modId: "", targetName: displayName(mute.profiles as ChatProfile), targetAvatar: (mute.profiles as ChatProfile).avatar_url, targetId: mute.user_id });
    }
  }

  async function handleUnban(id: number) {
    const ban = bans.find((b) => b.id === id);
    await unbanUser(id);
    setBans((prev) => prev.filter((b) => b.id !== id));
    if (ban?.profiles) {
      onLog?.({ type: "unban", modName: "", modAvatar: null, modId: "", targetName: displayName(ban.profiles as ChatProfile), targetAvatar: (ban.profiles as ChatProfile).avatar_url, targetId: ban.user_id });
    }
  }

  const filtered = profiles.filter((p) => {
    const q = search.toLowerCase();
    return !q || displayName(p).toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
  });
  const visibleMembers = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  return (
    <div className="pnw-admin-overlay" onClick={onClose}>
      <div className="pnw-admin-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pnw-admin-header">
          <FaCrown style={{ color: "#e74c3c", fontSize: 16, filter: "drop-shadow(0 0 6px rgba(231,76,60,.3))" }} />
          <span className="pnw-admin-title">Administration</span>
          <button className="pnw-chat-header-btn" onClick={onClose} style={{ marginLeft: "auto" }}><FaXmark /></button>
        </div>

      {/* Tabs */}
      <div className="pnw-admin-tabs">
        <button className={`pnw-admin-tab ${tab === "members" ? "pnw-admin-tab--active" : ""}`} onClick={() => setTab("members")}>
          <FaUsers /> Membres {profiles.length > 0 && <span style={{ opacity:.5, fontSize:".6rem" }}>({profiles.length})</span>}
        </button>
        <button className={`pnw-admin-tab ${tab === "channels" ? "pnw-admin-tab--active" : ""}`} onClick={() => setTab("channels")}>
          <FaHashtag /> Salons
        </button>
        <button className={`pnw-admin-tab ${tab === "mutes" ? "pnw-admin-tab--active" : ""}`} onClick={() => setTab("mutes")}>
          <FaVolumeXmark /> Mutes {mutes.length > 0 && <span style={{ color:"#f39c12", fontSize:".6rem" }}>({mutes.length})</span>}
        </button>
        <button className={`pnw-admin-tab ${tab === "bans" ? "pnw-admin-tab--active" : ""}`} onClick={() => setTab("bans")}>
          <FaBan /> Bans {bans.length > 0 && <span style={{ color:"#e74c3c", fontSize:".6rem" }}>({bans.length})</span>}
        </button>
      </div>

      {/* Content */}
      <div className="pnw-admin-content pnw-scrollbar">

        {/* === MEMBERS === */}
        {tab === "members" && (
          <>
            <div className="pnw-admin-search">
              <FaMagnifyingGlass />
              <input
                placeholder="Rechercher un membre…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisibleCount(50); }}
              />
            </div>

            {loadingProfiles ? (
              <div className="pnw-admin-loading"><FaSpinner className="pnw-chat-spinner" /> Chargement…</div>
            ) : (
              <div className="pnw-admin-member-list">
                {visibleMembers.map((p) => (
                  <div key={p.id} className="pnw-admin-member">
                    <div className="pnw-admin-member-info">
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="pnw-admin-member-avatar" />
                      ) : (
                        <div className="pnw-admin-member-avatar pnw-admin-member-avatar--placeholder">
                          {displayName(p)[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="pnw-admin-member-text">
                        {editingName === p.id ? (
                          <div className="pnw-admin-name-edit">
                            <input
                              className="pnw-admin-name-input"
                              value={tempName}
                              onChange={(e) => setTempName(e.target.value)}
                              placeholder={p.username}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") saveName(p.id); if (e.key === "Escape") setEditingName(null); }}
                            />
                            <button className="pnw-admin-name-save" onClick={() => saveName(p.id)} disabled={savingName} title="Sauvegarder">
                              {savingName ? <FaSpinner className="pnw-chat-spinner" /> : <FaCheck />}
                            </button>
                            <button className="pnw-admin-name-cancel" onClick={() => setEditingName(null)} title="Annuler">
                              <FaXmark />
                            </button>
                          </div>
                        ) : (
                          <span className="pnw-admin-member-name">
                            {displayName(p)}
                            <button className="pnw-admin-name-edit-btn" onClick={() => startEditName(p)} title="Renommer"><FaPen /></button>
                          </span>
                        )}
                        <span className="pnw-admin-member-discord">{p.username}</span>
                      </div>
                    </div>

                    {editingRoles === p.id ? (
                      <div className="pnw-admin-roles-edit">
                        <div className="pnw-admin-roles-grid">
                          {ALL_ROLES.map((role) => {
                            const info = ROLE_INFO[role];
                            const active = tempRoles.includes(role);
                            return (
                              <button
                                key={role}
                                className={`pnw-admin-role-toggle ${active ? "pnw-admin-role-toggle--active" : ""}`}
                                style={active ? { borderColor: info.color, background: `${info.color}20` } : undefined}
                                onClick={() => toggleRole(role)}
                              >
                                <span style={{ color: info.color }}>{info.icon}</span>
                                <span>{info.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="pnw-admin-roles-actions">
                          <button className="pnw-admin-btn pnw-admin-btn--cancel" onClick={() => setEditingRoles(null)}>
                            <FaXmark /> Annuler
                          </button>
                          <button className="pnw-admin-btn pnw-admin-btn--save" onClick={() => saveRoles(p.id)} disabled={savingRoles}>
                            {savingRoles ? <FaSpinner className="pnw-chat-spinner" /> : <FaCheck />} Sauvegarder
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="pnw-admin-member-roles">
                        {p.roles.length ? p.roles.map((r) => {
                          const info = ROLE_INFO[r];
                          if (!info) return null;
                          return (
                            <span key={r} className="pnw-admin-role-pill" style={{ background: info.color }}>
                              {info.icon} {info.label}
                            </span>
                          );
                        }) : <span className="pnw-admin-no-role">Aucun rôle</span>}
                        <button className="pnw-admin-edit-btn" onClick={() => startEditRoles(p)}>Modifier</button>
                      </div>
                    )}
                  </div>
                ))}
                {hasMore && (
                  <button
                    className="pnw-admin-load-more"
                    onClick={() => setVisibleCount((v) => v + 50)}
                  >
                    Afficher plus ({filtered.length - visibleCount} restants)
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* === CHANNELS === */}
        {tab === "channels" && (
          <div className="pnw-admin-channel-list">
            {channels.map((ch) => (
              <div key={ch.id} className="pnw-admin-channel-card">
                {/* Preview */}
                <div
                  className="pnw-admin-channel-preview"
                  style={ch.background_url ? { backgroundImage: `url(${ch.background_url})` } : undefined}
                >
                  <div className="pnw-admin-channel-preview-overlay">
                    <FaHashtag /> <span>{ch.name}</span>
                  </div>
                </div>

                {/* Background URL editing */}
                {editingBg === ch.id ? (
                  <div className="pnw-admin-channel-edit">
                    <input
                      className="pnw-mod-input"
                      value={bgUrl}
                      onChange={(e) => setBgUrl(e.target.value)}
                      placeholder="URL du background (.png, .jpg…)"
                      autoFocus
                    />
                    <div className="pnw-admin-roles-actions" style={{ marginTop: 8 }}>
                      <button className="pnw-admin-btn pnw-admin-btn--cancel" onClick={() => { setEditingBg(null); setBgUrl(""); }}>
                        <FaXmark /> Annuler
                      </button>
                      <button className="pnw-admin-btn pnw-admin-btn--save" onClick={() => handleSaveBg(ch.id)} disabled={savingBg}>
                        {savingBg ? <FaSpinner className="pnw-chat-spinner" /> : <FaFloppyDisk />} Sauvegarder
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pnw-admin-channel-footer">
                    <span className="pnw-admin-channel-bg-label">
                      {ch.background_url ? "Background défini" : "Aucun background"}
                    </span>
                    <button
                      className="pnw-admin-edit-btn"
                      onClick={() => { setEditingBg(ch.id); setBgUrl(ch.background_url || ""); }}
                    >
                      <FaImage /> Modifier
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* === MUTES === */}
        {tab === "mutes" && (
          <div className="pnw-admin-sanction-list">
            {!mutes.length && <div className="pnw-admin-empty">Aucun mute actif</div>}
            {mutes.map((m) => (
              <div key={m.id} className="pnw-admin-sanction">
                <div className="pnw-admin-sanction-info">
                  <FaVolumeXmark style={{ color: "#f39c12" }} />
                  <span className="pnw-admin-sanction-name">{(m as any).profiles?.display_name || (m as any).profiles?.username || "Inconnu"}</span>
                </div>
                <div className="pnw-admin-sanction-details">
                  {m.reason && <span className="pnw-admin-sanction-reason">{m.reason}</span>}
                  <span className="pnw-admin-sanction-expiry"><FaClock /> {formatExpiry(m.expires_at)}</span>
                </div>
                <button className="pnw-admin-btn pnw-admin-btn--unmute" onClick={() => handleUnmute(m.id)}>
                  <FaTrash /> Démuter
                </button>
              </div>
            ))}
          </div>
        )}

        {/* === BANS === */}
        {tab === "bans" && (
          <div className="pnw-admin-sanction-list">
            {!bans.length && <div className="pnw-admin-empty">Aucun ban actif</div>}
            {bans.map((b) => (
              <div key={b.id} className="pnw-admin-sanction">
                <div className="pnw-admin-sanction-info">
                  <FaBan style={{ color: "#e74c3c" }} />
                  <span className="pnw-admin-sanction-name">{(b as any).profiles?.display_name || (b as any).profiles?.username || "Inconnu"}</span>
                </div>
                <div className="pnw-admin-sanction-details">
                  {b.reason && <span className="pnw-admin-sanction-reason">{b.reason}</span>}
                  <span className="pnw-admin-sanction-expiry"><FaClock /> {formatExpiry(b.expires_at)}</span>
                </div>
                <button className="pnw-admin-btn pnw-admin-btn--unban" onClick={() => handleUnban(b.id)}>
                  <FaTrash /> Débannir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
