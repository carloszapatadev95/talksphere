import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserTenantScope, belongsToWorkspace } from '../middleware/tenantScope';
import { getIO } from '../socket';
import { sendPush } from '../services/pushService';
import type { components, paths } from '../types/openapi';

type CreateGroupResp = paths['/api/groups']['post']['responses'][201]['content']['application/json'];
type GroupsListResp = paths['/api/groups']['get']['responses'][200]['content']['application/json'];
type GroupDetailResp = paths['/api/groups/{id}']['get']['responses'][200]['content']['application/json'];
type MembersListResp = paths['/api/groups/{id}/members']['get']['responses'][200]['content']['application/json'];
type AddMembersResp = paths['/api/groups/{id}/members']['post']['responses'][200]['content']['application/json'];
type LeaveGroupResp = paths['/api/groups/{id}/members/me']['delete']['responses'][200]['content']['application/json'];
type RemoveMemberResp = paths['/api/groups/{id}/members/{userId}']['delete']['responses'][200]['content']['application/json'];
type TransferResp = paths['/api/groups/{id}/transfer']['post']['responses'][200]['content']['application/json'];
type UpdateGroupResp = paths['/api/groups/{id}']['put']['responses'][200]['content']['application/json'];
type GroupMessagesResp = paths['/api/groups/{id}/messages']['get']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

async function requireGroupMember(req: AuthRequest, res: Response, next: import('express').NextFunction): Promise<void> {
  try {
    const [rows] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(403).json({ error: 'No eres miembro de este grupo' } satisfies ErrorResponse);
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'Error al verificar membresía' } satisfies ErrorResponse);
  }
}

async function requireGroupAdmin(req: AuthRequest, res: Response, next: import('express').NextFunction): Promise<void> {
  try {
    const [rows] = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'",
      [req.params.id, req.userId]
    );
    if ((rows as any[]).length === 0) {
      res.status(403).json({ error: 'Solo el administrador puede realizar esta acción' } satisfies ErrorResponse);
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'Error al verificar permisos' } satisfies ErrorResponse);
  }
}

async function requireGroupOwner(req: AuthRequest, res: Response, next: import('express').NextFunction): Promise<void> {
  try {
    const [rows] = await pool.query(
      'SELECT created_by FROM groups WHERE id = ?',
      [req.params.id]
    );
    const groups = rows as any[];
    if (groups.length === 0) {
      res.status(404).json({ error: 'Grupo no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (groups[0].created_by !== req.userId) {
      res.status(403).json({ error: 'Solo el creador del grupo puede realizar esta acción' } satisfies ErrorResponse);
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'Error al verificar propiedad' } satisfies ErrorResponse);
  }
}

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name || !memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ error: 'Nombre y miembros requeridos' } satisfies ErrorResponse);
      return;
    }

    const scope = await getUserTenantScope(req.userId!);
    if (!scope.activeWorkspaceId) {
      res.status(403).json({ error: 'Selecciona un workspace' } satisfies ErrorResponse);
      return;
    }

    const uniqueMemberIds = [...new Set<number>(memberIds)];

    // Validar que todos los memberIds pertenecen al workspace activo del creador
    for (const mid of uniqueMemberIds) {
      const isMember = await belongsToWorkspace(mid, scope.activeWorkspaceId!);
      if (!isMember) {
        res.status(403).json({ error: 'No puedes agregar usuarios de otro workspace' } satisfies ErrorResponse);
        return;
      }
    }

    const [result] = await pool.query(
      'INSERT INTO groups (name, description, created_by, workspace_id) VALUES (?, ?, ?, ?) RETURNING id',
      [name, description || null, req.userId, scope.activeWorkspaceId]
    );

    const groupId = (result as any).insertId;

    const values = [[groupId, req.userId, 'admin']];
    for (const memberId of uniqueMemberIds) {
      if (memberId !== req.userId) {
        values.push([groupId, memberId, 'member']);
      }
    }

    const placeholders = values.map(() => '(?, ?, ?)').join(', ');
    const flatParams = values.flat();
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ${placeholders}`,
      flatParams
    );

    const io = getIO();
    for (const uid of uniqueMemberIds) {
      if (uid !== req.userId) {
        io.to(`user:${uid}`).emit('added_to_group', { group: { id: groupId, name } });
        sendPush(uid, name, 'Te han agregado a este grupo', { groupId });
      }
    }
    for (const m of values as any[]) {
      io.to(`user:${m[1]}`).emit('group_members_updated', { groupId });
    }

    res.status(201).json({ id: groupId, name, description: description || null } satisfies CreateGroupResp);
  } catch {
    res.status(500).json({ error: 'Error al crear grupo' } satisfies ErrorResponse);
  }
});

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const scope = await getUserTenantScope(req.userId!);
    const activeWs = scope.activeWorkspaceId;
    if (!activeWs) {
      res.json({ groups: [] });
      return;
    }
    const [rows] = await pool.query(
      `SELECT g.*, gm.role
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
         AND g.workspace_id = ?
       ORDER BY g.created_at DESC`,
      [req.userId, activeWs]
    );
    res.json({ groups: rows as any[] } satisfies GroupsListResp);
  } catch {
    res.status(500).json({ error: 'Error al obtener grupos' } satisfies ErrorResponse);
  }
});

router.get('/:id', authenticate, requireGroupMember, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query('SELECT * FROM groups WHERE id = ?', [req.params.id]);
    const groups = rows as any[];
    if (groups.length === 0) {
      res.status(404).json({ error: 'Grupo no encontrado' } satisfies ErrorResponse);
      return;
    }
    res.json({ group: groups[0] } satisfies GroupDetailResp);
  } catch {
    res.status(500).json({ error: 'Error al obtener grupo' } satisfies ErrorResponse);
  }
});

router.get('/:id/members', authenticate, requireGroupMember, async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.is_online, gm.role
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?`,
      [req.params.id]
    );
    const members = (rows as any[]).map((r: any) => ({ ...r, is_online: !!r.is_online }));
    res.json({ members } satisfies MembersListResp);
  } catch {
    res.status(500).json({ error: 'Error al obtener miembros' } satisfies ErrorResponse);
  }
});

