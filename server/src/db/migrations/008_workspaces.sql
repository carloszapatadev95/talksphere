-- ════════════════════════════════════════════════════════════════
-- 008_workspaces.sql — Rename tenant → workspace + membresía N:N
-- Renombra tablas/columnas, crea workspace_members (multi-membership)
-- y workspace_contacts (import de contactos del móvil).
-- Mantener super_admin como rol de plataforma.
-- ════════════════════════════════════════════════════════════════

-- Renombrar tenants → workspaces (preserva id + datos)
ALTER TABLE tenants RENAME TO workspaces;

-- Workspace único por name (slug ya UNIQUE)
ALTER TABLE workspaces ADD CONSTRAINT uq_workspaces_name UNIQUE (name);

-- Renombrar invitation_codes → workspace_invitations
ALTER TABLE invitation_codes RENAME TO workspace_invitations;

-- Renombrar tenant_id → workspace_id en workspace_invitations
ALTER TABLE workspace_invitations RENAME COLUMN tenant_id TO workspace_id;

-- Membresía N:N: un usuario puede pertenecer a varios workspaces
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INT NOT NULL,
  user_id      INT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by   INT,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);

-- Renombrar users.tenant_id → workspace_id y añadir active_workspace_id.
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_tenant;

ALTER TABLE users RENAME COLUMN tenant_id TO workspace_id;

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_workspace_id INT;

ALTER TABLE users
  ADD CONSTRAINT fk_users_workspace        FOREIGN KEY (workspace_id)        REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_users_active_workspace FOREIGN KEY (active_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_active_workspace ON users(active_workspace_id);

-- Backfill membresía N:N desde workspace_id existente (preserva estado actual de cada usuario)
INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
SELECT workspace_id,
       id,
       CASE WHEN global_role IN ('super_admin', 'tenant_admin') THEN 'admin' ELSE 'member' END,
       invited_by
FROM users
WHERE workspace_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Asignar active_workspace_id = workspace_id existente para todos (incluye super_admin y members)
UPDATE users SET active_workspace_id = workspace_id
WHERE workspace_id IS NOT NULL AND active_workspace_id IS NULL;

-- Tabla de contactos importados desde el móvil de los usuarios
CREATE TABLE IF NOT EXISTS workspace_contacts (
  id SERIAL PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id INT NOT NULL,
  name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(40),
  registered_user_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (registered_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wc_email ON workspace_contacts(email);
CREATE INDEX IF NOT EXISTS idx_wc_phone ON workspace_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_wc_workspace ON workspace_contacts(workspace_id);
