import { Server, Socket } from 'socket.io';
import { sendPush } from '../services/pushService';
import pool from '../db/connection';
import { shareWorkspace } from '../middleware/tenantScope';

interface SignalingEvents {
  call_user: (data: { targetId: number; offer: any; callType: 'voice' | 'video' }) => void;
  answer_call: (data: { targetId: number; answer: any }) => void;
  ice_candidate: (data: { targetId: number; candidate: any }) => void;
  end_call: (data: { targetId: number }) => void;
  toggle_audio: (data: { targetId: number; enabled: boolean }) => void;
  toggle_video: (data: { targetId: number; enabled: boolean }) => void;
  group_call_started: (data: { groupId: number; roomName: string; callType: 'voice' | 'video'; groupName?: string }) => void;
  group_call_ended: (data: { groupId: number; roomName: string }) => void;
  group_call_declined: (data: { groupId: number }) => void;
}

const CALL_TIMEOUT_MS = 60000;
const callTimers = new Map<string, NodeJS.Timeout>();

// Almacena llamadas entrantes pendientes para re-emitir cuando un usuario reconecta
// key: targetId, value: { callerId, callerUsername, offer, callType }
const pendingIncomingCalls = new Map<number, { callerId: number; callerUsername: string; offer: any; callType: 'voice' | 'video' }>();

export function getPendingIncomingCall(targetId: number) {
  return pendingIncomingCalls.get(targetId);
}

export function clearPendingIncomingCall(targetId: number): void {
  pendingIncomingCalls.delete(targetId);
}

function clearCallTimer(callerId: number, targetId: number): void {
  const key = `${callerId}:${targetId}`;
  const timer = callTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    callTimers.delete(key);
  }
}

