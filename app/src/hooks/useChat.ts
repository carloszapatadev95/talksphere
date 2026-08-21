import { useCallback } from 'react';
import { getSocket, connectSocket } from '../services/socket';
import { useStore } from '../store/useStore';
import { Message, User } from '../types';
import api from '../services/api';
import { debug } from '../utils/debug';

export function useChat() {
  const { setConversations, setContacts } = useStore();

  const fetchConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/conversations');
      setConversations(data.conversations);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, []);

  const fetchMessages = useCallback(
    async (userId: number, options?: { limit?: number; offset?: number }): Promise<{ messages: Message[]; hasMore: boolean }> => {
      try {
        const params: Record<string, string> = {};
        if (options?.limit) params.limit = String(options.limit);
        if (options?.offset) params.offset = String(options.offset);
        const { data } = await api.get(`/messages/${userId}`, { params });
        return { messages: data.messages, hasMore: data.hasMore };
      } catch (err) {
        console.error('Failed to fetch messages:', err);
        return { messages: [], hasMore: false };
      }
    },
    []
  );

  const fetchContacts = useCallback(async () => {
    try {
      const { data } = await api.get('/users/contacts');
      setContacts(data.contacts);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    }
  }, []);

  const sendMessage = useCallback(
    (receiverId: number, content: string, messageType = 'text', replyToId?: number, clientId?: string, onAck?: (response: { status: string; id: number }) => void) => {
      const socket = getSocket();
      const _clientId = clientId || Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      if (socket?.connected) {
        console.time('[Perf] send:' + _clientId);
        const _clientTs = Date.now();
        socket.emit('send_message', { receiverId, content, messageType, replyToId, _clientId, _clientTs }, (response: any) => {
          const total = Date.now() - _clientTs;
          const server = response._serverTs ? response._serverTs - _clientTs : -1;
          debug.log(`[Perf] send:${_clientId} rtt=${total}ms net=${server}ms`);
          onAck?.(response);
        });
      } else {
        useStore.getState().addPendingMessage({ receiverId, content, messageType, replyToId, _clientId, onAck });
        connectSocket((globalThis as any).__token);
      }
    },
    []
  );

  const sendGroupMessage = useCallback(
    (groupId: number, content: string, messageType = 'text', replyToId?: number, clientId?: string) => {
      const socket = getSocket();
      const _clientId = clientId || Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      if (socket?.connected) {
        socket.emit('send_message', { groupId, content, messageType, replyToId, _clientId });
      } else {
        useStore.getState().addPendingMessage({ groupId, content, messageType, replyToId, _clientId });
        connectSocket((globalThis as any).__token);
      }
    },
    []
  );

  const sendTyping = useCallback(
    (receiverId: number, isTyping: boolean) => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('typing', { receiverId, isTyping });
      }
    },
    []
  );

  const sendGroupTyping = useCallback(
    (groupId: number, isTyping: boolean) => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('typing', { groupId, isTyping });
      }
    },
    []
  );

  const searchUsers = useCallback(async (query: string): Promise<User[]> => {
    try {
      const { data } = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
      return data.results;
    } catch {
      return [];
    }
  }, []);

  const markAsRead = useCallback(
    (senderId: number) => {
      const socket = getSocket();
      if (!socket?.connected) return;
      socket.emit('mark_read', { senderId });
      const state = useStore.getState();
      state.setConversations(
        state.conversations.map((c) =>
          c.contact_id === senderId ? { ...c, unread_count: 0 } : c
        )
      );
    },
    []
  );

  return {
    fetchConversations,
    fetchMessages,
    fetchContacts,
    sendMessage,
    sendGroupMessage,
    sendTyping,
    sendGroupTyping,
    searchUsers,
    markAsRead,
  };
}
