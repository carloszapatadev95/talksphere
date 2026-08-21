-- ════════════════════════════════════════════════════════════════
-- 011_workspace_soft_delete.sql - Soft-delete de workspaces
-- Agrega deleted_at para ocultar un workspace sin borrar sus datos
-- (chats, grupos, contactos y membresías se conservan).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
