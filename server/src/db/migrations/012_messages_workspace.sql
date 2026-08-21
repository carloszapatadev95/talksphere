ALTER TABLE messages ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;

-- Backfill: mensajes de grupo heredan el workspace del grupo
UPDATE messages m
SET workspace_id = g.workspace_id
FROM groups g
WHERE m.group_id = g.id AND m.workspace_id IS NULL;

-- Backfill: mensajes 1-a-1 al workspace compartido mínimo entre emisor y receptor
UPDATE messages m
SET workspace_id = (
  SELECT MIN(wm1.workspace_id)
  FROM workspace_members wm1
  JOIN workspace_members wm2
    ON wm2.workspace_id = wm1.workspace_id AND wm2.user_id = m.receiver_id
  WHERE wm1.user_id = m.sender_id
)
WHERE m.workspace_id IS NULL AND m.group_id IS NULL AND m.receiver_id IS NOT NULL;

CREATE INDEX idx_messages_workspace ON messages(workspace_id);