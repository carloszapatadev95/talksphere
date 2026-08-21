import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockSocket = {
  on: jest.fn().mockReturnThis(),
  off: jest.fn().mockReturnThis(),
  emit: jest.fn().mockReturnThis(),
  connected: true,
  once: jest.fn(),
};

const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
const mockFetchMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockSendTyping = jest.fn();
const mockMarkAsRead = jest.fn();

jest.mock('../../src/services/socket', () => ({
  getSocket: () => mockSocket,
}));

jest.mock('../../src/store/useStore', () => ({
  useStore: jest.fn(),
}));

jest.mock('../../src/hooks/useChat', () => ({
  useChat: () => ({
    fetchMessages: mockFetchMessages,
    sendMessage: mockSendMessage,
    sendTyping: mockSendTyping,
    markAsRead: mockMarkAsRead,
  }),
}));

const { useStore } = require('../../src/store/useStore');

describe('ChatScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (globalThis as any).__socket = mockSocket;
    useStore.mockReturnValue({
      user: { id: 1, username: 'test', email: 'test@test.com', avatar_url: null, is_online: false, last_seen: null },
      setMessages: jest.fn(),
    });
    mockFetchMessages.mockResolvedValue({
      messages: [
        { id: 1, sender_id: 2, receiver_id: 1, content: 'Hey!', message_type: 'text', created_at: '2026-01-01T12:00:00Z', read_at: null, group_id: null, sender_name: 'Alice' },
      ],
      hasMore: false,
    });
    jest.spyOn(require('@react-navigation/native'), 'useNavigation')
      .mockReturnValue({ navigate: mockNavigate, setOptions: mockSetOptions });
    jest.spyOn(require('@react-navigation/native'), 'useRoute')
      .mockReturnValue({ params: { user: { id: 2, username: 'Alice' } } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders messages after loading', async () => {
    const ChatScreen = require('../../src/screens/ChatScreen').default;
    const { getByText } = render(<ChatScreen />);
    await waitFor(() => {
      expect(getByText('Hey!')).toBeTruthy();
    });
  });

  it('shows input bar and send button', async () => {
    const ChatScreen = require('../../src/screens/ChatScreen').default;
    const { getByPlaceholderText, getByText } = render(<ChatScreen />);
    await act(() => Promise.resolve());
    expect(getByPlaceholderText('Escribe un mensaje...')).toBeTruthy();
    expect(getByText('Enviar')).toBeTruthy();
  });

  it('sends message on button press', async () => {
    const ChatScreen = require('../../src/screens/ChatScreen').default;
    const { getByText, getByPlaceholderText } = render(<ChatScreen />);
    await act(() => Promise.resolve());
    fireEvent.changeText(getByPlaceholderText('Escribe un mensaje...'), 'Test message');
    fireEvent.press(getByText('Enviar'));
    expect(mockSendMessage).toHaveBeenCalledWith(2, 'Test message');
  });

  it('does not send empty message', async () => {
    const ChatScreen = require('../../src/screens/ChatScreen').default;
    const { getByText } = render(<ChatScreen />);
    await act(() => Promise.resolve());
    fireEvent.press(getByText('Enviar'));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sets header title to partner username', async () => {
    const ChatScreen = require('../../src/screens/ChatScreen').default;
    render(<ChatScreen />);
    await act(() => Promise.resolve());
    expect(mockSetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Alice' })
    );
  });
});
