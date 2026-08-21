import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db/connection';
import { authenticate, AuthRequest, getJwtSecret } from '../middleware/auth';
import { getUserTenantScope, invalidateUserScope } from '../middleware/tenantScope';
import { getIO } from '../socket';
import { sendPush } from '../services/pushService';
import type { components, paths } from '../types/openapi';

type ErrorResponse = components['schemas']['Error'];
type CreateWorkspaceResp = paths['/api/tenants']['post']['responses'][201]['content']['application/json'];

const router = Router();

// POST /api/workspaces — crea un workspace y lo asigna al creador como admin
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, maxSeats } = req.body;
    if (!name || !slug) {
      res.status(400).json({ error: 'name y slug son requeridos' } satisfies ErrorResponse);
      return;
    }
    const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
    if (safeSlug.length < 2) {
      res.status(400).json({ error: 'slug inválido (minúsculas, números y guiones)' } satisfies ErrorResponse);
      return;
    }
    const seats = Math.max(1, Math.min(100000, parseInt(maxSeats) || 50));

    const [existing] = await pool.query('SELECT id FROM workspaces WHERE slug = ?', [safeSlug]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'slug ya existe' } satisfies ErrorResponse);
      return;
    }
    const [nameExisting] = await pool.query('SELECT id FROM workspaces WHERE name = ?', [String(name).slice(0, 100)]);
    if ((nameExisting as any[]).length > 0) {
      res.status(409).json({ error: 'El nombre del workspace ya existe' } satisfies ErrorResponse);
      return;
    }

    const [result] = await pool.query(
      'INSERT INTO workspaces (name, slug, max_seats, is_active, created_by) VALUES (?, ?, ?, TRUE, ?) RETURNING id',
      [String(name).slice(0, 100), safeSlug, seats, req.userId!]
    );
    const workspaceId = (result as any).insertId;
    // El creador queda como admin del workspace
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?, ?, 'admin', ?)`,
      [workspaceId, req.userId!, req.userId!]
    );
    // Si el usuario no tiene workspace activo, se lo asigna
    const scope = await getUserTenantScope(req.userId!);
    if (!scope.activeWorkspaceId) {
      await pool.query('UPDATE users SET active_workspace_id = ? WHERE id = ?', [workspaceId, req.userId!]);
    }
    invalidateUserScope(req.userId!);
    res.status(201).json({
      id: workspaceId,
      name: String(name).slice(0, 100),
      slug: safeSlug,
      maxSeats: seats,
      isActive: true,
    } as CreateWorkspaceResp);
  } catch (err) {
    console.error('Create workspace error:', err);
    res.status(500).json({ error: 'Error al crear workspace' } satisfies ErrorResponse);
  }
});

// GET /api/workspaces — todos los usuarios ven sus workspaces (de workspace_members)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    let rows: any[];
    if (scope.workspaceIds.length) {
      const [r] = await pool.query(
        `SELECT w.id, w.name, w.slug, w.max_seats, w.is_active, w.created_at, w.created_by,
                wm.role,
                wm.invited_by,
                inviter.username AS invited_by_username,
                (SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = w.id) AS used_seats
         FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         LEFT JOIN users inviter ON inviter.id = wm.invited_by
         WHERE wm.user_id = ? AND w.deleted_at IS NULL
         ORDER BY w.created_at ASC`,
        [req.userId]
      );
      rows = r as any[];
    } else {
      rows = [];
    }
    res.json({
      workspaces: rows.map((w) => ({
        ...w,
        is_owner: w.created_by === req.userId,
      })),
    });
  } catch {
    res.status(500).json({ error: 'Error al listar workspaces' } satisfies ErrorResponse);
  }
});

// POST /api/workspaces/join — usuario ya autenticado se une a un workspace con código
router.post('/join', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Código requerido' } satisfies ErrorResponse);
      return;
    }
    const [codeRows] = await pool.query(
      `SELECT id, workspace_id, created_by, max_uses, use_count, is_revoked, expires_at
       FROM workspace_invitations WHERE code = ?`,
      [code]
    );
    const invite = (codeRows as any[])[0];
    if (!invite) { res.status(403).json({ error: 'Código de invitación inválido' } satisfies ErrorResponse); return; }
    if (invite.is_revoked) { res.status(403).json({ error: 'Código de invitación revocado' } satisfies ErrorResponse); return; }
    if (Number(invite.use_count) >= Number(invite.max_uses)) { res.status(403).json({ error: 'Código de invitación agotado' } satisfies ErrorResponse); return; }
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      res.status(403).json({ error: 'Código de invitación expirado' } satisfies ErrorResponse); return;
    }

    const [wsRows] = await pool.query(
      'SELECT id, name, slug, max_seats, is_active, deleted_at FROM workspaces WHERE id = ?',
      [invite.workspace_id]
    );
    const ws = (wsRows as any[])[0];
    if (!ws || !ws.is_active || ws.deleted_at) {
      res.status(403).json({ error: 'Workspace inactivo o inexistente' } satisfies ErrorResponse); return;
    }
    const [seatRows] = await pool.query(
      'SELECT COUNT(*) AS used FROM workspace_members WHERE workspace_id = ?',
      [invite.workspace_id]
    );
    if (Number((seatRows as any[])[0].used) >= Number(ws.max_seats)) {
      res.status(403).json({ error: 'El workspace alcanzó el máximo de usuarios' } satisfies ErrorResponse); return;
    }

    const [memRows] = await pool.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [invite.workspace_id, req.userId]
    );
    const alreadyMember = (memRows as any[]).length > 0;

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
       VALUES (?, ?, 'admin', ?)
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [invite.workspace_id, req.userId, invite.created_by]
    );
    await pool.query(
      `UPDATE workspace_invitations
       SET use_count = use_count + 1, used_by = ?, used_at = NOW()
       WHERE id = ? AND use_count < max_uses`,
      [req.userId, invite.id]
    );
    await pool.query('UPDATE users SET active_workspace_id = ? WHERE id = ?', [invite.workspace_id, req.userId]);
    await pool.query(
      `UPDATE workspace_contacts
       SET registered_user_id = ?
       WHERE workspace_id = ? AND registered_user_id IS NULL
         AND (phone IN (SELECT phone FROM users WHERE id = ?) OR email IN (SELECT email FROM users WHERE id = ?))`,
      [req.userId, invite.workspace_id, req.userId, req.userId]
    );
    invalidateUserScope(req.userId);

    res.json({
      workspace: { id: ws.id, name: ws.name, slug: ws.slug },
      alreadyMember,
    });
  } catch {
    res.status(500).json({ error: 'Error al unirse al workspace' } satisfies ErrorResponse);
  }
});

// GET /api/workspaces/me — info del workspace activo del usuario
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    if (!scope.activeWorkspaceId) {
      res.status(404).json({ error: 'No tienes un workspace activo' } satisfies ErrorResponse);
      return;
    }
    const [rows] = await pool.query(
      `SELECT w.id, w.name, w.slug, w.max_seats, w.is_active, w.created_at, w.created_by,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS used_seats,
              (SELECT COUNT(*) FROM workspace_members wm JOIN users u ON u.id = wm.user_id
               WHERE wm.workspace_id = w.id AND u.is_online = TRUE) AS online_count
       FROM workspaces w WHERE w.id = ? AND w.deleted_at IS NULL`,
      [scope.activeWorkspaceId]
    );
    const ws = (rows as any[])[0];
    if (!ws) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    res.json({ workspace: ws });
  } catch {
    res.status(500).json({ error: 'Error al obtener workspace' } satisfies ErrorResponse);
  }
});

// GET /api/workspaces/:id — info de un workspace (miembro o cualquiera de sus workspaces). Backward-compat: AppNavigator fetchea GET /tenants/{user.tenant_id}
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!scope.workspaceIds.includes(wsId)) {
      res.status(403).json({ error: 'No tienes acceso a este workspace' } satisfies ErrorResponse);
      return;
    }
    const [rows] = await pool.query(
      `SELECT w.id, w.name, w.slug, w.max_seats, w.is_active, w.created_at, w.created_by,
              (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS used_seats
       FROM workspaces w WHERE w.id = ? AND w.deleted_at IS NULL`,
      [wsId]
    );
    const ws = (rows as any[])[0];
    if (!ws) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    res.json({ workspace: ws });
  } catch {
    res.status(500).json({ error: 'Error al obtener workspace' } satisfies ErrorResponse);
  }
});

// POST /api/workspaces/:id/seed-admin — crea el primer admin de un workspace. Backward-compat: montado en /api/tenants/:id/seed-admin
router.post('/:id/seed-admin', authenticate, async (req: AuthRequest, res: Response) => {
  const wsId = Number(req.params.id);
  const { username, email, password } = req.body as { username: string; email: string; password: string };
  try {
    const scope = await getUserTenantScope(req.userId!);
    if (!scope.workspaceIds.includes(wsId)) {
      res.status(403).json({ error: 'No perteneces a este workspace' } satisfies ErrorResponse);
      return;
    }
    if (!username || !email || !password) {
      res.status(400).json({ error: 'username, email y password son requeridos' } satisfies ErrorResponse);
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: 'password debe tener al menos 6 caracteres' } satisfies ErrorResponse);
      return;
    }
    const [wsRows] = await pool.query('SELECT id, max_seats, is_active FROM workspaces WHERE id = ?', [wsId]);
    const ws = (wsRows as any[])[0];
    if (!ws) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (!ws.is_active) {
      res.status(403).json({ error: 'Workspace inactivo' } satisfies ErrorResponse);
      return;
    }
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: 'El email o usuario ya existe' } satisfies ErrorResponse);
      return;
    }
    const [seatRows] = await pool.query('SELECT COUNT(*) AS used FROM workspace_members WHERE workspace_id = ?', [wsId]);
    if ((seatRows as any[])[0].used >= ws.max_seats) {
      res.status(403).json({ error: 'El workspace alcanzó el máximo de usuarios' } satisfies ErrorResponse);
      return;
    }
    const passwordHash = await bcrypt.hash(String(password), 12);
    const [result] = await pool.query(
      `INSERT INTO users (username, email, password_hash, workspace_id, active_workspace_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [String(username).slice(0, 50), String(email).slice(0, 255), passwordHash, wsId, wsId]
    );
    const newAdminId = (result as any).insertId;
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?, ?, 'admin', ?)`,
      [wsId, newAdminId, req.userId!]
    );
    invalidateUserScope(newAdminId);
    const token = jwt.sign({ id: newAdminId, username: String(username) }, getJwtSecret(),
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any });
    res.status(201).json({
      id: newAdminId, username: String(username), email: String(email),
      workspace_id: wsId, token,
    });
  } catch (err) {
    console.error('seed-admin error:', err);
    res.status(500).json({ error: 'Error al crear admin del workspace' } satisfies ErrorResponse);
  }
});

// PATCH /api/workspaces/:id — miembro del workspace edita (max_seats, is_active, name)
router.patch('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const workspaceId = parseInt(req.params.id as string);
    const scope = await getUserTenantScope(req.userId!);
    if (!scope.workspaceIds.includes(workspaceId)) {
      res.status(403).json({ error: 'No perteneces a este workspace' } satisfies ErrorResponse);
      return;
    }
    const { maxSeats, isActive, name } = req.body;

    const [existing] = await pool.query(
      'SELECT id, created_by, deleted_at FROM workspaces WHERE id = ?',
      [workspaceId]
    );
    const wsRow = (existing as any[])[0];
    if (!wsRow) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (wsRow.deleted_at) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    // Suspender/renombrar solo el creador
    if (isActive != null && wsRow.created_by !== req.userId) {
      res.status(403).json({ error: 'Solo el creador puede suspender el workspace' } satisfies ErrorResponse);
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (maxSeats != null) {
      updates.push('max_seats = ?');
      params.push(Math.max(1, Math.min(100000, parseInt(maxSeats))));
    }
    if (isActive != null) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    if (name != null) {
      const [dup] = await pool.query('SELECT id FROM workspaces WHERE name = ? AND id != ?', [String(name).slice(0, 100), workspaceId]);
      if ((dup as any[]).length > 0) {
        res.status(409).json({ error: 'El nombre del workspace ya existe' } satisfies ErrorResponse);
        return;
      }
      updates.push('name = ?');
      params.push(String(name).slice(0, 100));
    }
    if (updates.length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' } satisfies ErrorResponse);
      return;
    }
    params.push(workspaceId);
    await pool.query(`UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ id: workspaceId, updated: true });
  } catch {
    res.status(500).json({ error: 'Error al actualizar workspace' } satisfies ErrorResponse);
  }
});