router.post('/:id/members', authenticate, requireGroupAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { memberIds } = req.body;
    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ error: 'Se requiere al menos un miembro' } satisfies ErrorResponse);
      return;
    }
    const groupId = parseInt(req.params.id as string);
    const uniqueIds = [...new Set<number>(memberIds)];

    const scope = await getUserTenantScope(req.userId!);
    if (!scope.activeWorkspaceId) {
      res.status(403).json({ error: 'Selecciona un workspace' } satisfies ErrorResponse);
      return;
    }
    {
      const groupRows = await pool.query(
        'SELECT created_by, workspace_id FROM groups WHERE id = ?',
        [groupId]
      ) as any;
      const groupInfo = (groupRows as any[])[0];
      if (!groupInfo) {
        res.status(404).json({ error: 'Grupo no encontrado' } satisfies ErrorResponse);
        return;
      }
      const groupWs = groupInfo.workspace_id ?? scope.activeWorkspaceId;
      const groupOwner = groupInfo.created_by;
      for (const mid of uniqueIds) {
        // El miembro debe pertenecer al workspace del grupo
        const isMember = await belongsToWorkspace(mid, groupWs);
        if (!isMember) {
          res.status(403).json({ error: 'No puedes agregar usuarios de otro workspace' } satisfies ErrorResponse);
          return;
        }
        const memberScope = await getUserTenantScope(mid);
        if (groupOwner && memberScope.activeWorkspaceId !== groupWs) {
          res.status(403).json({ error: 'No puedes agregar usuarios de otro workspace' } satisfies ErrorResponse);
          return;
        }
      }
    }

    const values = uniqueIds.map((uid) => [groupId, uid, 'member']);
    const placeholders = values.map(() => '(?, ?, ?)').join(', ');
    const flatParams = values.flat();
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ${placeholders}
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      flatParams
    );
    const io = getIO();
    const [groupRows] = await pool.query('SELECT id, name FROM groups WHERE id = ?', [groupId]);
    const group = (groupRows as any[])[0];
    for (const uid of uniqueIds) {
      io.to(`user:${uid}`).emit('added_to_group', { group });
      sendPush(uid, group.name, 'Te han agregado a este grupo', { groupId });
    }
    const [allMembers] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      [groupId]
    );
    for (const m of allMembers as any[]) {
      io.to(`user:${m.user_id}`).emit('group_members_updated', { groupId });
    }
    res.json({ added: values.length } satisfies AddMembersResp);
  } catch {
    res.status(500).json({ error: 'Error al agregar miembros' } satisfies ErrorResponse);
  }
});

router.delete('/:id/members/me', authenticate, requireGroupMember, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const [groupRows] = await pool.query('SELECT name, created_by FROM groups WHERE id = ?', [groupId]);
    const groups = groupRows as any[];
    if (groups.length === 0) {
      res.status(404).json({ error: 'Grupo no encontrado' } satisfies ErrorResponse);
      return;
    }
    if (groups[0].created_by === req.userId) {
      res.status(400).json({ error: 'Transfiere la propiedad del grupo antes de salir' } satisfies ErrorResponse);
      return;
    }
    await pool.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.userId]);
    const io = getIO();
    const [remaining] = await pool.query('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
    for (const m of remaining as any[]) {
      io.to(`user:${m.user_id}`).emit('group_members_updated', { groupId });
    }
    res.json({ message: 'Has salido del grupo' } satisfies LeaveGroupResp);
  } catch {
    res.status(500).json({ error: 'Error al salir del grupo' } satisfies ErrorResponse);
  }
});

