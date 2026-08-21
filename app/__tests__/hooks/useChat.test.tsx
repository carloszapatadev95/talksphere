import { renderHook, act } from '@testing-library/react-native';
import { useStore } from '../../src/store/useStore';

jest.mock('../../src/services/api');
jest.mock('../../src/services/socket');

const api = require('../../src/services/api').default;

describe('useChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStore.setState({
      user: { id: 1, username: 'test', email: 'test@test.com', avatar_url: null, is_online: false, last_seen: null },
      token: 'test-token',
    });
    (globalThis as any).__token = 'test-token';
  });

  it('fetches conversations successfully', async () => {
    api.get.mockResolvedValue({ data: { conversations: [{ contact_id: 2, username: 'alice' }] } });
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    await act(async () => {
      await result.current.fetchConversations();
    });
    expect(api.get).toHaveBeenCalledWith('/messages/conversations');
    expect(useStore.getState().conversations).toEqual([{ contact_id: 2, username: 'alice' }]);
  });

  it('fetches messages successfully', async () => {
    api.get.mockResolvedValue({ data: { messages: [{ id: 1, content: 'Hello' }], hasMore: false } });
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    let msgs: any;
    await act(async () => {
      msgs = await result.current.fetchMessages(2);
    });
    expect(api.get).toHaveBeenCalledWith('/messages/2', { params: {} });
    expect(msgs).toEqual({ messages: [{ id: 1, content: 'Hello' }], hasMore: false });
  });

  it('sends message via socket when connected', async () => {
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    const { getSocket } = require('../../src/services/socket');
    await act(async () => {
      result.current.sendMessage(2, 'Hello!');
    });
    expect(getSocket().emit).toHaveBeenCalledWith('send_message', expect.objectContaining({
      receiverId: 2, content: 'Hello!', messageType: 'text',
    }));
  });

  it('sends typing indicator', async () => {
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    const { getSocket } = require('../../src/services/socket');
    await act(async () => {
      result.current.sendTyping(2, true);
    });
    expect(getSocket().emit).toHaveBeenCalledWith('typing', { receiverId: 2, isTyping: true });
  });

  it('marks messages as read', async () => {
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    const { getSocket } = require('../../src/services/socket');
    await act(async () => {
      result.current.markAsRead(2);
    });
    expect(getSocket().emit).toHaveBeenCalledWith('mark_read', { senderId: 2 });
  });

  it('fetches contacts successfully', async () => {
    api.get.mockResolvedValue({ data: { contacts: [{ id: 2, username: 'bob' }] } });
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    await act(async () => {
      await result.current.fetchContacts();
    });
    expect(useStore.getState().contacts).toEqual([{ id: 2, username: 'bob' }]);
  });

  it('searches users successfully', async () => {
    api.get.mockResolvedValue({ data: { results: [{ id: 3, username: 'charlie' }] } });
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    let users: any;
    await act(async () => {
      users = await result.current.searchUsers('charlie');
    });
    expect(users).toEqual([{ id: 3, username: 'charlie' }]);
  });

  it('sends group message via socket', async () => {
    const { result } = renderHook(() => {
      const { useChat } = require('../../src/hooks/useChat');
      return useChat();
    });
    const { getSocket } = require('../../src/services/socket');
    await act(async () => {
      result.current.sendGroupMessage(5, 'Hello group!');
    });
    expect(getSocket().emit).toHaveBeenCalledWith('send_message', {
      groupId: 5, content: 'Hello group!', messageType: 'text',
    });
  });
});
