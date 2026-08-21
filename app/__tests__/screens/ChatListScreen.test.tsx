import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();

jest.mock('../../src/store/useStore', () => ({
  useStore: jest.fn(),
}));

jest.mock('../../src/hooks/useChat', () => ({
  useChat: () => ({
    fetchConversations: jest.fn().mockResolvedValue(undefined),
  }),
}));

const { useStore } = require('../../src/store/useStore');

describe('ChatListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows empty state when no conversations', () => {
    useStore.mockReturnValue({ conversations: [], onlineUsers: new Set() });
    const ChatListScreen = require('../../src/screens/ChatListScreen').default;
    const { getByText } = render(
      <ChatListScreen navigation={{ navigate: mockNavigate } as any} />
    );
    expect(getByText('Sin conversaciones aún')).toBeTruthy();
    expect(getByText('Ve a Contactos para iniciar un chat')).toBeTruthy();
  });

  it('renders conversation list', () => {
    useStore.mockReturnValue({
      conversations: [
        { contact_id: 2, username: 'Alice', avatar_url: null, is_online: true, last_message: 'Hello!', last_message_at: '2026-01-01T12:00:00Z', message_type: 'text' },
        { contact_id: 3, username: 'Bob', avatar_url: null, is_online: false, last_message: 'Hi!', last_message_at: '2026-01-01T11:00:00Z', message_type: 'text' },
      ],
      onlineUsers: new Set([2]),
    });
    const ChatListScreen = require('../../src/screens/ChatListScreen').default;
    const { getByText } = render(
      <ChatListScreen navigation={{ navigate: mockNavigate } as any} />
    );
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(getByText('Hello!')).toBeTruthy();
  });

  it('navigates to Chat screen on press', () => {
    useStore.mockReturnValue({
      conversations: [
        { contact_id: 2, username: 'Alice', avatar_url: null, is_online: true, last_message: 'Hello!', last_message_at: '2026-01-01T12:00:00Z', message_type: 'text' },
      ],
      onlineUsers: new Set([2]),
    });
    const ChatListScreen = require('../../src/screens/ChatListScreen').default;
    const { getByText } = render(
      <ChatListScreen navigation={{ navigate: mockNavigate } as any} />
    );
    fireEvent.press(getByText('Alice'));
    expect(mockNavigate).toHaveBeenCalledWith('Chat', {
      user: { id: 2, username: 'Alice', avatar_url: null },
    });
  });
});
