import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockSetIncomingCall = jest.fn();
const mockSocketEmit = jest.fn();

jest.mock('../../src/services/socket');
jest.mock('../../src/store/useStore', () => ({
  useStore: jest.fn(),
}));

const { useStore } = require('../../src/store/useStore');

describe('IncomingCallModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { getSocket } = require('../../src/services/socket');
    getSocket().emit = mockSocketEmit;
  });

  it('returns null when no incoming call', () => {
    useStore.mockReturnValue({ incomingCall: null, setIncomingCall: mockSetIncomingCall });
    const IncomingCallModal = require('../../src/components/IncomingCallModal').default;
    const { queryByText } = render(<IncomingCallModal />);
    expect(queryByText('Rechazar')).toBeNull();
  });

  it('shows caller name and call type for voice', () => {
    useStore.mockReturnValue({
      incomingCall: { callerId: 1, callerUsername: 'Alice', callType: 'voice' },
      setIncomingCall: mockSetIncomingCall,
    });
    const IncomingCallModal = require('../../src/components/IncomingCallModal').default;
    const { getByText } = render(<IncomingCallModal />);
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText(/llamada de voz/)).toBeTruthy();
  });

  it('shows video call type', () => {
    useStore.mockReturnValue({
      incomingCall: { callerId: 1, callerUsername: 'Bob', callType: 'video' },
      setIncomingCall: mockSetIncomingCall,
    });
    const IncomingCallModal = require('../../src/components/IncomingCallModal').default;
    const { getByText } = render(<IncomingCallModal />);
    expect(getByText(/videollamada/)).toBeTruthy();
  });

  it('calls end_call and clears modal on reject', () => {
    useStore.mockReturnValue({
      incomingCall: { callerId: 1, callerUsername: 'Alice', callType: 'voice' },
      setIncomingCall: mockSetIncomingCall,
    });
    const IncomingCallModal = require('../../src/components/IncomingCallModal').default;
    const { getByText } = render(<IncomingCallModal />);
    fireEvent.press(getByText('Rechazar'));
    expect(mockSocketEmit).toHaveBeenCalledWith('end_call', { targetId: 1 });
    expect(mockSetIncomingCall).toHaveBeenCalledWith(null);
  });

  it('navigates to Call screen on accept', () => {
    useStore.mockReturnValue({
      incomingCall: { callerId: 1, callerUsername: 'Alice', callType: 'video' },
      setIncomingCall: mockSetIncomingCall,
    });
    const mockUseNavigation = jest.spyOn(require('@react-navigation/native'), 'useNavigation');
    mockUseNavigation.mockReturnValue({ navigate: mockNavigate });

    const IncomingCallModal = require('../../src/components/IncomingCallModal').default;
    const { getByText } = render(<IncomingCallModal />);
    fireEvent.press(getByText('Aceptar'));
    expect(mockNavigate).toHaveBeenCalledWith('Call', {
      user: { id: 1, username: 'Alice' },
      callType: 'video',
      isIncoming: true,
      callerId: 1,
      offer: undefined,
    });
  });
});
