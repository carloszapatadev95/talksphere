-- ════════════════════════════════════════════════════════════════
-- 007_tenants_seed.sql — Seed del primer tenant + migración de cuentas existentes
-- El usuario con email 'zapataaraujo95@gmail.com' (Carlos Zapata, dueño del proyecto)
-- se promueve a super_admin del primer tenant "Zapata Dev".
-- Demás cuentas existentes → migradas al tenant_id=1 como "member", inviter = el super_admin.
-- A partir de aquí, cualquier nuevo registro requiere invitation_code válido.
-- ════════════════════════════════════════════════════════════════

-- Crear el primer tenant (id=1 forzado para envolver las cuentas existentes)
INSERT INTO tenants (id, name, slug, max_seats, is_active)
VALUES (1, 'Zapata Dev', 'zapata-dev', 1000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Avanzar la secuencia para que los próximos INSERT auto-id no colisionen con id=1
SELECT setval('tenants_id_seq', GREATEST((SELECT MAX(id) FROM tenants), 1), true);

-- Promover a Carlos (por email) a super_admin del primer tenant
UPDATE users
SET tenant_id = 1,
    global_role = 'super_admin'
WHERE email = 'zapataaraujo95@gmail.com';

-- Si el primer UPDATE no encontró a Carlos (DB limpia), promover al primer usuario por id ASC
UPDATE users
SET tenant_id = 1,
    global_role = 'super_admin'
WHERE id = (SELECT MIN(id) FROM users)
  AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE global_role = 'super_admin' AND tenant_id IS NOT NULL
    LIMIT 1
  );

-- Migrar todas las cuentas con tenant_id NULL al tenant 1 como members
-- inviter = el super_admin (el que ya fue promovido)
UPDATE users
SET tenant_id = 1,
    global_role = 'member',
    invited_by = (SELECT id FROM users WHERE global_role = 'super_admin' ORDER BY id ASC LIMIT 1),
    invited_at = now()
WHERE tenant_id IS NULL
  AND global_role != 'super_admin';
