import { authenticate, getSessionEpoch, setSessionEpoch } from '../../src/middleware/auth';
import type { AuthRequest } from '../../src/middleware/auth';
import type { Response, NextFunction } from 'express';

jest.mock('../../src/db/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

const jwt = require('jsonwebtoken');

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

// userIds únicos por test: la caché de epoch vive a nivel de módulo
const ID_SIN_EPOCH = 51;
const ID_EPOCH_VIEJA = 52;
const ID_VALIDO = 53;
const ID_FANTASMA = 54;
const ID_CACHE = 55;

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
  let pool: { query: jest.Mock };

  beforeAll(() => {
    pool = getPool() as unknown as { query: jest.Mock };
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if no Authorization header', async () => {
    const { req, res, next } = mockReqRes({});
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token requerido' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if header does not start with Bearer', async () => {
    const { req, res, next } = mockReqRes({ authorization: 'Basic token123' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token requerido' });
  });

  it('should return 401 if token signature is invalid', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const { req, res, next } = mockReqRes({ authorization: 'Bearer invalid-token' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido o expirado' });
  });

  it('should reject tokens without epoch (emitidos antes del feature)', async () => {
    jwt.verify.mockReturnValue({ id: ID_SIN_EPOCH, username: 'johndoe' });
    pool.query.mockResolvedValueOnce([[{ session_epoch: 1 }]]);
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Sesión revocada: la cuenta inició sesión en otro dispositivo',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject tokens with stale epoch', async () => {
    jwt.verify.mockReturnValue({ id: ID_EPOCH_VIEJA, username: 'johndoe', epoch: 3 });
    pool.query.mockResolvedValueOnce([[{ session_epoch: 4 }]]);
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Sesión revocada: la cuenta inició sesión en otro dispositivo',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next with userId and username if epoch matches', async () => {
    jwt.verify.mockReturnValue({ id: ID_VALIDO, username: 'johndoe', epoch: 4 });
    pool.query.mockResolvedValueOnce([[{ session_epoch: 4 }]]);
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    await authenticate(req, res, next);
    expect(req.userId).toBe(ID_VALIDO);
    expect(req.username).toBe('johndoe');
    expect(next).toHaveBeenCalled();
  });

  it('should return 500 if DB fails while validating the session', async () => {
    jwt.verify.mockReturnValue({ id: 91, username: 'johndoe', epoch: 1 });
    pool.query.mockRejectedValueOnce(new Error('DB down'));
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error al validar la sesión' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject if user no longer exists', async () => {
    jwt.verify.mockReturnValue({ id: ID_FANTASMA, username: 'ghost', epoch: 1 });
    pool.query.mockResolvedValueOnce([[]]);
    const { req, res, next } = mockReqRes({ authorization: 'Bearer valid-token' });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Sesión revocada: la cuenta inició sesión en otro dispositivo',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should cache the epoch between requests and honor setSessionEpoch after login', async () => {
    jwt.verify.mockReturnValue({ id: ID_CACHE, username: 'johndoe', epoch: 2 });
    pool.query.mockResolvedValue([[{ session_epoch: 2 }]]);

    const first = mockReqRes({ authorization: 'Bearer t1' });
    await authenticate(first.req, first.res, first.next);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(first.next).toHaveBeenCalled();

    const second = mockReqRes({ authorization: 'Bearer t2' });
    await authenticate(second.req, second.res, second.next);
    // Sigue en 1 query: la segunda lectura salió de caché
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(second.next).toHaveBeenCalled();

    // Login en otro dispositivo → el servidor setea la nueva epoch → token viejo rechaza sin tocar DB
    setSessionEpoch(ID_CACHE, 3);
    const third = mockReqRes({ authorization: 'Bearer t3' });
    await authenticate(third.req, third.res, third.next);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(third.res.status).toHaveBeenCalledWith(401);
    expect(third.next).not.toHaveBeenCalled();
  });

  describe('getSessionEpoch', () => {
    it('returns -1 for missing user without caching the value', async () => {
      pool.query.mockResolvedValueOnce([[]]);
      const epoch = await getSessionEpoch(42);
      expect(epoch).toBe(-1);

      // No se cachea -1: la próxima lectura reconsulta
      pool.query.mockResolvedValueOnce([[{ session_epoch: 7 }]]);
      const epoch2 = await getSessionEpoch(42);
      expect(epoch2).toBe(7);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
