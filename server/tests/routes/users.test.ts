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

function createUsersApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../src/routes/users').default);
  return app;
}

const testToken = require('jsonwebtoken').sign(
  { id: 1, username: 'testuser' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);

describe('GET /api/users/contacts', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createUsersApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return all contacts except authenticated user', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, username: 'alice', email: 'alice@test.com' }]]);
    pool.query.mockResolvedValueOnce([[]]); // workspace_contacts
    const res = await request(app)
      .get('/api/users/contacts')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/users/contacts');
    expect(res.status).toBe(401);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/users/contacts')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/users/search', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createUsersApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return matching users', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 2, username: 'alice', email: 'alice@test.com' }]]);
    const res = await request(app)
      .get('/api/users/search?q=ali')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
  });

  it('should return 400 if query is less than 2 chars', async () => {
    const res = await request(app)
      .get('/api/users/search?q=a')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(400);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/users/search?q=test')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});
