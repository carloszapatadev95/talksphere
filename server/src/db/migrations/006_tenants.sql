-- ════════════════════════════════════════════════════════════════
-- 006_tenants.sql — Multi-tenancy + sistema de invitaciones
-- Aísla usuarios de diferentes empresas-cliente entre sí.
-- Solo tenant_admin puede generar códigos de invitación.
-- ════════════════════════════════════════════════════════════════

-- Tabla de organizaciones/empresas-cliente
CREATE TABLE IF NOT EXISTS tenants (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  slug          VARCHAR(50) NOT NULL UNIQUE,
  max_seats     INT NOT NULL DEFAULT 50,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Tabla de códigos de invitación
CREATE TABLE IF NOT EXISTS invitation_codes (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(64) NOT NULL UNIQUE,
  tenant_id     INT NOT NULL,
  created_by    INT NOT NULL,
  used_by       INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  max_uses      INT NOT NULL DEFAULT 1,
  use_count     INT NOT NULL DEFAULT 0,
  is_revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_tenant ON invitation_codes(tenant_id);

-- Extender tabla users con tenant + rol global + inviter + suspensión
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id     INT,
  ADD COLUMN IF NOT EXISTS global_role   TEXT NOT NULL DEFAULT 'member' CHECK (global_role IN ('super_admin', 'tenant_admin', 'member')),
  ADD COLUMN IF NOT EXISTS invited_by    INT,
  ADD COLUMN IF NOT EXISTS invited_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_suspended  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_users_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
