import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db/connection';
import { loginValidation, registerValidation } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimiter';
import { authenticate, AuthRequest, getJwtSecret } from '../middleware/auth';
import { invalidateUserScope } from '../middleware/tenantScope';
import type { components, paths } from '../types/openapi';

type RegisterResponse = paths['/api/auth/register']['post']['responses'][201]['content']['application/json'];
type LoginResponse = paths['/api/auth/login']['post']['responses'][200]['content']['application/json'];
type MeResponse = paths['/api/auth/me']['get']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

function slugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Valida un código de invitación y devuelve los datos del workspace invitador.
 * Devuelve null si no hay código. Lanza { statusCode, message } si el código es inválido.
 */
async function resolveInvitationCode(
  conn: any,
  invitationCode?: string
): Promise<{ workspaceId: number; createdBy: number; codeId: number } | null> {
  if (!invitationCode || String(invitationCode).trim().length === 0) return null;
  const [codeRows] = await conn.query(
    `SELECT id, workspace_id, created_by, max_uses, use_count, is_revoked, expires_at
     FROM workspace_invitations WHERE code = ?`,
    [String(invitationCode).trim()]
  );
  const code = (codeRows as any[])[0];
  if (!code) throw { statusCode: 403, message: 'Código de invitación inválido' };
  if (code.is_revoked) throw { statusCode: 403, message: 'Código de invitación revocado' };
  if (code.use_count >= code.max_uses) throw { statusCode: 403, message: 'Código de invitación agotado' };
  if (code.expires_at && new Date(code.expires_at).getTime() < Date.now()) {
    throw { statusCode: 403, message: 'Código de invitación expirado' };
  }

  const [tenantRows] = await conn.query(
    'SELECT id, max_seats, is_active FROM workspaces WHERE id = ?',
    [code.workspace_id]
  );
  const ws = (tenantRows as any[])[0];
  if (!ws || !ws.is_active) throw { statusCode: 403, message: 'Workspace inactivo o inexistente' };
  const [seatRows] = await conn.query(
    'SELECT COUNT(*) AS used FROM workspace_members WHERE workspace_id = ?',
    [code.workspace_id]
  );
  const usedSeats = Number((seatRows as any[])[0].used);
  if (usedSeats >= ws.max_seats) throw { statusCode: 403, message: 'El workspace alcanzó el máximo de usuarios' };

  return { workspaceId: code.workspace_id, createdBy: code.created_by, codeId: code.id };
}

/**
 * Registro:
 * - Con invitationCode: crea user + workspace propio (admin) + se agrega como member al workspace invitador.
 *   active_workspace_id = workspace invitador (ve sus contactos de entrada).
 * - Sin invitationCode (descarga directa): crea user + workspace propio (admin). active = propio.
 */
