import { Router, Response } from 'express';
import crypto from 'crypto';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserTenantScope, invalidateUserScope } from '../middleware/tenantScope';
import type { components, paths } from '../types/openapi';

type ErrorResponse = components['schemas']['Error'];

const router = Router();

function generateCode(workspaceSlug: string): string {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const slugPart = workspaceSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `${slugPart}-${random}`;
}

// POST /api/invitations — miembro del workspace activo (o workspaceId explícito) genera código
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const scope = await getUserTenantScope(req.userId!);
      const { maxUses, expiresInDays, workspaceId, contactIds } = req.body as { workspaceId?: number; maxUses: number; expiresInDays?: number; contactIds?: number[] };

      let targetWorkspaceId: number;
      if (workspaceId && scope.workspaceIds.includes(Number(workspaceId))) {
        targetWorkspaceId = Number(workspaceId);
      } else if (scope.activeWorkspaceId && scope.workspaceIds.includes(scope.activeWorkspaceId)) {
        targetWorkspaceId = scope.activeWorkspaceId;
      } else {
        res.status(400).json({ error: 'Selecciona un workspace' } satisfies ErrorResponse);
        return;
      }

      const uses = Math.max(1, Math.min(1000, Number(maxUses) || 1));
      const days = Number(expiresInDays);
      let expiresAt: Date | null = null;
      if (!isNaN(days) && days > 0) {
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      const [tenantRows] = await pool.query('SELECT slug FROM workspaces WHERE id = ?', [targetWorkspaceId]);
      const slug = (tenantRows as any[])[0]?.slug || 'workspace';
      const code = generateCode(slug);

      const [result] = await pool.query(
        `INSERT INTO workspace_invitations (code, workspace_id, created_by, max_uses, use_count, is_revoked, expires_at)
         VALUES (?, ?, ?, ?, 0, FALSE, ?) RETURNING id`,
        [code, targetWorkspaceId, req.userId!, uses, expiresAt]
      );
      const inviteId = (result as any).insertId;

      // Vincular el código a los contactos seleccionados (tracking de quién recibió qué código)
      if (Array.isArray(contactIds) && contactIds.length > 0) {
        const ids = contactIds
          .map((id: any) => Number(id))
          .filter((id: number) => !isNaN(id) && id > 0)
          .slice(0, 500);
        if (ids.length > 0) {
          await pool.query(
            `UPDATE workspace_contacts
             SET invitation_id = ?, invited_at = NOW()
             WHERE workspace_id = ? AND id = ANY(?)`,
            [inviteId, targetWorkspaceId, ids]
          );
        }
      }

      res.status(201).json({
        id: inviteId, code, workspaceId: targetWorkspaceId, createdBy: req.userId!,
        maxUses: uses, useCount: 0, isRevoked: false,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        createdAt: new Date().toISOString(),
      });
  } catch (err) {
    console.error('Create invitation error:', err);
    res.status(500).json({ error: 'Error al crear invitación' } satisfies ErrorResponse);
  }
});

// GET /api/invitations — lista del workspace activo (o ?workspace_id= de los tuyos)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const scope = await getUserTenantScope(req.userId!);
      let targetWorkspaceId: number;
      const requested = Number(req.query.workspace_id as string);
      if (requested && scope.workspaceIds.includes(requested)) {
        targetWorkspaceId = requested;
      } else if (scope.activeWorkspaceId && scope.workspaceIds.includes(scope.activeWorkspaceId)) {
        targetWorkspaceId = scope.activeWorkspaceId;
      } else {
        res.status(400).json({ invitations: [] });
        return;
      }

     const [rows] = await pool.query(
       `SELECT i.id, i.code, i.workspace_id, i.created_by, i.used_by, i.created_at,
               i.used_at, i.expires_at, i.max_uses, i.use_count, i.is_revoked
        FROM workspace_invitations i
        WHERE i.workspace_id = ?
        ORDER BY i.created_at DESC`,
       [targetWorkspaceId]
     );
     const invitations = (rows as any[]).map((i: any) => ({
       id: i.id,
       code: i.code,
       workspaceId: i.workspace_id,
       createdBy: i.created_by,
       usedBy: i.used_by,
       createdAt: i.created_at,
       usedAt: i.used_at,
       expiresAt: i.expires_at,
       maxUses: i.max_uses,
       useCount: i.use_count,
       isRevoked: !!i.is_revoked,
     }));
     res.json({ invitations });
  } catch {
    res.status(500).json({ error: 'Error al listar invitaciones' } satisfies ErrorResponse);
  }
});

// DELETE /api/invitations/:id — admin (del workspace asociado) revoca
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const inviteId = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT i.id, i.workspace_id
       FROM workspace_invitations i
       WHERE i.id = ?`,
      [inviteId]
    );
    const invitation = (rows as any[])[0];
    if (!invitation) {
      res.status(404).json({ error: 'Invitación no encontrada' } satisfies ErrorResponse);
      return;
    }
    // Permiso: pertenecer al workspace de la invitación
    if (!scope.workspaceIds.includes(invitation.workspace_id)) {
      res.status(403).json({ error: 'No tienes permiso sobre esta invitación' } satisfies ErrorResponse);
      return;
    }
    await pool.query('UPDATE workspace_invitations SET is_revoked = TRUE WHERE id = ?', [inviteId]);
    res.json({ id: inviteId, revoked: true });
  } catch {
    res.status(500).json({ error: 'Error al revocar invitación' } satisfies ErrorResponse);
  }
});

export default router;
