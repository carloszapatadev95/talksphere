import { Router, Response } from 'express';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserTenantScope, shareWorkspace } from '../middleware/tenantScope';
import type { components, paths } from '../types/openapi';

type ConversationsResponse = paths['/api/messages/conversations']['get']['responses'][200]['content']['application/json'];
type MessagesResponse = paths['/api/messages/{userId}']['get']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

/**
 * Conversaciones 1-to-1 del usuario, aisladas por el workspace ACTIVO.
 * Solo contactos que comparten el workspace activo del usuario (no suspendidos).
 */
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const activeWs = scope.activeWorkspaceId;
    if (!activeWs) {
      res.json({ conversations: [] });
      return;
    }
    const [r] = await pool.query(
      `SELECT DISTINCT
         CASE WHEN m.receiver_id = ? THEN m.sender_id ELSE m.receiver_id END as contact_id,
         u.username, u.avatar_url, u.is_online,
         m.content as last_message,
         m.created_at as last_message_at,
         m.message_type,
         (SELECT COUNT(*) FROM messages sub
          WHERE sub.sender_id = CASE WHEN m.receiver_id = ? THEN m.sender_id ELSE m.receiver_id END
            AND sub.receiver_id = ?
            AND sub.read_at IS NULL
            AND sub.group_id IS NULL
            AND sub.workspace_id = ?) as unread_count
       FROM messages m
       JOIN users u ON u.id = CASE WHEN m.receiver_id = ? THEN m.sender_id ELSE m.receiver_id END
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE (m.sender_id = ? OR m.receiver_id = ?)
         AND m.group_id IS NULL
         AND m.workspace_id = ?
         AND NOT u.is_suspended
         AND wm.workspace_id = ?
         AND m.id IN (
           SELECT MAX(id) FROM messages
           WHERE (sender_id = ? OR receiver_id = ?) AND group_id IS NULL AND workspace_id = ?
           GROUP BY
             CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
         )
       ORDER BY m.created_at DESC`,
      [req.userId, req.userId, req.userId, activeWs, req.userId, req.userId, req.userId, activeWs, activeWs, req.userId, req.userId, activeWs, req.userId]
    );
    const conversations = (r as any[]).map((x: any) => ({ ...x, is_online: !!x.is_online }));
    res.json({ conversations } as ConversationsResponse);
  } catch {
    res.status(500).json({ error: 'Error al obtener conversaciones' } satisfies ErrorResponse);
  }
});

router.get('/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const otherId = parseInt(req.params.userId as string);

    const scope = await getUserTenantScope(req.userId!);
    const canInteract = await shareWorkspace(req.userId!, otherId);
    if (!canInteract) {
      res.status(403).json({ error: 'No tienes permiso para ver mensajes con este usuario' } satisfies ErrorResponse);
      return;
    }
    // Bloquear si el otro está suspendido
    const [otherRows] = await pool.query('SELECT is_suspended FROM users WHERE id = ?', [otherId]);
    if ((otherRows as any[])[0]?.is_suspended) {
      res.status(403).json({ error: 'No tienes permiso para ver mensajes con este usuario' } satisfies ErrorResponse);
      return;
    }

    const offset = (req.query.offset as string) || '0';
    const limit = (req.query.limit as string) || '50';
    const [rows] = await pool.query(
      `SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
         AND m.group_id IS NULL
         AND m.workspace_id = ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, otherId, otherId, req.userId, scope.activeWorkspaceId, parseInt(limit), parseInt(offset)]
    );

    res.json({
      messages: (rows as any[]).reverse(),
      hasMore: (rows as any[]).length === parseInt(limit),
    } as MessagesResponse);
  } catch {
    res.status(500).json({ error: 'Error al obtener mensajes' } satisfies ErrorResponse);
  }
});
export default router;
