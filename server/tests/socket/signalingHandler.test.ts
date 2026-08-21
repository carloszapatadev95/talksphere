import { Server as SocketIOServer, Socket } from 'socket.io';

jest.mock('../../src/services/pushService', () => ({
  sendPush: jest.fn(),
  isUserOnline: jest.fn(() => false),
}));

jest.mock('../../src/middleware/tenantScope', () => {
  const scope = { userId: 1, activeWorkspaceId: 1, workspaceIds: [1] };
  return {
    getUserTenantScope: jest.fn().mockResolvedValue(scope),
    shareWorkspace: jest.fn().mockResolvedValue(true),
    invalidateUserScope: jest.fn(),
  };
});

function createMockSocket(userId = 1) {
  const socket = {
    id: `socket-${userId}`,
    emit: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;

  const io = {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    sockets: { adapter: { rooms: new Map() } },
  } as unknown as SocketIOServer;

  return { socket, io };
}

function setupSignaling(io: SocketIOServer, socket: Socket, userId: number, username: string) {
  const { setupSignalingHandler } = require('../../src/socket/signalingHandler');
  setupSignalingHandler(io, socket, userId, username);
}

describe('signalingHandler', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    (console.log as any).mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('call_user event', () => {
    it('should relay incoming_call to target user', async () => {
      const { socket, io } = createMockSocket(1);
      setupSignaling(io, socket, 1, 'caller');

      const callHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'call_user'
      )?.[1];
      await callHandler({ targetId: 2, offer: { sdp: 'offer-sdp', type: 'offer' }, callType: 'voice' });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('incoming_call', {
        callerId: 1, callerUsername: 'caller',
        offer: { sdp: 'offer-sdp', type: 'offer' },
        callType: 'voice',
      });
    });
  });

  describe('answer_call event', () => {
    it('should relay call_answered to caller', () => {
      const { socket, io } = createMockSocket(2);
      setupSignaling(io, socket, 2, 'callee');

      const answerHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'answer_call'
      )?.[1];
      answerHandler({ targetId: 1, answer: { sdp: 'answer-sdp', type: 'answer' } });

      expect(io.to).toHaveBeenCalledWith('user:1');
      expect(io.to('user:1').emit).toHaveBeenCalledWith('call_answered', {
        answererId: 2, answer: { sdp: 'answer-sdp', type: 'answer' },
      });
    });
  });

  describe('ice_candidate event', () => {
    it('should relay ICE candidate to target', () => {
      const { socket, io } = createMockSocket(1);
      setupSignaling(io, socket, 1, 'caller');

      const iceHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'ice_candidate'
      )?.[1];
      iceHandler({ targetId: 2, candidate: { candidate: 'candidate-string', sdpMid: '0' } });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('ice_candidate', {
        senderId: 1, candidate: { candidate: 'candidate-string', sdpMid: '0' },
      });
    });
  });

  describe('end_call event', () => {
    it('should notify target that call ended', () => {
      const { socket, io } = createMockSocket(1);
      setupSignaling(io, socket, 1, 'caller');

      const endHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'end_call'
      )?.[1];
      endHandler({ targetId: 2 });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('call_ended', { endedBy: 1 });
    });
  });

  describe('toggle_audio event', () => {
    it('should relay audio toggle to target', () => {
      const { socket, io } = createMockSocket(1);
      setupSignaling(io, socket, 1, 'caller');

      const handler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'toggle_audio'
      )?.[1];
      handler({ targetId: 2, enabled: false });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('audio_toggled', { userId: 1, enabled: false });
    });
  });

  describe('toggle_video event', () => {
    it('should relay video toggle to target', () => {
      const { socket, io } = createMockSocket(1);
      setupSignaling(io, socket, 1, 'caller');

      const handler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'toggle_video'
      )?.[1];
      handler({ targetId: 2, enabled: true });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('video_toggled', { userId: 1, enabled: true });
    });
  });
});
