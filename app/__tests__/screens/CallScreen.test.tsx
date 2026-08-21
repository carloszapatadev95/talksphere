import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockEndCall = jest.fn();
const mockStartCall = jest.fn();
const mockAnswerCall = jest.fn();

function createMockStream() {
  const track = { enabled: true, kind: 'audio', readyState: 'live' };
  return {
    toURL: () => 'stream-url',
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
    release: jest.fn(),
    clone: jest.fn(),
    getTrackById: jest.fn(),
    active: true,
    id: 'stream-id',
  } as any;
}

jest.mock('../../src/hooks/useCall', () => ({
  useCall: jest.fn(),
}));

const mockUseCall = require('../../src/hooks/useCall').useCall;

describe('CallScreen', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterAll(() => {
    (console.log as any).mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCall.mockReturnValue({
      localStream: null,
      remoteStream: null,
      remoteAudioEnabled: true,
      remoteVideoEnabled: true,
      startCall: mockStartCall,
      answerCall: mockAnswerCall,
      endCall: mockEndCall,
    });
    jest.spyOn(require('@react-navigation/native'), 'useNavigation')
      .mockReturnValue({ goBack: mockGoBack, navigate: jest.fn(), setOptions: jest.fn() });
    jest.spyOn(require('@react-navigation/native'), 'useRoute')
      .mockReturnValue({
        params: { user: { id: 2, username: 'Alice' }, callType: 'voice', isIncoming: false },
      });
  });

  it('renders calling state for outgoing call', () => {
    const CallScreen = require('../../src/screens/CallScreen').default;
    const { getByText } = render(<CallScreen />);
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Llamando...')).toBeTruthy();
  });

  it('renders in-call state when localStream exists', () => {
    mockUseCall.mockReturnValue({
      localStream: createMockStream(),
      remoteStream: null,
      remoteAudioEnabled: true,
      remoteVideoEnabled: true,
      startCall: mockStartCall,
      answerCall: mockAnswerCall,
      endCall: mockEndCall,
    });
    const CallScreen = require('../../src/screens/CallScreen').default;
    const { getByText } = render(<CallScreen />);
    expect(getByText('En llamada...')).toBeTruthy();
  });

  it('renders controls (mute, speaker, end)', () => {
    const CallScreen = require('../../src/screens/CallScreen').default;
    const { getByText } = render(<CallScreen />);
    expect(getByText('🎤')).toBeTruthy();
    expect(getByText('📞')).toBeTruthy();
  });

  it('end call navigates back', () => {
    const CallScreen = require('../../src/screens/CallScreen').default;
    const { getByText } = render(<CallScreen />);
    fireEvent.press(getByText('📞'));
    expect(mockEndCall).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });
});
