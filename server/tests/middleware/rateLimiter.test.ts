describe('rateLimiter middleware', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('should create authLimiter with max 50 and apiLimiter with max 500', () => {
    const calls: any[] = [];
    const mockMw = jest.fn((_req: any, _res: any, next: any) => next());
    jest.mock('express-rate-limit', () => {
      return jest.fn((opts: any) => {
        calls.push(opts);
        return mockMw;
      });
    });

    const { authLimiter, apiLimiter } = require('../../src/middleware/rateLimiter');

    expect(calls).toHaveLength(2);
    expect(calls[0].max).toBe(50);
    expect(calls[0].windowMs).toBe(15 * 60 * 1000);
    expect(calls[1].max).toBe(500);
    expect(calls[1].windowMs).toBe(15 * 60 * 1000);
    expect(typeof authLimiter).toBe('function');
    expect(typeof apiLimiter).toBe('function');
  });
});
