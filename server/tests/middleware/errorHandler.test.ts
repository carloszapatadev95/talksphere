import { errorHandler } from '../../src/middleware/errorHandler';
import type { Request, Response, NextFunction } from 'express';

function mockReqRes() {
  const req = {} as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('errorHandler middleware', () => {
  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    (console.warn as any).mockRestore();
    (console.error as any).mockRestore();
  });

  it('should handle OpenAPI validation errors with status and errors', () => {
    process.env.OPENAPI_STRICT = 'true';
    const { req, res, next } = mockReqRes();
    const err = { status: 400, errors: [{ path: '/body/email', message: 'Invalid email' }] };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation error',
      detail: err.errors,
    });
    delete process.env.OPENAPI_STRICT;
  });

  it('should call next if OPENAPI_STRICT is false', () => {
    const original = process.env.OPENAPI_STRICT;
    process.env.OPENAPI_STRICT = 'false';
    const { req, res, next } = mockReqRes();
    const err = { status: 400, errors: [{ path: '/body/email', message: 'Invalid email' }] };
    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalled();
    process.env.OPENAPI_STRICT = original;
  });

  it('should return 500 for unknown errors', () => {
    const { req, res, next } = mockReqRes();
    const err = new Error('Something broke');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Error interno del servidor',
    });
  });

  it('should include error detail in development mode', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const { req, res, next } = mockReqRes();
    const err = new Error('Something broke');
    errorHandler(err, req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'Something broke' })
    );
    process.env.NODE_ENV = originalNodeEnv;
  });
});
