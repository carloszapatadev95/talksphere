-- ════════════════════════════════════════════════════════════════
-- 010_groups_workspace.sql - Vincular grupos al workspace
-- 1) groups.workspace_id: el workspace al que pertenece cada grupo.
--    Antes los grupos eran globales (solo por membresia de group_members).
--    Ahora se aislan por workspace activo del usuario.
-- 2) Backfill: grupos existentes -> workspace del creador (active_workspace_id
--    o su workspace propio). Si el creador ya no existe o no tiene workspace,
--    se deja NULL (grupo heredado, visible solo si el creador sigue activo).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS workspace_id INT;

UPDATE groups
SET workspace_id = COALESCE(u.active_workspace_id, u.workspace_id)
FROM users u
WHERE u.id = groups.created_by
  AND groups.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_groups_workspace ON groups(workspace_id);

ALTER TABLE groups
  ADD CONSTRAINT fk_groups_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
