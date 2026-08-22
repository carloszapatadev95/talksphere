import { Server as SocketIOServer, Socket } from 'socket.io';

jest.mock('../../src/services/pushService', () => ({
  sendPush: jest.fn(),
  isUserOnline: jest.fn(() => false),
}));

jest.mock('../../src/db/connection', () => ({
  query: jest.fn(),
  getConnection: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/middleware/tenantScope', () => {
  const scope = { userId: 1, activeWorkspaceId: 1, workspaceIds: [1] };
  return {
    getUserTenantScope: jest.fn().mockResolvedValue(scope),
    shareWorkspace: jest.fn().mockResolvedValue(true),
    invalidateUserScope: jest.fn(),
  };
});

const pool = require('../../src/db/connection');

function createMockSocket(userId = 1) {
  const emitted: any[] = [];
  const socket = {
    id: `socket-${userId}`,
    emit: jest.fn((event: string, data?: any) => { emitted.push({ event, data }); }),
    on: jest.fn(),
    join: jest.fn(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
  } as unknown as Socket;

  const io = {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    sockets: { adapter: { rooms: new Map() } },
  } as unknown as SocketIOServer;

  return { socket, io, emitted };
}

function setupChatHandler(io: SocketIOServer, socket: Socket, userId: number) {
  const { setupChatHandler } = require('../../src/socket/chatHandler');
  setupChatHandler(io, socket, userId);
}

describe('chatHandler', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    (console.error as any).mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('send_message event', () => {
    it('should persist message to DB and emit to receiver for 1-to-1 chat', async () => {
      pool.query.mockResolvedValue([{ insertId: 100 }]);
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const sendHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'send_message'
      )?.[1];
      await sendHandler({ receiverId: 2, content: 'Hello!', messageType: 'text' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        expect.arrayContaining([1, 2, null, 'Hello!', 'text'])
      );
      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(socket.emit).toHaveBeenCalledWith('new_message', expect.objectContaining({
        id: 100, content: 'Hello!', receiver_id: 2,
      }));
    });

    it('should broadcast to all group members except sender', async () => {
      pool.query
        .mockResolvedValueOnce([[{ workspace_id: 7 }]])     // resolveWorkspaceId: groups.workspace_id
        .mockResolvedValueOnce([{ insertId: 101 }])         // INSERT message
        .mockResolvedValueOnce([[]])                        // sender avatar
        .mockResolvedValueOnce([[{ 1: 1 }]])                // group membership
        .mockResolvedValueOnce([[{ name: 'Test Group' }]])  // group row
        .mockResolvedValueOnce([[{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]]); // members
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const sendHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'send_message'
      )?.[1];
      await sendHandler({ groupId: 5, content: 'Hi group!', messageType: 'text' });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to).toHaveBeenCalledWith('user:3');
      expect(socket.emit).toHaveBeenCalledWith('new_message', expect.objectContaining({
        id: 101, group_id: 5,
      }));
    });

    it('should reject group message if sender is not a member', async () => {
      pool.query
        .mockResolvedValueOnce([{ insertId: 102 }])
        .mockResolvedValueOnce([[]]);
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const callback = jest.fn();
      const sendHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'send_message'
      )?.[1];
      await sendHandler({ groupId: 5, content: 'Hi group!', messageType: 'text' }, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', message: 'No eres miembro de este grupo' })
      );
      expect(io.to).not.toHaveBeenCalled();
    });

    it('should emit error if DB fails', async () => {
      pool.query.mockRejectedValue(new Error('DB error'));
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const callback = jest.fn();
      const sendHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'send_message'
      )?.[1];
      await sendHandler({ receiverId: 2, content: 'Hello!' }, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', message: 'Error al enviar mensaje' })
      );
    });

    it('should persist message but not emit when neither receiverId nor groupId provided', async () => {
      pool.query.mockResolvedValue([{ insertId: 200 }]);
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const sendHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'send_message'
      )?.[1];
      await sendHandler({ content: 'orphan message' });

      expect(pool.query).toHaveBeenCalled();
      expect(io.to).not.toHaveBeenCalled();
    });
  });

  describe('typing event', () => {
    it('should relay typing indicator to user', async () => {
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const typingHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'typing'
      )?.[1];
      await typingHandler({ receiverId: 2, isTyping: true });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('typing_indicator', {
        userId: 1, isTyping: true,
      });
    });

    it('should relay typing indicator to group', async () => {
      pool.query
        .mockResolvedValueOnce([[{ 1: 1 }]])
        .mockResolvedValueOnce([[{ user_id: 1 }, { user_id: 2 }]]);
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const typingHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'typing'
      )?.[1];
      await typingHandler({ groupId: 5, isTyping: true });

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('typing_indicator', {
        userId: 1, groupId: 5, isTyping: true,
      });
    });

    it('should not emit typing when neither receiverId nor groupId provided', () => {
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const typingHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'typing'
      )?.[1];
      typingHandler({ isTyping: true });

      expect(io.to).not.toHaveBeenCalled();
      expect(socket.to).not.toHaveBeenCalled();
    });
  });

  describe('mark_read event', () => {
    it('should update read_at and notify sender', async () => {
      pool.query.mockResolvedValue([{ affectedRows: 2 }]);
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const readHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'mark_read'
      )?.[1];
      await readHandler({ senderId: 2 });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages SET read_at'),
        [2, 1]
      );
      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to('user:2').emit).toHaveBeenCalledWith('messages_read', { readBy: 1 });
    });

    it('should log error if mark_read DB query fails', async () => {
      pool.query.mockRejectedValue(new Error('DB error'));
      const { socket, io } = createMockSocket(1);
      setupChatHandler(io, socket, 1);

      const readHandler = (socket.on as jest.Mock).mock.calls.find(
        (c: any) => c[0] === 'mark_read'
      )?.[1];
      await readHandler({ senderId: 2 });

      expect(pool.query).toHaveBeenCalled();
      expect(io.to).not.toHaveBeenCalled();
    });
  });
});