// DELETE /api/workspaces/:id — soft-delete (solo el creador): oculta el workspace sin borrar datos.
// Los miembros con ese ws como activo se reasignan a su workspace propio (o se les crea uno).
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  let conn;
  try {
    const workspaceId = parseInt(req.params.id as string);
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT id, created_by FROM workspaces WHERE id = ?', [workspaceId]);
    const ws = (rows as any[])[0];
    if (!ws) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (ws.created_by !== req.userId) {
      res.status(403).json({ error: 'Solo el creador puede eliminar este workspace' } satisfies ErrorResponse);
      return;
    }

    // Marcar como eliminado (soft-delete)
    await conn.query('UPDATE workspaces SET deleted_at = NOW() WHERE id = ?', [workspaceId]);

    // Reasignar a cada miembro cuyo ws activo (o ws propio) era este workspace
    const [members] = await conn.query(
      'SELECT user_id FROM workspace_members WHERE workspace_id = ?',
      [workspaceId]
    );
    for (const { user_id } of members as any[]) {
      const uid = Number(user_id);
      // Buscar otro workspace del usuario (no eliminado)
      const [others] = await conn.query(
        `SELECT wm.workspace_id
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = ? AND wm.workspace_id != ? AND w.deleted_at IS NULL
         ORDER BY w.created_at ASC
         LIMIT 1`,
        [uid, workspaceId]
      );
      const fallbackId = (others as any[])[0]?.workspace_id ?? null;

      // Si no tiene otro workspace, crearle uno propio
      let newWsId = fallbackId;
      if (newWsId == null) {
        const [urows] = await conn.query('SELECT username FROM users WHERE id = ?', [uid]);
        const username = (urows as any[])[0]?.username || `user${uid}`;
        const slug = String(username).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `ws${uid}`;
        const [ins] = await conn.query(
          'INSERT INTO workspaces (name, slug, max_seats, is_active, created_by) VALUES (?, ?, 50, TRUE, ?) RETURNING id',
          [`${username}`, slug, uid]
        );
        newWsId = (ins as any).insertId;
        await conn.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?, ?, ?, NULL)',
          [newWsId, uid, uid === req.userId ? 'admin' : 'admin']
        );
      }

      // Reasignar active_workspace_id y workspace_id si apuntaban al workspace borrado
      await conn.query(
        `UPDATE users
         SET active_workspace_id = CASE WHEN active_workspace_id = ? THEN ? ELSE active_workspace_id END,
             workspace_id = CASE WHEN workspace_id = ? THEN ? ELSE workspace_id END
         WHERE id = ?`,
        [workspaceId, newWsId, workspaceId, newWsId, uid]
      );
      invalidateUserScope(uid);
    }

    res.json({ id: workspaceId, deleted: true });
  } catch (err) {
    console.error('Delete workspace error:', err);
    res.status(500).json({ error: 'Error al eliminar workspace' } satisfies ErrorResponse);
  } finally {
    if (conn) conn.release();
  }
});

