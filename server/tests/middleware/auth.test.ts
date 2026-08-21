import { authenticate } from '../../src/middleware/auth';
import type { AuthRequest } from '../../src/middleware/auth';
import type { Response, NextFunction } from 'express';

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const jwt = require('jsonwebtoken');

function mockReqRes(headers?: Record<string, string>) {
  const req = { headers: headers || {} } as AuthRequest;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if no Authorization header', () => {
    const { req, res, next } = mockReqRes({});
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token requerido' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if header does not start with Bearer', () => {
    const { req, res, next } = mockReqRes({ authorization: 'Basic token123' });
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token requerido' });
  });

  it('should return 401 if token is invalid', () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const { req, res, next } = mockReqRes({ authorization: 'Bearer invalid-token' });
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido o expirado' });
  });

  it('should call next with userId and username if token is valid', () => {
    jwt.verify.mockReturnValue({ id: 5, username: 'johndoe' });
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    authenticate(req, res, next);
    expect(req.userId).toBe(5);
    expect(req.username).toBe('johndoe');
    expect(next).toHaveBeenCalled();
  });
});
