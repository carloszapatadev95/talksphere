import { renderHook, act } from '@testing-library/react-native';
import { useStore } from '../../src/store/useStore';

const mockSocket = {
  on: jest.fn().mockReturnThis(),
  off: jest.fn().mockReturnThis(),
  emit: jest.fn().mockReturnThis(),
  connected: true,
  once: jest.fn(),
};

jest.mock('../../src/services/socket', () => ({
  getSocket: () => mockSocket,
}));

jest.mock('../../src/services/callGlobals', () => ({
  setCallPeer: jest.fn(),
  flushPendingCandidates: jest.fn(),
}));

describe('useCall', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterAll(() => {
    (console.log as any).mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useStore.setState({
      user: { id: 1, username: 'test', email: 'test@test.com', avatar_url: null, is_online: false, last_seen: null },
      incomingCall: null,
      isCallActive: false,
      callType: null,
      callPartner: null,
      token: 'test-token',
    });
    (globalThis as any).__socket = mockSocket;
  });

  it('initializes with no streams', () => {
    const { result } = renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.remoteAudioEnabled).toBe(true);
    expect(result.current.remoteVideoEnabled).toBe(true);
  });

  it('sets up call_ended listener on mount', () => {
    renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    expect(mockSocket.on).toHaveBeenCalledWith('call_ended', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('audio_toggled', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('video_toggled', expect.any(Function));
  });

  it('updates remote audio state on audio_toggled event', () => {
    const { result } = renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    const audioHandler = mockSocket.on.mock.calls.find((c: any) => c[0] === 'audio_toggled')?.[1];
    act(() => audioHandler({ enabled: false }));
    expect(result.current.remoteAudioEnabled).toBe(false);
    act(() => audioHandler({ enabled: true }));
    expect(result.current.remoteAudioEnabled).toBe(true);
  });

  it('updates remote video state on video_toggled event', () => {
    const { result } = renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    const videoHandler = mockSocket.on.mock.calls.find((c: any) => c[0] === 'video_toggled')?.[1];
    act(() => videoHandler({ enabled: false }));
    expect(result.current.remoteVideoEnabled).toBe(false);
  });

  it('calls end_call when call_ended event received', () => {
    renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    const endedHandler = mockSocket.on.mock.calls.find((c: any) => c[0] === 'call_ended')?.[1];
    act(() => endedHandler());
    expect(useStore.getState().isCallActive).toBe(false);
  });

  it('endCall resets all state', () => {
    const { result } = renderHook(() => {
      const { useCall } = require('../../src/hooks/useCall');
      return useCall();
    });
    act(() => {
      result.current.endCall();
    });
    expect(useStore.getState().isCallActive).toBe(false);
    expect(useStore.getState().callType).toBeNull();
    expect(useStore.getState().callPartner).toBeNull();
    expect(useStore.getState().incomingCall).toBeNull();
  });
});
