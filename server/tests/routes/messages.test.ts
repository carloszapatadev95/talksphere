import request from 'supertest';
import express from 'express';

jest.mock('../../src/db/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../src/middleware/tenantScope', () => {
  const scope = { userId: 1, activeWorkspaceId: 1, workspaceIds: [1] };
  return {
    getUserTenantScope: jest.fn().mockResolvedValue(scope),
    shareWorkspace: jest.fn().mockResolvedValue(true),
    invalidateUserScope: jest.fn(),
  };
});

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

function createMessagesApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/messages', require('../../src/routes/messages').default);
  return app;
}

const testToken = require('jsonwebtoken').sign(
  { id: 1, username: 'testuser' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);

describe('GET /api/messages/conversations', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createMessagesApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return list of conversations', async () => {
    pool.query.mockResolvedValueOnce([[
      { contact_id: 2, username: 'alice', avatar_url: null,
        is_online: true, last_message: 'Hey!', last_message_at: '2026-01-01T00:00:00Z',
        message_type: 'text' },
    ]]);
    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/messages/conversations');
    expect(res.status).toBe(401);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/messages/:userId', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createMessagesApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return messages with pagination', async () => {
    pool.query.mockResolvedValueOnce([[]]); // check is_suspended del otro usuario
    pool.query.mockResolvedValueOnce([[
      { id: 1, sender_id: 2, receiver_id: 1, content: 'Hello', message_type: 'text',
        created_at: '2026-01-01T00:00:00Z', read_at: null, sender_name: 'alice', sender_avatar: null },
    ]]);
    const res = await request(app)
      .get('/api/messages/2')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it('should accept offset and limit params', async () => {
    pool.query.mockResolvedValueOnce([[]]); // check is_suspended
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .get('/api/messages/2?offset=0&limit=20')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/messages/2')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});
