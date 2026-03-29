import { supabase } from "./supabaseClient";
import type { Session } from "@supabase/supabase-js";
import type { ChatProfile, ChatMute, ChatBan, ChatFriend } from "./types";

/** Connecter l'utilisateur via Discord OAuth2. */
export async function signInWithDiscord() {
  console.log("[PNW Chat] OAuth redirectTo:", window.location.origin);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/** Déconnecter l'utilisateur. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Récupérer la session courante. */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Récupérer le profil chat depuis la table `profiles`. */
export async function getChatProfile(userId: string): Promise<ChatProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_id, username, display_name, avatar_url, banner_url, bio, roles, created_at")
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return data as ChatProfile;
}

/** Mettre à jour le profil chat (display_name, bio, avatar_url, banner_url). */
export async function updateChatProfile(
  userId: string,
  fields: Partial<Pick<ChatProfile, "display_name" | "bio" | "avatar_url" | "banner_url">>
): Promise<boolean> {
  const { error } = await supabase
    .from("profiles")
    .update(fields)
    .eq("id", userId);
  return !error;
}

/**
 * Upload une image (avatar ou bannière) dans Supabase Storage.
 * Retourne l'URL publique ou null en cas d'erreur.
 */
export async function uploadChatAsset(
  userId: string,
  file: File,
  type: "avatar" | "banner"
): Promise<string | null> {
  const ext = file.name.split(".").pop() || "png";
  const path = `${userId}/${type}.${ext}`;

  // Supprimer l'ancien fichier s'il existe (ignore les erreurs)
  await supabase.storage.from("chat-assets").remove([path]);

  const { error } = await supabase.storage
    .from("chat-assets")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    console.error(`[PNW Chat] Upload ${type} error:`, error);
    return null;
  }

  const { data } = supabase.storage.from("chat-assets").getPublicUrl(path);
  // Ajouter un timestamp pour invalider le cache
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** Upload an image for a chat message (max 5MB). */
export async function uploadMessageImage(
  channelId: number,
  file: File
): Promise<string | null> {
  if (file.size > 5 * 1024 * 1024) {
    console.warn("[PNW Chat] Image too large (max 5MB)");
    return null;
  }
  const ext = file.name.split(".").pop() || "png";
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `messages/${channelId}/${Date.now()}_${rand}.${ext}`;

  const { error } = await supabase.storage
    .from("chat-assets")
    .upload(path, file, { upsert: false, contentType: file.type });

  if (error) {
    console.error("[PNW Chat] uploadMessageImage error:", error);
    return null;
  }

  const { data } = supabase.storage.from("chat-assets").getPublicUrl(path);
  return data.publicUrl;
}

/** Écouter les changements d'auth (login/logout). */
export function onAuthStateChange(callback: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return data.subscription;
}

/* ==================== Messages ==================== */

