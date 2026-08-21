import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();

jest.mock('../../src/store/useStore', () => ({
  useStore: jest.fn(),
}));

jest.mock('../../src/hooks/useChat', () => ({
  useChat: () => ({
    fetchContacts: jest.fn(),
    searchUsers: jest.fn().mockResolvedValue([]),
  }),
}));

const { useStore } = require('../../src/store/useStore');

describe('ContactsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders contact list', () => {
    useStore.mockReturnValue({
      contacts: [
        { id: 2, username: 'Alice', email: 'alice@test.com', avatar_url: null, is_online: true, last_seen: null },
        { id: 3, username: 'Bob', email: 'bob@test.com', avatar_url: null, is_online: false, last_seen: null },
      ],
      onlineUsers: new Set([2]),
    });
    const ContactsScreen = require('../../src/screens/ContactsScreen').default;
    const { getByText } = render(
      <ContactsScreen navigation={{ navigate: mockNavigate } as any} />
    );
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(getByText('En línea')).toBeTruthy();
    expect(getByText('Desconectado')).toBeTruthy();
  });

  it('shows search input', () => {
    useStore.mockReturnValue({ contacts: [], onlineUsers: new Set() });
    const ContactsScreen = require('../../src/screens/ContactsScreen').default;
    const { getByPlaceholderText } = render(
      <ContactsScreen navigation={{ navigate: mockNavigate } as any} />
    );
    expect(getByPlaceholderText('Buscar usuarios...')).toBeTruthy();
  });

  it('navigates to Chat on contact press', () => {
    useStore.mockReturnValue({
      contacts: [{ id: 2, username: 'Alice', email: 'alice@test.com', avatar_url: null, is_online: true, last_seen: null }],
      onlineUsers: new Set([2]),
    });
    const ContactsScreen = require('../../src/screens/ContactsScreen').default;
    const { getByText } = render(
      <ContactsScreen navigation={{ navigate: mockNavigate } as any} />
    );
    fireEvent.press(getByText('Alice'));
    expect(mockNavigate).toHaveBeenCalledWith('Chat', { user: { id: 2, username: 'Alice', email: 'alice@test.com', avatar_url: null, is_online: true, last_seen: null } });
  });
});
