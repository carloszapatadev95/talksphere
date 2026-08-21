import { io, Socket } from 'socket.io-client';
import { AppState } from 'react-native';
import { SOCKET_URL } from '../constants/config';
import { Message, PendingMessage, Conversation } from '../types';
import { debug } from '../utils/debug';
import { Colors } from '../theme';
import { useStore } from '../store/useStore';
import * as Notifications from 'expo-notifications';
import { dismissCallNotifications } from './notifications';
import { RTCIceCandidate } from './webrtc';
import { getCurrentPeer, addPendingCandidate, flushPendingCandidates, teardownCall } from './callGlobals';

let socket: Socket | null = null;
let listenersSocket: Socket | null = null;

function processPendingMessages(): void {
  const { pendingMessages } = useStore.getState();
  const s = getSocket();
  if (!s?.connected || pendingMessages.length === 0) return;

  for (const msg of pendingMessages) {
    const _clientId = msg._clientId || Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const _clientTs = Date.now();
    console.time('[Perf] send:' + _clientId);
    const { onAck, ...emitData } = msg;
    s.emit('send_message', { ...emitData, messageType: msg.messageType, _clientId, _clientTs }, (response: any) => {
      if (response.status !== 'ok') {
        console.error('[Perf] Pending message ack failed:', response);
      }
      const total = Date.now() - _clientTs;
      const server = response._serverTs ? response._serverTs - _clientTs : -1;
      debug.log(`[Perf] pending:${_clientId} rtt=${total}ms net=${server}ms`);
      onAck?.(response);
    });
  }
  useStore.getState().clearPendingMessages();
}

const updateMessagesRead = (key: string) => {
  const currentMessages = useStore.getState().messages[key];
  if (!currentMessages) return;
  const updated = currentMessages.map((msg) => ({
    ...msg,
    read_at: new Date().toISOString(),
  }));
  useStore.getState().setMessages(key, updated);
};

function scheduleLocalNotification(message: Message): void {
  const state = useStore.getState();
  const isSelf = message.sender_id === state.user?.id;
  if (isSelf) return;

  const isActiveChat = message.group_id
    ? message.group_id === state.activeGroupId
    : message.sender_id === state.activeChatUserId;
  if (isActiveChat) return;

  const title = message.group_name || message.sender_name || 'Nuevo mensaje';
  const content = message.message_type === 'text'
    ? message.content
    : message.message_type === 'image'
      ? '📷 Imagen'
      : '📎 Archivo';
  const body = message.group_id && message.sender_name
    ? `${message.sender_name}: ${content}`
    : content;

  Notifications.dismissAllNotificationsAsync().catch(() => {});
  Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: {
        chatUserId: message.group_id ? undefined : message.sender_id,
        groupId: message.group_id || undefined,
      },
      sound: 'default',
      color: Colors.primary,
    },
    trigger: null,
  }).catch((err) => console.warn('[Push] Local notification error:', err));
}

