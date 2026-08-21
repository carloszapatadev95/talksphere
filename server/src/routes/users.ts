import { Router, Response } from 'express';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserTenantScope, invalidateUserScope } from '../middleware/tenantScope';
import type { components, paths } from '../types/openapi';

type ContactsResponse = paths['/api/users/contacts']['get']['responses'][200]['content']['application/json'];
type SearchResponse = paths['/api/users/search']['get']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

/** Lista contactos visibles para el usuario, aislada por el workspace ACTIVO:
 *  Miembros del workspace activo (N:N), no suspendidos, sin sí mismo.
 *  También incluye contactos importados del móvil (workspace_contacts) si matchean un registered_user_id.
 */
router.get('/contacts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const activeWs = scope.activeWorkspaceId;
    if (!activeWs) {
      res.json({ contacts: [] });
      return;
    }
    const [r] = await pool.query(
      `SELECT DISTINCT u.id, u.username, u.email, u.avatar_url, u.is_online, u.last_seen
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE wm.workspace_id = ?
         AND u.id != ?
         AND NOT u.is_suspended
       ORDER BY u.username ASC`,
      [activeWs, req.userId]
    );
    const rows = r as any[];
    // Añadir contactos importados del móvil matcheados a usuarios registrados (Punto 8)
    if (activeWs) {
      const [imp] = await pool.query(
        `SELECT DISTINCT u.id, u.username, u.email, u.avatar_url, u.is_online, u.last_seen
         FROM workspace_contacts wc
         JOIN users u ON u.id = wc.registered_user_id
         WHERE wc.workspace_id = ? AND wc.user_id = ? AND NOT u.is_suspended`,
        [activeWs, req.userId]
      );
      const impRows = imp as any[];
      const seen = new Set(rows.map(r => r.id));
      for (const r of impRows) {
        if (!seen.has(r.id)) rows.push(r);
      }
    }
    const contacts = rows.map((r: any) => ({ ...r, is_online: !!r.is_online }));
    res.json({ contacts } as ContactsResponse);
  } catch {
    res.status(500).json({ error: 'Error al obtener contactos' } satisfies ErrorResponse);
  }
});

router.get('/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const rawQuery = req.query.q as string;
    if (!rawQuery || rawQuery.length < 2) {
      res.status(400).json({ error: 'Mínimo 2 caracteres para buscar' } satisfies ErrorResponse);
      return;
    }

    const escapedQuery = rawQuery.replace(/[%_]/g, '\\$&');
    const scope = await getUserTenantScope(req.userId!);
    const activeWs = scope.activeWorkspaceId;
    if (!activeWs) {
      res.json({ results: [] });
      return;
    }

    const [r] = await pool.query(
      `SELECT DISTINCT u.id, u.username, u.email, u.avatar_url, u.is_online, u.last_seen
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE (u.username LIKE ? OR u.email LIKE ?)
         AND wm.workspace_id = ?
         AND u.id != ?
         AND NOT u.is_suspended
       LIMIT 20`,
      [`%${escapedQuery}%`, `%${escapedQuery}%`, activeWs, req.userId]
    );
    const results = (r as any[]).map((x: any) => ({ ...x, is_online: !!x.is_online }));
    res.json({ results } as SearchResponse);
  } catch {
    res.status(500).json({ error: 'Error al buscar usuarios' } satisfies ErrorResponse);
  }
});

export default router;