export function setupSignalingHandler(io: Server, socket: Socket, userId: number, username: string): void {
  const events: SignalingEvents = {
     call_user: async (data) => {
      const canShare = await shareWorkspace(userId, data.targetId);
      if (!canShare) {
        socket.emit('call_ended', { endedBy: 0 });
        return;
      }
      const targetRoom = `user:${data.targetId}`;
      io.to(targetRoom).emit('incoming_call', {
        callerId: userId,
        callerUsername: username,
        offer: data.offer,
        callType: data.callType,
      });

      // Almacenar llamada pendiente para re-emitir en reconexión
      pendingIncomingCalls.set(data.targetId, {
        callerId: userId,
        callerUsername: username,
        offer: data.offer,
        callType: data.callType,
      });

      const callLabel = data.callType === 'video' ? 'videollamada' : 'llamada de voz';
      sendPush(data.targetId, username, `${username} te hace una ${callLabel}`, {
        callData: { callerId: userId, callerUsername: username, callType: data.callType },
      }, { priority: 'high', categoryId: 'incoming_call', channelId: 'default', dataOnly: true });

      const timerKey = `${userId}:${data.targetId}`;
      clearCallTimer(userId, data.targetId);
      callTimers.set(timerKey, setTimeout(() => {
        io.to(`user:${userId}`).emit('call_ended', { endedBy: 0 });
        io.to(`user:${data.targetId}`).emit('call_cancelled', { callerId: userId });
        pendingIncomingCalls.delete(data.targetId);
        callTimers.delete(timerKey);
      }, CALL_TIMEOUT_MS));
    },

    answer_call: (data) => {
      io.to(`user:${data.targetId}`).emit('call_answered', {
        answererId: userId,
        answer: data.answer,
      });
      clearCallTimer(data.targetId, userId);
      pendingIncomingCalls.delete(data.targetId);
    },

    ice_candidate: (data) => {
      io.to(`user:${data.targetId}`).emit('ice_candidate', {
        senderId: userId,
        candidate: data.candidate,
      });
    },

    end_call: (data) => {
      io.to(`user:${data.targetId}`).emit('call_ended', {
        endedBy: userId,
      });
      io.to(`user:${data.targetId}`).emit('call_cancelled', {
        callerId: userId,
      });
      clearCallTimer(userId, data.targetId);
      clearCallTimer(data.targetId, userId);
      pendingIncomingCalls.delete(data.targetId);
    },

    toggle_audio: (data) => {
      io.to(`user:${data.targetId}`).emit('audio_toggled', {
        userId,
        enabled: data.enabled,
      });
    },

    toggle_video: (data) => {
      io.to(`user:${data.targetId}`).emit('video_toggled', {
        userId,
        enabled: data.enabled,
      });
    },

    group_call_started: async (data) => {
      try {
        const [isMember]: any = await pool.query(
          'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
          [data.groupId, userId]
        );
        if (!isMember || isMember.length === 0) {
          return;
        }
        let groupName = data.groupName;
        if (!groupName) {
          const [nameRows]: any = await pool.query('SELECT name FROM groups WHERE id = ?', [data.groupId]);
          groupName = nameRows[0]?.name || 'Llamada grupal';
        }
        const [rows]: any = await pool.query(
          'SELECT user_id FROM group_members WHERE group_id = ?',
          [data.groupId]
        );
        for (const row of rows) {
          if (row.user_id === userId) continue;
          io.to(`user:${row.user_id}`).emit('group_call_started', {
            groupId: data.groupId,
            groupName,
            roomName: data.roomName,
            callType: data.callType,
            startedBy: userId,
            startedByName: username,
          });
          const callLabel = data.callType === 'video' ? 'videollamada' : 'llamada de voz';
          sendPush(row.user_id, username, `${username} inició una ${callLabel} grupal`, {
            callData: {
              callerId: userId,
              callerUsername: username,
              callType: data.callType,
              groupId: data.groupId,
              groupName,
              roomName: data.roomName,
              startedBy: userId,
              startedByName: username,
            },
          }, { priority: 'high', categoryId: 'incoming_call', channelId: 'default', dataOnly: true });
        }
      } catch (err) {
        console.error('[signalingHandler] group_call_started error:', err);
      }
    },

    group_call_ended: async (data) => {
      try {
        const [isMember]: any = await pool.query(
          'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
          [data.groupId, userId]
        );
        if (!isMember || isMember.length === 0) {
          return;
        }
        const [rows]: any = await pool.query(
          'SELECT user_id FROM group_members WHERE group_id = ?',
          [data.groupId]
        );
        for (const row of rows) {
          io.to(`user:${row.user_id}`).emit('group_call_ended', { groupId: data.groupId });
        }
      } catch (err) {
        console.error('[signalingHandler] group_call_ended error:', err);
      }
    },

    group_call_declined: async (data) => {
      try {
        const [rows]: any = await pool.query(
          'SELECT user_id FROM group_members WHERE group_id = ?',
          [data.groupId]
        );
        for (const row of rows) {
          io.to(`user:${row.user_id}`).emit('group_call_declined', {
            groupId: data.groupId,
            userId,
          });
        }
      } catch (err) {
        console.error('[signalingHandler] group_call_declined error:', err);
      }
    },
  };

  socket.on('call_user', events.call_user);
  socket.on('answer_call', events.answer_call);
  socket.on('ice_candidate', events.ice_candidate);
  socket.on('end_call', events.end_call);
  socket.on('toggle_audio', events.toggle_audio);
  socket.on('toggle_video', events.toggle_video);
  socket.on('group_call_started', events.group_call_started);
  socket.on('group_call_ended', events.group_call_ended);
  socket.on('group_call_declined', events.group_call_declined);

  socket.on('disconnect', () => {
    for (const [key, timer] of callTimers) {
      const [callerId, targetId] = key.split(':').map(Number);
      if (callerId === userId || targetId === userId) {
        clearTimeout(timer);
        callTimers.delete(key);
      }
    }
    pendingIncomingCalls.delete(userId);
  });
}