export function attachSharedListeners(): void {
  const s = getSocket();
  if (!s || listenersSocket === s) return;
  listenersSocket = s;

  s.on('new_message', (message: Message) => {
    const state = useStore.getState();

    // Aislar conversaciones por workspace activo: ignorar mensajes de otro workspace
    if (message.workspace_id != null && state.activeWorkspaceId != null && message.workspace_id !== state.activeWorkspaceId) {
      return;
    }

    const key = String(message.sender_id === state.user?.id ? message.receiver_id : message.sender_id);
    state.addMessage(key, message);
    scheduleLocalNotification(message);

    if (message.group_id) {
      const isActiveGroup = message.group_id === state.activeGroupId;
      const lastText = message.message_type === 'image' ? '📷 Imagen' : message.content;
      const updated = state.groups.map((g) =>
        g.id === message.group_id
          ? {
              ...g,
              last_message: lastText,
              last_message_at: message.created_at.toString(),
              message_type: message.message_type,
              unread_count: (g.unread_count || 0) + (isActiveGroup ? 0 : 1),
            }
          : g
      );
      if (updated.some((g, i) => g !== state.groups[i])) {
        state.setGroups(updated);
      }
      return;
    }

    if (message.sender_id === state.user?.id) return;

    if (message.sender_id !== state.user?.id) {
      const lastMessage = message.message_type === 'image' ? '📷 Imagen' : message.content;
      const existingIdx = state.conversations.findIndex((c) => c.contact_id === message.sender_id);
      let updated: Conversation[];
      if (existingIdx !== -1) {
        updated = state.conversations.map((c) =>
          c.contact_id === message.sender_id
            ? {
                ...c,
                unread_count: (c.unread_count || 0) + 1,
                last_message: lastMessage,
                last_message_at: message.created_at.toString(),
                message_type: message.message_type,
              }
            : c
        );
      } else {
        // Conversación nueva: crearla con los datos del remitente para que
        // el indicador de conversaciones suba en tiempo real.
        updated = [
          ...state.conversations,
          {
            contact_id: message.sender_id,
            username: message.sender_name || `Usuario ${message.sender_id}`,
            avatar_url: message.sender_avatar || null,
            is_online: state.onlineUsers.has(message.sender_id),
            last_message: lastMessage,
            last_message_at: message.created_at.toString(),
            message_type: message.message_type,
            unread_count: 1,
          } as Conversation,
        ];
      }
      updated.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      state.setConversations(updated);
    }
  });

  s.on('online_users', (onlineIds: number[]) => {
    useStore.getState().setOnlineUsers(new Set(onlineIds));
  });

  s.on('group_call_started', ({ groupId, groupName, roomName, callType, startedBy, startedByName }: any) => {
    const state = useStore.getState();
    if (state.incomingGroupCall || state.isCallActive) return;
    useStore.getState().setIncomingGroupCall({ groupId, groupName, roomName, callType, startedBy, startedByName });
  });

  s.on('group_call_ended', ({ groupId }: { groupId: number }) => {
    const state = useStore.getState();
    if (state.incomingGroupCall?.groupId === groupId) {
      useStore.getState().setIncomingGroupCall(null);
      dismissCallNotifications();
    }
  });

  s.on('group_call_declined', ({ groupId }: { groupId: number }) => {
    const state = useStore.getState();
    if (state.incomingGroupCall?.groupId === groupId) {
      useStore.getState().setIncomingGroupCall(null);
      dismissCallNotifications();
    }
  });

  s.on('user_status', ({ userId, isOnline }: { userId: number; isOnline: boolean }) => {
    const { setOnlineUsers } = useStore.getState();
    setOnlineUsers((prev) => {
      const next = new Set(prev);
      if (isOnline) next.add(userId);
      else next.delete(userId);
      return next;
    });
  });

  s.on('incoming_call', ({ callerId, callerUsername, offer, callType }: any) => {
    debug.log('[socket] incoming_call received:', { callerId, callerUsername, callType });
    useStore.getState().setIncomingCall({ callerId, callerUsername, callType, offer });
  });

  s.on('call_answered', ({ answer }: any) => {
    const peer = getCurrentPeer();
    if (peer) {
      peer.setRemoteDescription(answer)
        .then(() => flushPendingCandidates())
        .catch((err: any) => console.error('Error setting remote description:', err));
    }
  });

  s.on('call_ended', () => {
    const state = useStore.getState();
    state.setCallActive(false);
    state.setCallType(null);
    state.setCallPartner(null);
    state.setIncomingCall(null);
    teardownCall();
    dismissCallNotifications();
  });

  s.on('call_cancelled', ({ callerId, endedBy }: { callerId?: number; endedBy?: number }) => {
    const canceller = callerId ?? endedBy;
    const state = useStore.getState();
    if (state.incomingCall && canceller != null && canceller === state.incomingCall.callerId) {
      state.setIncomingCall(null);
      dismissCallNotifications();
    }
  });

  s.on('ice_candidate', ({ candidate }: any) => {
    if (!candidate) return;
    const peer = getCurrentPeer();
    if (peer && peer.remoteDescription) {
      peer.addIceCandidate(new RTCIceCandidate(candidate))
        .catch((err: any) => console.error('Error adding ICE candidate:', err));
    } else {
      addPendingCandidate(candidate);
    }
  });

  // updateMessagesRead commented out: causes full re-render that blocks JS thread.
  // The ChatScreen's readHandler handles read status via lastReadAt (O(1)).
  // s.on('messages_read', ({ readBy }: { readBy: number }) => {
  //   updateMessagesRead(String(readBy));
  // });
}

export function connectSocket(token: string): Socket {
  console.time('[Perf] connectSocket');
  if (socket?.connected) {
    console.timeEnd('[Perf] connectSocket');
    return socket;
  }

  if (socket) {
    (socket as any).auth = { token };
    socket.connect();
    console.timeEnd('[Perf] connectSocket');
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    closeOnBeforeunload: false,
  });

  socket.on('connect', () => {
    const transport = socket?.io?.engine?.transport?.name || 'unknown';
    debug.log(`[Perf] Socket connected via ${transport}`);
    useStore.getState().setSocketConnected(true);
    attachSharedListeners();
    processPendingMessages();
  });

  socket.on('connect_error', (err) => {
    const transport = socket?.io?.engine?.transport?.name || 'unknown';
    console.error(`[Perf] Socket connect_error: "${err.message}" transport=${transport} ${new Date().toISOString().slice(11,19)}`);
  });

  socket.on('disconnect', (reason) => {
    const transport = socket?.io?.engine?.transport?.name || 'unknown';
    const wasConnected = socket?.connected;
    debug.log(`[Perf] Socket DISCONNECTED reason="${reason}" transport=${transport} wasConnected=${wasConnected} ${new Date().toISOString().slice(11,19)}`);
    useStore.getState().setSocketConnected(false);
    // Reintento activo: si el server volvió, reconecta aunque sea tras una caída larga.
    const retry = () => {
      const t = (globalThis as any).__token;
      if (!t) return;
      if (!socket || socket.connected) return;
      try {
        (socket as any).auth = { token: t };
        socket.connect();
      } catch {}
    };
    setTimeout(retry, 1000);
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    const transport = socket?.io?.engine?.transport?.name || 'unknown';
    debug.log(`[Perf] Socket reconnect_attempt #${attempt} transport=${transport}`);
  });

  socket.io.on('reconnect_error', (err) => {
    console.error(`[Perf] Socket reconnect_error: "${err.message}"`);
  });

  socket.io.on('reconnect_failed', () => {
    console.error(`[Perf] Socket reconnect_failed after all attempts`);
    const t = (globalThis as any).__token;
    if (!t) return;
    // Recrear el socket desde cero para un ciclo de reintentos nuevo
    try {
      if (socket) socket.disconnect();
      socket = null;
      listenersSocket = null;
      connectSocket(t);
    } catch {}
  });

  console.timeEnd('[Perf] connectSocket');
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  listenersSocket = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  useStore.getState().setSocketConnected(false);
}

if (typeof AppState?.addEventListener === 'function') {
  AppState.addEventListener('change', (state: string) => {
    if (state === 'active') {
      const s = getSocket();
      if (s && !s.connected) {
        debug.log('[Perf] App foregrounded, reconnecting socket');
        s.connect();
      }
    }
  });
}
