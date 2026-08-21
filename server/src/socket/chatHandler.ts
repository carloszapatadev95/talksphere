import { Server, Socket } from 'socket.io';
import pool from '../db/connection';
import { sendPush, isUserOnline } from '../services/pushService';
import { getUserTenantScope, shareWorkspace } from '../middleware/tenantScope';

const messageLimiter = new Map<number, number[]>();

interface ChatEvents {
  send_message: (data: {
    receiverId?: number;
    groupId?: number;
    content: string;
    messageType?: string;
    _clientId?: string;
    replyToId?: number;
  }, callback?: (response: any) => void) => void;
  typing: (data: { receiverId?: number; groupId?: number; isTyping: boolean }) => void;
  mark_read: (data: { senderId?: number; groupId?: number }) => void;
}

export function setupChatHandler(io: Server, socket: Socket, userId: number, username: string): void {
  const events: ChatEvents = {
    send_message: async (data, callback) => {
      try {
        const { receiverId, groupId, content, messageType = 'text', _clientId, replyToId } = data;

        const MAX_CONTENT_LENGTH = 5000;
        const ALLOWED_TYPES = ['text', 'image', 'system'];

        if (typeof content !== 'string' || content.trim().length === 0) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: 'El contenido del mensaje no puede estar vacío', _clientId });
          }
          return;
        }
        if (content.length > MAX_CONTENT_LENGTH) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: `El mensaje no puede exceder ${MAX_CONTENT_LENGTH} caracteres`, _clientId });
          }
          return;
        }
        if (messageType && !ALLOWED_TYPES.includes(messageType)) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: `Tipo de mensaje inválido: ${messageType}`, _clientId });
          }
          return;
        }
        if (receiverId != null && (typeof receiverId !== 'number' || isNaN(receiverId))) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: 'receiverId inválido', _clientId });
          }
          return;
        }
        if (groupId != null && (typeof groupId !== 'number' || isNaN(groupId))) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: 'groupId inválido', _clientId });
          }
          return;
        }
        if (replyToId != null && (typeof replyToId !== 'number' || isNaN(replyToId))) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: 'replyToId inválido', _clientId });
          }
          return;
        }

        // Rate limiting: max 10 messages per second per user
        const now = Date.now();
        const timestamps = messageLimiter.get(userId) || [];
        const recent = timestamps.filter(t => now - t < 1000);
        if (recent.length >= 10) {
          if (typeof callback === 'function') {
            callback({ status: 'rate_limited', message: 'Demasiados mensajes. Espera un momento.', _clientId });
          }
          return;
        }
        recent.push(now);
        messageLimiter.set(userId, recent);

        const messageWorkspaceId = await resolveWorkspaceId(userId, receiverId, groupId);

        const [result] = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, group_id, content, message_type, reply_to_id, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          [userId, receiverId || null, groupId || null, content, messageType, replyToId || null, messageWorkspaceId]
        );

        const messageId = (result as any).insertId;

        let repliedTo = null;
        if (replyToId) {
          const [repliedRows] = await pool.query(
            `SELECT m.id, m.sender_id, m.content, m.message_type, u.username
             FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.id = ?`,
            [replyToId]
          ) as any;
          const r = (repliedRows as any[])[0];
          if (r) {
            repliedTo = {
              id: r.id,
              sender_id: r.sender_id,
              sender_name: r.username,
              content: r.content,
              message_type: r.message_type,
            };
          }
        }

        if (typeof callback === 'function') {
          callback({ status: 'ok', id: messageId, _clientId, _serverTs: Date.now() });
        }

        const [senderRows] = await pool.query(
          'SELECT avatar_url FROM users WHERE id = ?',
          [userId]
        ) as any;
        const senderAvatar = (senderRows as any[])[0]?.avatar_url || null;

        const message: any = {
          id: messageId,
          sender_id: userId,
          receiver_id: receiverId || null,
          group_id: groupId || null,
          workspace_id: messageWorkspaceId,
          content,
          message_type: messageType,
          reply_to_id: replyToId || null,
          replied_to: repliedTo,
          created_at: new Date(),
          sender_name: username,
          sender_avatar: senderAvatar,
          ...(_clientId ? { _clientId } : {}),
        };

        if (groupId) {
          const [isMember] = await pool.query(
            'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
          ) as any;
          if (!(isMember as any[]).length) {
            if (typeof callback === 'function') {
              callback({ status: 'error', message: 'No eres miembro de este grupo', _clientId: data._clientId });
            }
            return;
          }
          const [[groupRow], [members]] = await Promise.all([
            pool.query('SELECT name FROM groups WHERE id = ?', [groupId]),
            pool.query('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]),
          ]) as unknown as [any, any];
          message.group_name = (groupRow as any[])[0]?.name;
          (members as any[]).forEach((member: any) => {
            if (member.user_id !== userId) {
              io.to(`user:${member.user_id}`).emit('new_message', message);
              if (!isUserOnline(member.user_id, io)) {
                sendPush(member.user_id, message.group_name, `${username}: ${content}`, { groupId });
              }
            }
          });
          socket.emit('new_message', message);
        } else if (receiverId) {
          const canShare = await shareWorkspace(userId, receiverId);
          if (!canShare) {
            if (typeof callback === 'function') {
              callback({ status: 'error', message: 'No puedes enviar mensajes a usuarios de otro workspace', _clientId });
            }
            return;
          }
          socket.emit('new_message', message);
          io.to(`user:${receiverId}`).emit('new_message', message);

          if (!isUserOnline(receiverId, io)) {
            sendPush(receiverId, username, content, { chatUserId: userId });
          }
        }
      } catch (err) {
        console.error('Send message error:', err);
        if (typeof callback === 'function') {
          callback({ status: 'error', message: 'Error al enviar mensaje', _clientId: data._clientId });
        }
      }
    },

    typing: async (data) => {
      const { receiverId, groupId, isTyping } = data;
      const event = 'typing_indicator';

      if (groupId) {
        const [isMember] = await pool.query(
          'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
          [groupId, userId]
        ) as any;
        if (!(isMember as any[]).length) return;
        const [members] = await pool.query(
          'SELECT user_id FROM group_members WHERE group_id = ?',
          [groupId]
        ) as any;
        (members as any[]).forEach((member: any) => {
          if (member.user_id !== userId) {
            io.to(`user:${member.user_id}`).emit(event, { userId, groupId, isTyping });
          }
        });
      } else if (receiverId) {
        const canShare = await shareWorkspace(userId, receiverId);
        if (!canShare) return;
        io.to(`user:${receiverId}`).emit(event, { userId, isTyping });
      }
    },

    mark_read: async (data) => {
      try {
        if (data.senderId) {
          const canShare = await shareWorkspace(userId, data.senderId);
          if (!canShare) return;
          await pool.query(
            `UPDATE messages SET read_at = NOW()
             WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL`,
            [data.senderId, userId]
          );
          io.to(`user:${data.senderId}`).emit('messages_read', { readBy: userId });
        }
      } catch (err) {
        console.error('Mark read error:', err);
      }
    },
  };

  socket.on('send_message', events.send_message);
  socket.on('typing', events.typing);
  socket.on('mark_read', events.mark_read);

  socket.on('disconnect', () => {
    messageLimiter.delete(userId);
  });
}

/** Resuelve el workspace al que pertenece un mensaje saliente. */
async function resolveWorkspaceId(senderId: number, receiverId?: number, groupId?: number): Promise<number | null> {
  if (groupId) {
    const [rows] = await pool.query('SELECT workspace_id FROM groups WHERE id = ?', [groupId]) as any;
    return (rows as any[])[0]?.workspace_id ?? null;
  }
  if (receiverId) {
    const scope = await getUserTenantScope(senderId);
    const active = scope.activeWorkspaceId;
    if (active != null) {
      const [chk] = await pool.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        [active, receiverId]
      ) as any;
      if ((chk as any[]).length) return active;
    }
    for (const wsId of scope.workspaceIds) {
      const [chk] = await pool.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        [wsId, receiverId]
      ) as any;
      if ((chk as any[]).length) return wsId;
    }
    return null;
  }
  return null;
}