// PATCH /api/workspaces/activate/:id — set active_workspace_id del usuario (cambio de workspace activo)
router.patch('/activate/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!scope.workspaceIds.includes(wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    await pool.query('UPDATE users SET active_workspace_id = ? WHERE id = ?', [wsId, req.userId!]);
    invalidateUserScope(req.userId!);
    res.json({ id: req.userId!, activeWorkspaceId: wsId });
  } catch {
    res.status(500).json({ error: 'Error al cambiar de workspace' } satisfies ErrorResponse);
  }
});

// POST /api/workspaces/:id/members — miembro del workspace agrega miembros (delegar admin o agregar member)
router.post('/:id/members', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!scope.workspaceIds.includes(wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }

    const { userId, role = 'member' } = req.body;
    const targetId = Number(userId);
    const memberRole: 'admin' | 'member' = role === 'admin' ? 'admin' : 'member';

    const [targetRows] = await pool.query('SELECT id FROM users WHERE id = ?', [targetId]);
    if ((targetRows as any[]).length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' } satisfies ErrorResponse);
      return;
    }
    const [seatRows] = await pool.query('SELECT max_seats FROM workspaces WHERE id = ?', [wsId]);
    if ((seatRows as any[]).length === 0) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?', [wsId]);
    if ((cnt as any[])[0].n >= (seatRows as any[])[0].max_seats) {
      res.status(403).json({ error: 'El workspace alcanzó el máximo de usuarios' } satisfies ErrorResponse);
      return;
    }

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [wsId, targetId, memberRole, req.userId]
    );
    invalidateUserScope(targetId);

    // Notificar al usuario agregado
    const io = getIO();
    io.to(`user:${targetId}`).emit('added_to_workspace', { workspaceId: wsId });
    sendPush(targetId, 'Nuevo miembro', `Fuiste agregado al workspace`, { workspaceId: wsId });
    const [nameRows] = await pool.query('SELECT name FROM workspaces WHERE id = ?', [wsId]);
    res.status(201).json({ added: true, workspaceId: wsId, workspaceName: (nameRows as any[])[0]?.name, role: memberRole });
  } catch {
    res.status(500).json({ error: 'Error al agregar miembro' } satisfies ErrorResponse);
  }
});

