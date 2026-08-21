import { useStore } from '../../src/store/useStore';

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({
      token: null,
      user: null,
      contacts: [],
      conversations: [],
      groups: [],
      messages: {},
      onlineUsers: new Set(),
      incomingCall: null,
      isCallActive: false,
      callType: null,
      callPartner: null,
    });
  });

  it('has initial state', () => {
    const state = useStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.contacts).toEqual([]);
    expect(state.conversations).toEqual([]);
    expect(state.messages).toEqual({});
    expect(state.onlineUsers instanceof Set).toBe(true);
    expect(state.isCallActive).toBe(false);
  });

  it('setToken updates token', () => {
    useStore.getState().setToken('abc123');
    expect(useStore.getState().token).toBe('abc123');
  });

  it('setUser updates user', () => {
    const user = { id: 1, username: 'test', email: 'test@test.com', avatar_url: null, is_online: false, last_seen: null };
    useStore.getState().setUser(user);
    expect(useStore.getState().user).toEqual(user);
  });

  it('setContacts updates contacts', () => {
    const contacts = [{ id: 2, username: 'alice', email: 'alice@test.com', avatar_url: null, is_online: true, last_seen: null }];
    useStore.getState().setContacts(contacts);
    expect(useStore.getState().contacts).toEqual(contacts);
  });

  it('setConversations updates conversations', () => {
    const conversations = [{ contact_id: 2, username: 'alice', avatar_url: null, is_online: true, last_message: 'Hi', last_message_at: '2026-01-01T00:00:00Z', message_type: 'text' }];
    useStore.getState().setConversations(conversations);
    expect(useStore.getState().conversations).toEqual(conversations);
  });

  it('addMessage appends message to correct key', () => {
    const msg = { id: 1, sender_id: 2, receiver_id: 1, content: 'Hello', message_type: 'text' as const, created_at: '', read_at: null, group_id: null, reply_to_id: null };
    useStore.getState().addMessage('2', msg);
    expect(useStore.getState().messages['2']).toHaveLength(1);
    expect(useStore.getState().messages['2'][0]).toEqual(msg);
  });

  it('setMessages replaces messages for key', () => {
    const msgs = [
      { id: 1, sender_id: 2, receiver_id: 1, content: 'A', message_type: 'text' as const, created_at: '', read_at: null, group_id: null, reply_to_id: null },
      { id: 2, sender_id: 1, receiver_id: 2, content: 'B', message_type: 'text' as const, created_at: '', read_at: null, group_id: null, reply_to_id: null },
    ];
    useStore.getState().setMessages('2', msgs);
    expect(useStore.getState().messages['2']).toHaveLength(2);
  });

  it('setOnlineUsers updates set', () => {
    useStore.getState().setOnlineUsers(new Set([1, 2, 3]));
    expect(useStore.getState().onlineUsers.has(1)).toBe(true);
    expect(useStore.getState().onlineUsers.has(4)).toBe(false);
  });

  it('setIncomingCall updates incoming call', () => {
    const call = { callerId: 1, callerUsername: 'alice', callType: 'voice' as const };
    useStore.getState().setIncomingCall(call);
    expect(useStore.getState().incomingCall).toEqual(call);
  });

  it('setCallActive updates call active state', () => {
    useStore.getState().setCallActive(true);
    expect(useStore.getState().isCallActive).toBe(true);
  });

  it('logout resets all state', () => {
    useStore.getState().setToken('abc');
    useStore.getState().setUser({ id: 1, username: 'test', email: 'test@test.com', avatar_url: null, is_online: false, last_seen: null });
    useStore.getState().logout();
    expect(useStore.getState().token).toBeNull();
    expect(useStore.getState().user).toBeNull();
    expect(useStore.getState().contacts).toEqual([]);
    expect(useStore.getState().messages).toEqual({});
  });
});
