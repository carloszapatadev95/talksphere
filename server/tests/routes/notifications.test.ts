import request from 'supertest';
import express from 'express';

jest.mock('../../src/db/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(true),
  },
}));

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

function createNotificationsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../src/routes/notifications').default);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  });
  return app;
}

const testToken = require('jsonwebtoken').sign(
  { id: 1, username: 'testuser' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);

describe('PUT /api/users/push-token', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createNotificationsApp();
    pool = getPool();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should register push token successfully', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }]);
    const res = await request(app)
      .put('/api/users/push-token')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ token: 'ExponentPushToken[test-token-123]', platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Token registrado exitosamente');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO push_tokens'),
      [1, 'ExponentPushToken[test-token-123]', 'android']
    );
  });

  it('should return 400 if token is missing', async () => {
    const res = await request(app)
      .put('/api/users/push-token')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ platform: 'android' });
    expect(res.status).toBe(400);
  });

  it('should return 400 if platform is invalid', async () => {
    const res = await request(app)
      .put('/api/users/push-token')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ token: 'ExponentPushToken[test]', platform: 'windows' });
    expect(res.status).toBe(400);
  });

  it('should return 401 without token', async () => {
    const res = await request(app)
      .put('/api/users/push-token')
      .send({ token: 'ExponentPushToken[test]', platform: 'ios' });
    expect(res.status).toBe(401);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .put('/api/users/push-token')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ token: 'ExponentPushToken[test]', platform: 'android' });
    expect(res.status).toBe(500);
  });
});
