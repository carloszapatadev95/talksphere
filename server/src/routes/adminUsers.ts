import { Router, Response } from 'express';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireTenantAdmin } from '../middleware/requireAdmin';
import { invalidateUserScope } from '../middleware/tenantScope';
import type { components } from '../types/openapi';

type ErrorResponse = components['schemas']['Error'];

const router = Router();

// GET /api/admin/users — miembros del workspace activo (o ?workspace_id= si es de los tuyos)
router.get(
  '/',
  authenticate,
  requireTenantAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = (req as any).tenantScope;
      const offset = parseInt((req.query.offset as string) || '0');
      const limit = Math.min(100, parseInt((req.query.limit as string) || '50'));
      const requestedWorkspaceId = req.query.workspace_id
        ? parseInt(req.query.workspace_id as string)
        : null;

      const workspaceFilter = requestedWorkspaceId ?? scope.activeWorkspaceId;
      if (!scope.workspaceIds.includes(workspaceFilter)) {
        res.status(403).json({ error: 'No perteneces a ese workspace' } satisfies ErrorResponse);
        return;
      }
      const [r] = await pool.query(
        `SELECT u.id, u.username, u.email, u.avatar_url, u.is_online, u.last_seen,
                u.invited_by, u.invited_at, u.is_suspended, u.created_at,
                u.active_workspace_id, w.name AS workspace_name
         FROM users u
         LEFT JOIN workspaces w ON w.id = u.active_workspace_id
         JOIN workspace_members wm ON wm.user_id = u.id
         WHERE wm.workspace_id = ?
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
        [workspaceFilter, limit, offset]
      );
      const rows = r as any[];
      const [c] = await pool.query(
        'SELECT COUNT(*) AS total FROM workspace_members WHERE workspace_id = ?',
        [workspaceFilter]
      );
      const total = (c as any[])[0].total;

      res.json({
        users: rows.map(r => ({ ...r, is_online: !!r.is_online, is_suspended: !!r.is_suspended })) as any,
        total,
        offset,
        limit,
      });
    } catch {
      res.status(500).json({ error: 'Error al listar usuarios' } satisfies ErrorResponse);
    }
  }
);

// PATCH /api/admin/users/:id — suspender/reactivar o cambiar rol en el workspace
router.patch('/:id', authenticate, requireTenantAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const scope = (req as any).tenantScope;
    const targetId = parseInt(req.params.id as string);
    if (targetId === req.userId) {
      res.status(400).json({ error: 'No puedes modificarte a ti mismo' } satisfies ErrorResponse);
      return;
    }
    const { isSuspended } = req.body;

    // El objetivo debe compartir el workspace activo con el admin
    const [targetRows] = await pool.query(
      `SELECT u.id FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE u.id = ? AND wm.workspace_id = ?`,
      [targetId, scope.activeWorkspaceId]
    );
    if ((targetRows as any[]).length === 0) {
      res.status(404).json({ error: 'El usuario no pertenece a este workspace' } satisfies ErrorResponse);
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (typeof isSuspended === 'boolean') {
      updates.push('is_suspended = ?');
      params.push(isSuspended);
    }
    if (updates.length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' } satisfies ErrorResponse);
      return;
    }
    params.push(targetId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    invalidateUserScope(targetId);
    res.json({ id: targetId, updated: true });
  } catch {
    res.status(500).json({ error: 'Error al actualizar usuario' } satisfies ErrorResponse);
  }
});

// DELETE /api/admin/users/:id — elimina usuario de su workspace (remueve membresía y usuario si solo pertenecía a ese)
router.delete('/:id', authenticate, requireTenantAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const scope = (req as any).tenantScope;
    const targetId = parseInt(req.params.id as string);
    if (targetId === req.userId) {
      res.status(400).json({ error: 'No puedes eliminarte a ti mismo' } satisfies ErrorResponse);
      return;
    }
    const [targetRows] = await pool.query(
      `SELECT u.id FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE u.id = ? AND wm.workspace_id = ?`,
      [targetId, scope.activeWorkspaceId]
    );
    if ((targetRows as any[]).length === 0) {
      res.status(404).json({ error: 'El usuario no pertenece a este workspace' } satisfies ErrorResponse);
      return;
    }
    // Remover la membresía; si era su único workspace, eliminar el usuario
    await pool.query('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [
      scope.activeWorkspaceId, targetId,
    ]);
    const [remaining] = await pool.query(
      'SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?',
      [targetId]
    );
    if ((remaining as any[])[0].n === 0) {
      await pool.query('DELETE FROM users WHERE id = ?', [targetId]);
    }
    invalidateUserScope(targetId);
    res.json({ id: targetId, deleted: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar usuario' } satisfies ErrorResponse);
  }
});

export default router;
