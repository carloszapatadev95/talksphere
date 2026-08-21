const mockSocket = {
  on: jest.fn().mockReturnThis(),
  off: jest.fn().mockReturnThis(),
  emit: jest.fn().mockReturnThis(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  connected: true,
  once: jest.fn(),
};

export function getSocket() {
  return mockSocket;
}

export function connectSocket(token: string) {
  return mockSocket;
}

export function disconnectSocket() {
  return undefined;
}