// ════════════════════════════════════════════════════════════════
// Contactos del móvil importados al workspace (workspace_contacts)
// ════════════════════════════════════════════════════════════════

const CONTACT_IMPORT_LIMIT = 500;

function contactDedupKey(email: string | null | undefined, phone: string | null | undefined, name: string | null | undefined): string | null {
  const e = (email || '').trim().toLowerCase();
  if (e) return `e:${e.slice(0, 254)}`;
  const p = (phone || '').trim().toLowerCase();
  if (p) return `p:${p.slice(0, 254)}`;
  const n = (name || '').trim().toLowerCase();
  if (n) return `n:${n.slice(0, 254)}`;
  return null;
}

function requireWorkspaceMember(scope: { workspaceIds: number[] }, wsId: number): boolean {
  return scope.workspaceIds.includes(wsId);
}

// POST /api/workspaces/:id/contacts — importa/actualiza contactos del móvil (upsert por dedup_key)
router.post('/:id/contacts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!requireWorkspaceMember(scope, wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    const raw = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const contacts = raw.slice(0, CONTACT_IMPORT_LIMIT);
    let imported = 0;
    for (const c of contacts) {
      const name = c?.name != null ? String(c.name).slice(0, 100) : null;
      const email = c?.email != null ? String(c.email).slice(0, 255) : null;
      const phone = c?.phone != null ? String(c.phone).slice(0, 40) : null;
      const dedupKey = contactDedupKey(email, phone, name);
      if (!dedupKey) continue;
      const [result] = await pool.query(
        `INSERT INTO workspace_contacts (workspace_id, user_id, name, email, phone, dedup_key)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, dedup_key) DO UPDATE
           SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, user_id = EXCLUDED.user_id`,
        [wsId, req.userId!, name, email, phone, dedupKey]
      );
      imported += (result as any).affectedRows === 1 ? 1 : 0;
    }
    res.status(201).json({ imported, total: contacts.length });
  } catch (err) {
    console.error('Import contacts error:', err);
    res.status(500).json({ error: 'Error al importar contactos' } satisfies ErrorResponse);
  }
});

