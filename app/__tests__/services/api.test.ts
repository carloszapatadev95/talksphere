const mockCreate = jest.fn();
const mockInterceptorsReqUse = jest.fn();
const mockInterceptorsResUse = jest.fn();

jest.mock('axios', () => ({
  create: mockCreate.mockReturnValue({
    interceptors: {
      request: { use: mockInterceptorsReqUse },
      response: { use: mockInterceptorsResUse },
    },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  }),
}));

describe('api service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreate.mockClear();
    mockInterceptorsReqUse.mockClear();
    mockInterceptorsResUse.mockClear();
    (globalThis as any).__token = undefined;
  });

  it('creates axios instance with baseURL', () => {
    const api = require('../../src/services/api').default;
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.any(String),
      })
    );
  });

  it('sets up request interceptor that adds token', () => {
    (globalThis as any).__token = 'my-token';
    const api = require('../../src/services/api').default;
    const reqConfigFn = mockInterceptorsReqUse.mock.calls[0][0];
    const config = reqConfigFn({ headers: {} });
    expect(config.headers.Authorization).toBe('Bearer my-token');
  });

  it('request interceptor returns config unchanged if no token', () => {
    const api = require('../../src/services/api').default;
    const reqConfigFn = mockInterceptorsReqUse.mock.calls[0][0];
    const config = reqConfigFn({ headers: {} });
    expect(config.headers.Authorization).toBeUndefined();
  });

  it('sets up response interceptor for error handling', () => {
    const api = require('../../src/services/api').default;
    expect(mockInterceptorsResUse.mock.calls[0]).toBeDefined();
    const errorFn = mockInterceptorsResUse.mock.calls[0][1];
    expect(typeof errorFn).toBe('function');
  });
});
