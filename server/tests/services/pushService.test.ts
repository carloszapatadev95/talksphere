jest.mock('expo-server-sdk', () => {
  const mockChunk = jest.fn(() => []);
  const mockSend = jest.fn();
  const Expo = jest.fn(() => ({
    chunkPushNotifications: mockChunk,
    sendPushNotificationsAsync: mockSend,
  })) as any;
  Expo.isExpoPushToken = jest.fn(() => true);
  return { Expo };
});

jest.mock('../../src/db/connection', () => ({
  query: jest.fn(),
  getConnection: jest.fn().mockResolvedValue(true),
}));

const pool = require('../../src/db/connection');

describe('pushService', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    (console.error as any).mockRestore();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isUserOnline', () => {
    it('should return true when room has sockets', () => {
      const { isUserOnline } = require('../../src/services/pushService');
      const mockIo = {
        sockets: { adapter: { rooms: new Map([['user:5', new Set(['socket-1'])]]) } },
      };
      expect(isUserOnline(5, mockIo)).toBe(true);
    });

    it('should return false when room is empty', () => {
      const { isUserOnline } = require('../../src/services/pushService');
      const mockIo = {
        sockets: { adapter: { rooms: new Map() } },
      };
      expect(isUserOnline(5, mockIo)).toBe(false);
    });
  });

  describe('sendPush', () => {
    it('should not send if user has no tokens', async () => {
      const { sendPush } = require('../../src/services/pushService');
      pool.query.mockResolvedValue([[]]);
      await sendPush(1, 'Title', 'Body');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT token, platform FROM push_tokens'),
        [1]
      );
    });

    it('should send push notifications for each token', async () => {
      const { sendPush } = require('../../src/services/pushService');
      pool.query.mockResolvedValue([[{ token: 'ExponentPushToken[valid-1]', platform: 'android' }, { token: 'ExponentPushToken[valid-2]', platform: 'ios' }]]);

      await sendPush(1, 'Hello', 'Test message', { key: 'val' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT token, platform FROM push_tokens'),
        [1]
      );
    });

    it('should log error if DB query fails', async () => {
      const { sendPush } = require('../../src/services/pushService');
      pool.query.mockRejectedValue(new Error('DB error'));
      await sendPush(1, 'Title', 'Body');
      expect(pool.query).toHaveBeenCalled();
    });
  });
});