// POST /api/workspaces/:id/contacts/match — ¿qué contactos ya son usuarios registrados?
router.post('/:id/contacts/match', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!requireWorkspaceMember(scope, wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    const raw = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const contacts = raw.slice(0, CONTACT_IMPORT_LIMIT);
    const emails = [...new Set(
      contacts
        .map((c: any) => c?.email)
        .filter((e: any) => e && String(e).trim().length > 0)
        .map((e: any) => String(e).trim().toLowerCase())
    )];

    const registeredMap = new Map<string, number>();
    if (emails.length > 0) {
      const [rows] = await pool.query('SELECT id, email FROM users WHERE email = ANY(?)', [emails]);
      for (const r of rows as any[]) registeredMap.set(String(r.email).toLowerCase(), r.id);
    }
    const matches = contacts.map((c: any) => {
      const email = c?.email ? String(c.email).trim().toLowerCase() : null;
      const userId = email ? registeredMap.get(email) ?? null : null;
      return {
        name: c?.name ?? null,
        email,
        phone: c?.phone ?? null,
        registered: !!userId,
        registeredUserId: userId,
      };
    });
    res.json({ matches });
  } catch (err) {
    console.error('Match contacts error:', err);
    res.status(500).json({ error: 'Error al comparar contactos' } satisfies ErrorResponse);
  }
});