router.post('/register', authLimiter, registerValidation, async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  try {
    const { username, email, password, invitationCode } = req.body;

    // Validar el código de invitación ANTES de revisar si el usuario existe.
    // Si el email ya está registrado y la contraseña coincide, reutilizamos la cuenta
    // (unirla al workspace invitador) en lugar de rechazar el registro.
    let invitedWorkspaceId: number | null = null;
    let invitedByUserId: number | null = null;
    let invitationCodeId: number | null = null;
    try {
      const invite = await resolveInvitationCode(conn, invitationCode);
      invitedWorkspaceId = invite?.workspaceId ?? null;
      invitedByUserId = invite?.createdBy ?? null;
      invitationCodeId = invite?.codeId ?? null;
    } catch (invErr: any) {
      res.status(invErr.statusCode || 403).json({ error: invErr.message || 'Código de invitación inválido' } satisfies ErrorResponse);
      return;
    }

    const [existing] = await conn.query('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
    const existingUser = (existing as any[])[0];

    if (existingUser) {
      // Usuario ya registrado + viene con código de invitación: intentar unirlo al workspace.
      if (invitedWorkspaceId && existingUser.email.toLowerCase() === String(email).toLowerCase()) {
        const valid = await bcrypt.compare(password, existingUser.password_hash);
        if (!valid) {
          res.status(409).json({ error: 'El email ya está registrado. Usa tu contraseña o inicia sesión.' } satisfies ErrorResponse);
          return;
        }
        if (existingUser.is_suspended) {
          res.status(403).json({ error: 'Cuenta suspendida. Contacta al administrador.' } satisfies ErrorResponse);
          return;
        }

        // ¿Ya es miembro del workspace invitador?
        const [memRows] = await conn.query(
          'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
          [invitedWorkspaceId, existingUser.id]
        );
        const alreadyMember = (memRows as any[]).length > 0;

        await conn.beginTransaction();
        if (!alreadyMember) {
          await conn.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
             VALUES (?, ?, 'admin', ?)
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [invitedWorkspaceId, existingUser.id, invitedByUserId]
          );
        }
        await conn.query(
          `UPDATE workspace_invitations
           SET use_count = use_count + 1, used_by = ?, used_at = NOW()
           WHERE id = ? AND use_count < max_uses`,
          [existingUser.id, invitationCodeId]
        );
        await conn.query(
          `UPDATE workspace_contacts
           SET registered_user_id = ?
           WHERE workspace_id = ? AND email = ? AND registered_user_id IS NULL`,
          [existingUser.id, invitedWorkspaceId, String(email).trim().toLowerCase()]
        );
        await conn.query(
          'UPDATE users SET active_workspace_id = ? WHERE id = ?',
          [invitedWorkspaceId, existingUser.id]
        );
        await conn.commit();
        invalidateUserScope(existingUser.id);

        const token = jwt.sign(
          { id: existingUser.id, username: existingUser.username },
          getJwtSecret(),
          { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
        );
        res.json({
          token,
          user: {
            id: existingUser.id,
            username: existingUser.username,
            email: existingUser.email,
            avatar_url: existingUser.avatar_url,
            workspace_id: invitedWorkspaceId,
            tenant_id: invitedWorkspaceId,
            active_workspace_id: invitedWorkspaceId,
          },
        } as LoginResponse);
        return;
      }

      res.status(409).json({ error: 'El email o usuario ya existe' } satisfies ErrorResponse);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await conn.beginTransaction();

    // 1) Crear usuario. Si vino por invitación, lo linkeamos al workspace invitador primero.
    const initActiveWs = invitedWorkspaceId;
    const [userResult] = await conn.query(
      `INSERT INTO users (username, email, password_hash, workspace_id, active_workspace_id, invited_by, invited_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW()) RETURNING id`,
      [username, email, passwordHash, invitedWorkspaceId, initActiveWs, invitedByUserId]
    );
    const userId = (userResult as any).insertId;

    // 2) Crear workspace propio del usuario (siempre, descarga directa o invitación)
    let ownSlug = slugify(username);
    // Asegurar slug único
    const [slugRows] = await conn.query('SELECT id FROM workspaces WHERE slug = ?', [ownSlug]);
    if ((slugRows as any[]).length > 0) {
      const rand = (await import('crypto')).randomBytes(3).toString('hex');
      ownSlug = `${ownSlug}-${rand}`.slice(0, 50);
    }
    // Asegurar name único (Punto 7: workspace único por name)
    let ownName = `${username}`;
    {
      const [nameRows] = await conn.query('SELECT id FROM workspaces WHERE name = ?', [ownName]);
      if ((nameRows as any[]).length > 0) {
        ownName = `${username} (${userId})`;
      }
    }
    const [wsResult] = await conn.query(
      'INSERT INTO workspaces (name, slug, max_seats, is_active, created_by) VALUES (?, ?, 50, TRUE, ?) RETURNING id',
      [ownName, ownSlug, userId]
    );
    const ownWorkspaceId = (wsResult as any).insertId;

    // 3) Membresía N:N: admin de su propio workspace
    await conn.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
       VALUES (?, ?, 'admin', NULL)`,
      [ownWorkspaceId, userId]
    );

    // 3.1) Registro directo (sin invitación): el workspace propio es el activo.
    //      En registro con invitación, el workspace invitador queda como activo (ya insertado arriba).
    if (!invitedWorkspaceId) {
      await conn.query(
        `UPDATE users SET workspace_id = ?, active_workspace_id = ? WHERE id = ?`,
        [ownWorkspaceId, ownWorkspaceId, userId]
      );
    }

    // 4) Si vino por invitación: agregar también al workspace invitador como admin
    //    (en este modelo todos los miembros de un workspace son admin)
    if (invitedWorkspaceId) {
      await conn.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
         VALUES (?, ?, 'admin', ?)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [invitedWorkspaceId, userId, invitedByUserId]
      );
      // Marcar el código como usado
      await conn.query(
        `UPDATE workspace_invitations
         SET use_count = use_count + 1, used_by = ?, used_at = NOW()
         WHERE id = ? AND use_count < max_uses`,
        [userId, invitationCodeId]
      );
      // Match-on-register: si el nuevo usuario estaba en workspace_contacts (email),
      // marcarlo como registrado (ya fue agregado como miembro arriba)
      await conn.query(
        `UPDATE workspace_contacts
         SET registered_user_id = ?
         WHERE workspace_id = ? AND email = ? AND registered_user_id IS NULL`,
        [userId, invitedWorkspaceId, String(email).trim().toLowerCase()]
      );
    }

    await conn.commit();

    invalidateUserScope(userId);

    const token = jwt.sign(
      { id: userId, username },
      getJwtSecret(),
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    res.status(201).json({
      token,
      user: {
        id: userId,
        username,
        email,
        avatar_url: null,
        workspace_id: invitedWorkspaceId ?? ownWorkspaceId,
        tenant_id: invitedWorkspaceId ?? ownWorkspaceId,
        active_workspace_id: initActiveWs ?? ownWorkspaceId,
      },
    } as RegisterResponse);
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('Register error:', err);
    res.status(500).json({ error: 'Error al registrar usuario' } satisfies ErrorResponse);
  } finally {
    conn.release();
  }
});

router.post('/login', authLimiter, loginValidation, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const users = rows as any[];
    if (users.length === 0) {
      res.status(401).json({ error: 'Credenciales inválidas' } satisfies ErrorResponse);
      return;
    }

    const user = users[0];
    if (user.is_suspended) {
      res.status(403).json({ error: 'Cuenta suspendida. Contacta al administrador.' } satisfies ErrorResponse);
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Credenciales inválidas' } satisfies ErrorResponse);
      return;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      getJwtSecret(),
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    // Fallback: si el usuario no tiene workspace activo pero pertenece a alguno,
    // usar el primero (para que la app siempre tenga workspace al hacer login).
    let activeWorkspaceId = user.active_workspace_id ?? user.workspace_id ?? null;
    if (!activeWorkspaceId) {
      const [memberRows] = await pool.query(
        `SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY workspace_id LIMIT 1`,
        [user.id]
      );
      activeWorkspaceId = (memberRows as any[])[0]?.workspace_id ?? null;
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        workspace_id: user.workspace_id ?? null,
        tenant_id: user.workspace_id ?? null,
        active_workspace_id: activeWorkspaceId,
      },
    } as LoginResponse);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' } satisfies ErrorResponse);
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, email, avatar_url, is_online, last_seen,
              workspace_id, active_workspace_id
       FROM users WHERE id = ?`,
      [req.userId]
    );
    const users = rows as any[];
    if (users.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' } satisfies ErrorResponse);
      return;
    }
    const user = { ...users[0], is_online: !!users[0].is_online };
    res.json({ user } satisfies MeResponse);
  } catch {
    res.status(500).json({ error: 'Error al obtener usuario' } satisfies ErrorResponse);
  }
});

export default router;