router.delete('/:id/members/:userId', authenticate, requireGroupAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const targetId = parseInt(req.params.userId as string);
    if (targetId === req.userId) {
      res.status(400).json({ error: 'No puedes eliminarte a ti mismo' } satisfies ErrorResponse);
      return;
    }
    const [ownerRows] = await pool.query('SELECT created_by FROM groups WHERE id = ?', [groupId]);
    const owner = (ownerRows as any[])[0]?.created_by;
    if (targetId === owner) {
      res.status(400).json({ error: 'No puedes eliminar al creador del grupo' } satisfies ErrorResponse);
      return;
    }
    const [result] = await pool.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, targetId]
    );
    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: 'El usuario no es miembro del grupo' } satisfies ErrorResponse);
      return;
    }
    const io = getIO();
    const [remaining] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      [groupId]
    );
    for (const m of remaining as any[]) {
      io.to(`user:${m.user_id}`).emit('group_members_updated', { groupId });
    }
    io.to(`user:${targetId}`).emit('removed_from_group', { groupId });
    res.json({ message: 'Miembro eliminado' } satisfies RemoveMemberResp);
  } catch {
    res.status(500).json({ error: 'Error al eliminar miembro' } satisfies ErrorResponse);
  }
});

router.post('/:id/transfer', authenticate, requireGroupMember, requireGroupOwner, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const { userId } = req.body;
    if (!userId || userId === req.userId) {
      res.status(400).json({ error: 'Debes seleccionar otro miembro' } satisfies ErrorResponse);
      return;
    }
    const [memberRows] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );
    if ((memberRows as any[]).length === 0) {
      res.status(400).json({ error: 'El usuario no es miembro del grupo' } satisfies ErrorResponse);
      return;
    }
    const [groupRows] = await pool.query('SELECT name FROM groups WHERE id = ?', [groupId]);
    const groupName = (groupRows as any[])[0]?.name;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE groups SET created_by = ? WHERE id = ?', [userId, groupId]);
      await conn.query(
        "UPDATE group_members SET role = 'member' WHERE group_id = ? AND user_id = ?",
        [groupId, req.userId]
      );
      await conn.query(
        "UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?",
        [groupId, userId]
      );
      await conn.commit();
    } catch {
      await conn.rollback();
      conn.release();
      res.status(500).json({ error: 'Error al transferir propiedad' } satisfies ErrorResponse);
      return;
    }
    conn.release();
    const io = getIO();
    const [allMembers] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      [groupId]
    );
    for (const m of allMembers as any[]) {
      io.to(`user:${m.user_id}`).emit('group_members_updated', { groupId });
    }
    sendPush(userId, groupName, 'Ahora eres el administrador del grupo', { groupId });
    res.json({ message: 'Propiedad transferida exitosamente' } satisfies TransferResp);
  } catch {
    res.status(500).json({ error: 'Error al transferir propiedad' } satisfies ErrorResponse);
  }
});

router.put('/:id', authenticate, requireGroupAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'El nombre del grupo es obligatorio' } satisfies ErrorResponse);
      return;
    }

    await pool.query(
      'UPDATE groups SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description || null, groupId]
    );

    const [allMembers] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      [groupId]
    );
    const io = getIO();
    for (const m of allMembers as any[]) {
      io.to(`user:${m.user_id}`).emit('group_info_updated', { groupId });
    }

    res.json({
      id: groupId,
      name: name.trim(),
      description: description || null,
    } satisfies UpdateGroupResp);
  } catch {
    res.status(500).json({ error: 'Error al actualizar el grupo' } satisfies ErrorResponse);
  }
});

router.get('/:id/messages', authenticate, requireGroupMember, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id as string);
    const offset = (req.query.offset as string) || '0';
    const limit = (req.query.limit as string) || '50';

    const [rows] = await pool.query(
      `SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [groupId, parseInt(limit), parseInt(offset)]
    );

    res.json({
      messages: (rows as any[]).reverse(),
      hasMore: (rows as any[]).length === parseInt(limit as string),
    } satisfies GroupMessagesResp);
  } catch {
    res.status(500).json({ error: 'Error al obtener mensajes del grupo' } satisfies ErrorResponse);
  }
});

export default router;