/** Modifier un message (propre message uniquement). */
export async function updateMessage(messageId: number, content: string): Promise<boolean> {
  const { error } = await supabase
    .from("messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) console.error("[PNW Chat] updateMessage error:", error);
  return !error;
}

/** Supprimer un message (mod/admin, ou propre message en DM). */
export async function deleteMessage(messageId: number): Promise<boolean> {
  const { error } = await supabase.from("messages").delete().eq("id", messageId);
  if (error) console.error("[PNW Chat] deleteMessage error:", error);
  return !error;
}

/** Épingler / désépingler un message. */
export async function togglePinMessage(messageId: number, pin: boolean, pinnedBy?: string): Promise<boolean> {
  const { error } = await supabase
    .from("messages")
    .update({ is_pinned: pin, pinned_by: pin ? (pinnedBy ?? null) : null })
    .eq("id", messageId);
  if (error) console.error("[PNW Chat] togglePinMessage error:", error);
  return !error;
}

/** Récupérer les messages épinglés d'un channel. */
export async function fetchPinnedMessages(channelId: number) {
  const { data, error } = await supabase
    .from("messages")
    .select("*, profiles(*)")
    .eq("channel_id", channelId)
    .eq("is_pinned", true)
    .order("created_at", { ascending: false });
  if (error) console.error("[PNW Chat] fetchPinnedMessages error:", error);
  return (data ?? []) as import("./types").ChatMessage[];
}

/** Toggle slowmode sur un channel (admin/mod only). Retourne la nouvelle valeur. */
export async function toggleSlowmode(channelId: number, seconds: number): Promise<number> {
  // Lire la valeur actuelle
  const { data } = await supabase.from("channels").select("slowmode_seconds").eq("id", channelId).single();
  const current = (data as any)?.slowmode_seconds || 0;
  const newVal = current > 0 ? 0 : seconds;
  await supabase.from("channels").update({ slowmode_seconds: newVal }).eq("id", channelId);
  return newVal;
}

/** Mettre à jour le background d'un channel. */
export async function updateChannelBackground(channelId: number, backgroundUrl: string | null): Promise<boolean> {
  const { error } = await supabase.from("channels").update({ background_url: backgroundUrl }).eq("id", channelId);
  if (error) console.error("[PNW Chat] updateChannelBackground error:", error);
  return !error;
}

/** Upload a background image for a DM channel. */
export async function uploadDmBackground(channelId: number, file: File): Promise<string | null> {
  if (file.size > 5 * 1024 * 1024) return null;
  const ext = file.name.split(".").pop() || "png";
  const path = `dm-backgrounds/${channelId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("chat-assets")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) { console.error("[PNW Chat] uploadDmBackground error:", error); return null; }
  const { data } = supabase.storage.from("chat-assets").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/* ==================== Admin / Modération ==================== */

/** Liste tous les profils (admin panel). */
export async function getAllProfiles(): Promise<ChatProfile[]> {
  const { data } = await supabase.from("profiles").select("*").order("created_at");
  return (data as ChatProfile[]) || [];
}

/** Mettre à jour les rôles d'un joueur (admin only). */
export async function updateUserRoles(userId: string, roles: string[]): Promise<boolean> {
  const { error } = await supabase.from("profiles").update({ roles }).eq("id", userId);
  return !error;
}

/** Modifier le display_name d'un utilisateur (admin). */
export async function updateUserDisplayName(userId: string, displayName: string): Promise<boolean> {
  const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() || null }).eq("id", userId);
  return !error;
}

/** Muter un joueur. duration en minutes, null = permanent. Supprime le mute existant avant d'en créer un nouveau. */
export async function muteUser(userId: string, mutedBy: string, reason: string, durationMin?: number): Promise<boolean> {
  // Supprimer tout mute existant pour éviter les doublons
  await supabase.from("mutes").delete().eq("user_id", userId);
  const expires_at = durationMin ? new Date(Date.now() + durationMin * 60000).toISOString() : null;
  const payload = { user_id: userId, muted_by: mutedBy, reason: reason || null, expires_at };
  const { error } = await supabase.from("mutes").insert(payload).select();
  if (error) console.error("[PNW Chat] muteUser error:", error);
  return !error;
}

/** Récupérer tous les user_ids mutés actuellement (actifs). */
export async function getMutedUserIds(): Promise<Map<string, ChatMute>> {
  const { data } = await supabase.from("mutes").select("*").order("created_at", { ascending: false });
  const now = Date.now();
  const map = new Map<string, ChatMute>();
  for (const m of (data || []) as ChatMute[]) {
    if (!m.expires_at || new Date(m.expires_at).getTime() > now) {
      if (!map.has(m.user_id)) map.set(m.user_id, m);
    }
  }
  return map;
}

/** Bannir un joueur. duration en minutes, null = permanent. Supprime aussi ses messages. */
export async function banUser(userId: string, bannedBy: string, reason: string, durationMin?: number): Promise<boolean> {
  // Supprimer tout ban existant pour éviter les doublons
  await supabase.from("bans").delete().eq("user_id", userId);
  const expires_at = durationMin ? new Date(Date.now() + durationMin * 60000).toISOString() : null;
  const payload = { user_id: userId, banned_by: bannedBy, reason: reason || null, expires_at };
  const { error } = await supabase.from("bans").insert(payload).select();
  if (error) { console.error("[PNW Chat] banUser error:", error); return false; }
  // Supprimer tous les messages du banni
  await supabase.from("messages").delete().eq("user_id", userId);
  return true;
}

/** Récupérer tous les user_ids bannis actuellement (actifs). */
export async function getBannedUserIds(): Promise<Set<string>> {
  const { data } = await supabase.from("bans").select("*").order("created_at", { ascending: false });
  const now = Date.now();
  const set = new Set<string>();
  for (const b of (data || []) as ChatBan[]) {
    if (!b.expires_at || new Date(b.expires_at).getTime() > now) {
      set.add(b.user_id);
    }
  }
  return set;
}

/** Démuter un joueur. */
export async function unmuteUser(muteId: number): Promise<boolean> {
  const { error } = await supabase.from("mutes").delete().eq("id", muteId);
  return !error;
}

/** Débannir un joueur. */
export async function unbanUser(banId: number): Promise<boolean> {
  const { error } = await supabase.from("bans").delete().eq("id", banId);
  return !error;
}

/** Mute actif pour un joueur (non expiré). */
export async function getActiveMute(userId: string): Promise<ChatMute | null> {
  const { data } = await supabase
    .from("mutes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  // Filter active client-side
  const now = Date.now();
  const active = (data || []).filter((m: any) => !m.expires_at || new Date(m.expires_at).getTime() > now);
  return (active[0] as ChatMute) || null;
}

/** Ban actif pour un joueur (non expiré). */
export async function getActiveBan(userId: string): Promise<ChatBan | null> {
  const { data } = await supabase
    .from("bans")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const now = Date.now();
  const active = (data || []).filter((b: any) => !b.expires_at || new Date(b.expires_at).getTime() > now);
  return (active[0] as ChatBan) || null;
}

/** Tous les mutes actifs (admin panel). */
export async function getAllActiveMutes(): Promise<(ChatMute & { profiles?: ChatProfile })[]> {
  const { data, error } = await supabase
    .from("mutes")
    .select("*, profiles!mutes_user_id_fkey(*)")
    .order("created_at", { ascending: false });
  if (error) console.error("[PNW Chat] getAllActiveMutes error:", error);
  const now = Date.now();
  const active = (data as any[] || []).filter((m) =>
    !m.expires_at || new Date(m.expires_at).getTime() > now
  );
  return active;
}

/** Tous les bans actifs (admin panel). */
export async function getAllActiveBans(): Promise<(ChatBan & { profiles?: ChatProfile })[]> {
  const { data, error } = await supabase
    .from("bans")
    .select("*, profiles!bans_user_id_fkey(*)")
    .order("created_at", { ascending: false });
  if (error) console.error("[PNW Chat] getAllActiveBans error:", error);
  const now = Date.now();
  const active = (data as any[] || []).filter((b) =>
    !b.expires_at || new Date(b.expires_at).getTime() > now
  );
  return active;
}

/* ==================== Friends ==================== */

/** Envoyer une demande d'ami. */
export async function sendFriendRequest(friendId: string): Promise<boolean> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return false;
  const { error } = await supabase.from("friends").insert({
    user_id: session.user.id,
    friend_id: friendId,
    status: "pending",
  });
  if (error) console.error("[PNW Chat] sendFriendRequest error:", error);
  return !error;
}

/** Accepter une demande d'ami. */
export async function acceptFriendRequest(requestId: number): Promise<boolean> {
  const { error } = await supabase.from("friends").update({ status: "accepted" }).eq("id", requestId);
  if (error) console.error("[PNW Chat] acceptFriendRequest error:", error);
  return !error;
}

/** Refuser / Supprimer une amitié. */
export async function removeFriend(requestId: number): Promise<boolean> {
  const { error } = await supabase.from("friends").delete().eq("id", requestId);
  if (error) console.error("[PNW Chat] removeFriend error:", error);
  return !error;
}

/** Récupérer toutes les relations d'amitié (envoyées + reçues). */
export async function getFriends(userId: string): Promise<ChatFriend[]> {
  const { data: sent } = await supabase
    .from("friends")
    .select("*, profiles!friends_friend_id_fkey(id, username, display_name, avatar_url, roles)")
    .eq("user_id", userId);

  const { data: received } = await supabase
    .from("friends")
    .select("*, profiles!friends_user_id_fkey(id, username, display_name, avatar_url, roles)")
    .eq("friend_id", userId);

  const all: ChatFriend[] = [];
  for (const f of (sent || []) as any[]) {
    all.push({ ...f, profiles: f.profiles });
  }
  for (const f of (received || []) as any[]) {
    all.push({ ...f, profiles: f.profiles });
  }
  return all;
}

/** Vérifier la relation d'amitié entre 2 users. */
export async function getFriendship(userId: string, friendId: string): Promise<ChatFriend | null> {
  const { data } = await supabase
    .from("friends")
    .select("*")
    .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
    .limit(1);
  return (data?.[0] as ChatFriend) || null;
}

/** Supprimer une conversation DM (retirer le membre, ne supprime pas les messages). */
export async function leaveDmChannel(channelId: number, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) console.error("[PNW Chat] leaveDmChannel error:", error);
  return !error;
}

/* ==================== Block system ==================== */

export async function blockUser(blockedId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from("blocks").insert({ blocker_id: user.id, blocked_id: blockedId });
  if (error) console.error("[PNW Chat] blockUser error:", error);
  return !error;
}

export async function unblockUser(blockId: number): Promise<boolean> {
  const { error } = await supabase.from("blocks").delete().eq("id", blockId);
  if (error) console.error("[PNW Chat] unblockUser error:", error);
  return !error;
}

export async function getBlockedUsers(userId: string): Promise<{ id: number; blocked_id: string }[]> {
  const { data, error } = await supabase
    .from("blocks")
    .select("id, blocked_id")
    .eq("blocker_id", userId);
  if (error) console.error("[PNW Chat] getBlockedUsers error:", error);
  return (data as any[]) || [];
}
