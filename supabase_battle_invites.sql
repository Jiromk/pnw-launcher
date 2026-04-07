-- =============================================================================
-- PNW Launcher — Table battle_invites (invites de combat persistantes)
-- A executer dans Supabase Dashboard > SQL Editor
-- =============================================================================

-- 1. Creer la table
CREATE TABLE IF NOT EXISTS battle_invites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_code text NOT NULL,
  from_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_name text NOT NULL,
  from_avatar text,
  to_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dm_channel_id bigint,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Index pour lookup rapide par destinataire
CREATE INDEX IF NOT EXISTS idx_battle_invites_to_id
  ON battle_invites(to_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_battle_invites_from_id
  ON battle_invites(from_id, status)
  WHERE status = 'pending';

-- 3. RLS (Row Level Security)
ALTER TABLE battle_invites ENABLE ROW LEVEL SECURITY;

-- Lecture : voir ses propres invites (envoyees ou recues)
CREATE POLICY "battle_invites_select"
  ON battle_invites FOR SELECT
  USING (to_id = auth.uid() OR from_id = auth.uid());

-- Insertion : seulement en tant qu'expediteur
CREATE POLICY "battle_invites_insert"
  ON battle_invites FOR INSERT
  WITH CHECK (from_id = auth.uid());

-- Mise a jour : destinataire peut accepter/decliner, expediteur peut annuler
CREATE POLICY "battle_invites_update"
  ON battle_invites FOR UPDATE
  USING (to_id = auth.uid() OR from_id = auth.uid());

-- Suppression : les deux parties peuvent supprimer
CREATE POLICY "battle_invites_delete"
  ON battle_invites FOR DELETE
  USING (to_id = auth.uid() OR from_id = auth.uid());

-- 4. Fonction de nettoyage auto des invites > 2 minutes
CREATE OR REPLACE FUNCTION cleanup_expired_battle_invites()
RETURNS void AS $$
BEGIN
  DELETE FROM battle_invites
  WHERE status = 'pending'
    AND created_at < now() - interval '2 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. (Optionnel) Activer le Realtime — a faire aussi dans le Dashboard
--    Database > Replication > Cocher battle_invites (INSERT, UPDATE, DELETE)
