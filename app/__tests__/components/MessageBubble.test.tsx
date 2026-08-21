import React from 'react';
import { render } from '@testing-library/react-native';
import MessageBubble from '../../src/components/MessageBubble';

describe('MessageBubble', () => {
  const baseMessage = {
    id: 1,
    sender_id: 1,
    receiver_id: 2,
    group_id: null,
    content: 'Hello world',
    message_type: 'text' as const,
    created_at: '2026-01-01T12:00:00Z',
    read_at: null,
    reply_to_id: null,
  };

  it('renders message content', () => {
    const { getByText } = render(<MessageBubble message={baseMessage} isMine={false} />);
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('shows sent time', () => {
    const { getByText } = render(<MessageBubble message={baseMessage} isMine={false} />);
    expect(getByText(/\d{2}:\d{2}/)).toBeTruthy();
  });

  it('shows single check for unread own message', () => {
    const { getByText } = render(<MessageBubble message={baseMessage} isMine={true} />);
    expect(getByText('✓')).toBeTruthy();
  });

  it('shows double check for read own message', () => {
    const msg = { ...baseMessage, read_at: '2026-01-01T12:01:00Z' };
    const { getByText } = render(<MessageBubble message={msg} isMine={true} />);
    expect(getByText('✓✓')).toBeTruthy();
  });

  it('shows sender name for others messages', () => {
    const msg = { ...baseMessage, sender_name: 'Alice' };
    const { getByText } = render(<MessageBubble message={msg} isMine={false} />);
    expect(getByText('Alice')).toBeTruthy();
  });
});
