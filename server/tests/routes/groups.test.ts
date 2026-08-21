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
    belongsToWorkspace: jest.fn().mockResolvedValue(true),
    invalidateUserScope: jest.fn(),
  };
});

jest.mock('../../src/socket', () => ({
  getIO: () => ({
    to: () => ({ emit: jest.fn() }),
    emit: jest.fn(),
    sockets: { adapter: { rooms: { keys: () => [] } } },
  }),
}));

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

function createGroupsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/groups', require('../../src/routes/groups').default);
  return app;
}

const testToken = require('jsonwebtoken').sign(
  { id: 1, username: 'testuser' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);

describe('POST /api/groups', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createGroupsApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should create a group with members', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }]);
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Test Group', description: 'A test group', memberIds: [2, 3] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 10, name: 'Test Group' });
  });

  it('should skip adding creator to member values if already included', async () => {
    pool.query
      .mockResolvedValueOnce([{ insertId: 11 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }]);
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Self Member', description: '', memberIds: [1, 3] });
    expect(res.status).toBe(201);
  });

  it('should return 400 if name or members are missing', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Test Group' });
    expect(res.status).toBe(400);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Test', memberIds: [2] });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/groups', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createGroupsApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should list user groups with role', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, name: 'Group 1', role: 'admin' }]]);
    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/groups/:id', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createGroupsApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return group info if member', async () => {
    pool.query
      .mockResolvedValueOnce([[{ 1: 1 }]]) // membership check passes
      .mockResolvedValueOnce([[{ id: 1, name: 'Test Group', description: 'Desc' }]]);
    const res = await request(app)
      .get('/api/groups/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.group.name).toBe('Test Group');
  });

  it('should return 403 if user is not a member', async () => {
    pool.query.mockResolvedValueOnce([[]]); // membership check fails
    const res = await request(app)
      .get('/api/groups/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(403);
  });

  it('should return 404 if group does not exist', async () => {
    pool.query
      .mockResolvedValueOnce([[{ 1: 1 }]]) // membership check passes
      .mockResolvedValueOnce([[]]); // no group found
    const res = await request(app)
      .get('/api/groups/999')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/groups/:id/members', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createGroupsApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return group members', async () => {
    pool.query
      .mockResolvedValueOnce([[{ 1: 1 }]]) // membership check passes
      .mockResolvedValueOnce([[{ id: 1, username: 'admin', role: 'admin' }]]);
    const res = await request(app)
      .get('/api/groups/1/members')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
  });

  it('should return 403 if user is not a member', async () => {
    pool.query.mockResolvedValueOnce([[]]); // membership check fails
    const res = await request(app)
      .get('/api/groups/1/members')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('No eres miembro de este grupo');
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/groups/1/members')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/groups/:id/messages', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => { app = createGroupsApp(); pool = getPool(); });
  afterAll(() => { jest.resetModules(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return group messages', async () => {
    pool.query
      .mockResolvedValueOnce([[{ 1: 1 }]]) // membership check passes
      .mockResolvedValueOnce([[
        { id: 1, sender_id: 1, group_id: 1, content: 'Hello group!',
          message_type: 'text', created_at: '2026-01-01T00:00:00Z',
          sender_name: 'testuser', sender_avatar: null },
      ]]);
    const res = await request(app)
      .get('/api/groups/1/messages')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it('should return 403 if user is not a member', async () => {
    pool.query.mockResolvedValueOnce([[]]); // membership check fails
    const res = await request(app)
      .get('/api/groups/1/messages')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('No eres miembro de este grupo');
  });

  it('should return 500 if DB error', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/groups/1/messages')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(500);
  });
});
