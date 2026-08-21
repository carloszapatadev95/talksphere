-- ════════════════════════════════════════════════════════════════
-- 009_workspace_contacts_invites.sql - Contactos de workspace + invitaciones
-- 1) workspaces.created_by: quien creo el workspace (el creador no necesita
--    invitacion y NO puede ser removido del workspace)
-- 2) workspace_contacts.invitation_id/invited_at: tracking de que codigo se
--    le envio a cada contacto importado del movil
-- 3) workspace_contacts.dedup_key (email > phone > name en minusculas) con
--    unique (workspace_id, dedup_key) para upsert de contactos del movil
-- ════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS created_by INT;

ALTER TABLE workspaces
  ADD CONSTRAINT fk_workspaces_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Backfill: creator = miembro que se auto-invito (invited_by = su propio id)
UPDATE workspaces
SET created_by = wm.user_id
FROM workspace_members wm
WHERE wm.workspace_id = workspaces.id
  AND wm.invited_by = wm.user_id
  AND workspaces.created_by IS NULL;

-- Backfill: workspace propio de registros sin invitacion (invited_by IS NULL)
UPDATE workspaces
SET created_by = wm.user_id
FROM workspace_members wm
WHERE wm.workspace_id = workspaces.id
  AND wm.invited_by IS NULL
  AND wm.role = 'admin'
  AND workspaces.created_by IS NULL;

ALTER TABLE workspace_contacts
  ADD COLUMN IF NOT EXISTS invitation_id INT;

ALTER TABLE workspace_contacts
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

ALTER TABLE workspace_contacts
  ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_wc_invitation ON workspace_contacts(invitation_id);

ALTER TABLE workspace_contacts
  ADD CONSTRAINT fk_wc_invitation FOREIGN KEY (invitation_id) REFERENCES workspace_invitations(id) ON DELETE SET NULL;

ALTER TABLE workspace_contacts
  ADD CONSTRAINT uq_wc_dedup UNIQUE (workspace_id, dedup_key);