// GET /api/workspaces/:id/contacts — lista contactos importados del workspace
router.get('/:id/contacts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!requireWorkspaceMember(scope, wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.registered_user_id, c.invitation_id, c.invited_at,
              i.code AS invitation_code,
              (SELECT COUNT(*) FROM workspace_members wm
               WHERE wm.workspace_id = c.workspace_id AND wm.user_id = c.registered_user_id) AS is_member
       FROM workspace_contacts c
       LEFT JOIN workspace_invitations i ON i.id = c.invitation_id
       WHERE c.workspace_id = ?
       ORDER BY c.name ASC, c.created_at ASC`,
      [wsId]
    );
    const contacts = (rows as any[]).map((c: any) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      registeredUserId: c.registered_user_id,
      invitationId: c.invitation_id,
      invitationCode: c.invitation_code,
      invitedAt: c.invited_at,
      isMember: Number(c.is_member) > 0,
    }));
    res.json({ contacts });
  } catch (err) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Error al listar contactos' } satisfies ErrorResponse);
  }
});

// DELETE /api/workspaces/:id/contacts/:contactId — quita un contacto importado
router.delete('/:id/contacts/:contactId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!requireWorkspaceMember(scope, wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    const contactId = Number(req.params.contactId);
    const [result] = await pool.query(
      'DELETE FROM workspace_contacts WHERE id = ? AND workspace_id = ?',
      [contactId, wsId]
    );
    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: 'Contacto no encontrado' } satisfies ErrorResponse);
      return;
    }
    res.json({ removed: true, id: contactId });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: 'Error al eliminar contacto' } satisfies ErrorResponse);
  }
});

// DELETE /api/workspaces/:id/members/:userId — quita un miembro (el creador nunca)
router.delete('/:id/members/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const wsId = Number(req.params.id);
    if (!requireWorkspaceMember(scope, wsId)) {
      res.status(403).json({ error: 'No eres miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    const targetId = Number(req.params.userId);
    if (targetId === req.userId) {
      res.status(400).json({ error: 'No puedes quitarte a ti mismo del workspace' } satisfies ErrorResponse);
      return;
    }
    const [wsRows] = await pool.query('SELECT created_by FROM workspaces WHERE id = ?', [wsId]);
    const ws = (wsRows as any[])[0];
    if (!ws) {
      res.status(404).json({ error: 'Workspace no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (ws.created_by === targetId) {
      res.status(403).json({ error: 'El creador del workspace no puede ser removido' } satisfies ErrorResponse);
      return;
    }
    const [memberRows] = await pool.query(
      'SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [wsId, targetId]
    );
    if ((memberRows as any[]).length === 0) {
      res.status(404).json({ error: 'El usuario no es miembro de este workspace' } satisfies ErrorResponse);
      return;
    }
    await pool.query('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [wsId, targetId]);
    // Si el usuario tenía este workspace como activo, quedarse sin activo (resolverá al consultar scope)
    await pool.query(
      'UPDATE users SET active_workspace_id = NULL WHERE id = ? AND active_workspace_id = ?',
      [targetId, wsId]
    );
    invalidateUserScope(targetId);
    const io = getIO();
    io.to(`user:${targetId}`).emit('removed_from_workspace', { workspaceId: wsId });
    res.json({ removed: true, workspaceId: wsId, userId: targetId });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Error al quitar miembro' } satisfies ErrorResponse);
  }
});

export default router;
