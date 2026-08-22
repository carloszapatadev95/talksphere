-- ════════════════════════════════════════════════════════════════
-- 013_session_epoch.sql — Sesión única por usuario
-- Cada login incrementa session_epoch y el JWT guarda la epoch con
-- la que fue emitido: si quedó atrás se rechaza (login en otro
-- dispositivo). Tokens previos a este cambio (sin epoch) caducan.
-- NOTA: este archivo no debe contener punto-y-coma dentro de comentarios,
-- el runner parte las sentencias por ese carácter.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch INT NOT NULL DEFAULT 1
