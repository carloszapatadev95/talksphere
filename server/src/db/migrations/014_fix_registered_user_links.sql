-- ════════════════════════════════════════════════════════════════
-- 014_fix_registered_user_links.sql — Reparación de contactos
-- Una versión anterior vinculó contactos importados a usuarios sin
-- criterio real: quedaron como "miembros" fantasma y la app no
-- permitía seleccionarlos para invitarlos.
-- Regla: un vínculo solo es válido si el email del contacto coincide
-- con el email del usuario vinculado. El resto se anula.
-- Sin punto-y-coma en comentarios: el runner parte por ese carácter.
-- ════════════════════════════════════════════════════════════════

UPDATE workspace_contacts c
SET registered_user_id = NULL
WHERE c.registered_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = c.registered_user_id
      AND LOWER(u.email) = LOWER(c.email)
  )
