const mockIo = jest.fn();

jest.mock('socket.io-client', () => ({
  io: mockIo,
}));

describe('socket service', () => {
  let mockSocket: any;

  beforeEach(() => {
    jest.resetModules();
    mockSocket = {
      on: jest.fn().mockReturnThis(),
      emit: jest.fn().mockReturnThis(),
      disconnect: jest.fn(),
      connected: true,
    };
    mockIo.mockReturnValue(mockSocket);
  });

  it('connectSocket creates a new socket connection', () => {
    const { connectSocket } = require('../../src/services/socket');
    const socket = connectSocket('test-token');
    expect(mockIo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        auth: { token: 'test-token' },
        transports: ['websocket', 'polling'],
      })
    );
    expect(socket).toBe(mockSocket);
  });

  it('connectSocket returns existing socket if already connected', () => {
    const { connectSocket } = require('../../src/services/socket');
    const first = connectSocket('token-1');
    const second = connectSocket('token-2');
    expect(first).toBe(second);
  });

  it('getSocket returns null when not connected', () => {
    const { getSocket } = require('../../src/services/socket');
    expect(getSocket()).toBeNull();
  });

  it('getSocket returns socket after connect', () => {
    const { connectSocket, getSocket } = require('../../src/services/socket');
    connectSocket('test-token');
    expect(getSocket()).toBe(mockSocket);
  });

  it('disconnectSocket disconnects and clears reference', () => {
    const { connectSocket, disconnectSocket, getSocket } = require('../../src/services/socket');
    connectSocket('test-token');
    disconnectSocket();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(getSocket()).toBeNull();
  });

  it('disconnectSocket handles null socket gracefully', () => {
    const { disconnectSocket } = require('../../src/services/socket');
    expect(() => disconnectSocket()).not.toThrow();
  });
});
