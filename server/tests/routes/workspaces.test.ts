import request from 'supertest';
import express from 'express';
import { mockAuthMiddleware } from '../helpers';

jest.mock('../../src/db/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(true),
  },
}));


mockAuthMiddleware();
jest.mock('../../src/middleware/tenantScope', () => ({
  getUserTenantScope: jest.fn(),
  shareWorkspace: jest.fn().mockResolvedValue(true),
  invalidateUserScope: jest.fn(),
}));

jest.mock('../../src/socket', () => ({
  getIO: () => ({
    to: () => ({ emit: jest.fn() }),
    emit: jest.fn(),
  }),
}));

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

function getScopeMock() {
  return require('../../src/middleware/tenantScope');
}

function createWorkspacesApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', require('../../src/routes/workspaces').default);
  return app;
}

const testToken = require('jsonwebtoken').sign(
  { id: 1, username: 'testuser' },
  process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);

const MEMBER_SCOPE = { userId: 1, activeWorkspaceId: 1, workspaceIds: [1] };
const FOREIGN_SCOPE = { userId: 1, activeWorkspaceId: 99, workspaceIds: [99] };

describe('POST /api/workspaces/:id/contacts', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should import new contacts (insert)', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .post('/api/workspaces/1/contacts')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        contacts: [
          { name: 'Ana', email: 'ana@x.com', phone: '123' },
          { name: 'Bob', email: 'bob@x.com' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 2, total: 2 });
  });

  it('should not count upserts as new imports', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
    const res = await request(app)
      .post('/api/workspaces/1/contacts')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ contacts: [{ name: 'Ana', email: 'ana@x.com' }] });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(0);
    expect(res.body.total).toBe(1);
  });

  it('should ignore contacts without name/email/phone', async () => {
    const res = await request(app)
      .post('/api/workspaces/1/contacts')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ contacts: [{}, { name: '' }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 0, total: 2 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('should return 403 for non-members', async () => {
    scopeMock.getUserTenantScope.mockResolvedValue(FOREIGN_SCOPE);
    const res = await request(app)
      .post('/api/workspaces/1/contacts')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ contacts: [{ name: 'Ana' }] });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/workspaces/:id/contacts/match', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should mark registered contacts by email', async () => {
    pool.query.mockResolvedValueOnce([
      [{ id: 5, email: 'ana@x.com' }, { id: 9, email: 'bob@X.com' }],
    ]);
    const res = await request(app)
      .post('/api/workspaces/1/contacts/match')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        contacts: [
          { name: 'Ana', email: 'ANA@x.com', phone: '123' },
          { name: 'Bob', email: 'bob@x.com' },
          { name: 'Carlos', email: 'carlos@x.com' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(3);
    expect(res.body.matches[0]).toMatchObject({ registered: true, registeredUserId: 5 });
    expect(res.body.matches[1]).toMatchObject({ registered: true, registeredUserId: 9 });
    expect(res.body.matches[2]).toMatchObject({ registered: false, registeredUserId: null });
  });

  it('should return 403 for non-members', async () => {
    scopeMock.getUserTenantScope.mockResolvedValue(FOREIGN_SCOPE);
    const res = await request(app)
      .post('/api/workspaces/1/contacts/match')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ contacts: [{ name: 'Ana', email: 'ana@x.com' }] });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/workspaces/:id/contacts', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should list contacts with status fields', async () => {
    pool.query.mockResolvedValueOnce([[
      { id: 1, name: 'Ana', email: 'ana@x.com', phone: '123', registered_user_id: 5, invitation_id: 7, invitation_code: 'SLUG-ABC', invited_at: '2026-01-01', is_member: 1 },
      { id: 2, name: 'Bob', email: null, phone: '999', registered_user_id: null, invitation_id: null, invitation_code: null, invited_at: null, is_member: 0 },
    ]]);
    const res = await request(app)
      .get('/api/workspaces/1/contacts')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(2);
    expect(res.body.contacts[0]).toMatchObject({
      id: 1, name: 'Ana', registeredUserId: 5, invitationCode: 'SLUG-ABC', isMember: true,
    });
    expect(res.body.contacts[1]).toMatchObject({ registeredUserId: null, isMember: false });
  });
});

describe('DELETE /api/workspaces/:id/contacts/:contactId', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should remove a contact', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .delete('/api/workspaces/1/contacts/3')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ removed: true, id: 3 });
  });

  it('should return 404 when contact not found', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const res = await request(app)
      .delete('/api/workspaces/1/contacts/999')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/workspaces/:id/members/:userId', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should not allow removing yourself', async () => {
    const res = await request(app)
      .delete('/api/workspaces/1/members/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(400);
  });

  it('should not allow removing the creator', async () => {
    pool.query.mockResolvedValueOnce([[{ created_by: 3 }]]);
    const res = await request(app)
      .delete('/api/workspaces/1/members/3')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(403);
  });

  it('should return 404 when target is not a member', async () => {
    pool.query
      .mockResolvedValueOnce([[{ created_by: 2 }]])
      .mockResolvedValueOnce([[]]);
    const res = await request(app)
      .delete('/api/workspaces/1/members/3')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(404);
  });

  it('should remove a member and clear active workspace', async () => {
    pool.query
      .mockResolvedValueOnce([[{ created_by: 2 }]])
      .mockResolvedValueOnce([[{ user_id: 3 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .delete('/api/workspaces/1/members/3')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ removed: true, workspaceId: 1, userId: 3 });
  });
});

describe('GET /api/workspaces', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should list own and invited workspaces with role/is_owner', async () => {
    pool.query.mockResolvedValueOnce([[
      { id: 1, name: 'Mi WS', slug: 'mi-ws', max_seats: 50, is_active: 1, created_at: '2026-01-01', created_by: 1, role: 'admin', invited_by: null, invited_by_username: null, used_seats: 2 },
      { id: 2, name: 'WS de Ana', slug: 'ws-ana', max_seats: 10, is_active: 1, created_at: '2026-01-02', created_by: 5, role: 'admin', invited_by: 5, invited_by_username: 'ana', used_seats: 3 },
    ]]);
    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(2);
    expect(res.body.workspaces[0]).toMatchObject({ is_owner: true, invited_by: null, invited_by_username: null });
    expect(res.body.workspaces[1]).toMatchObject({ is_owner: false, invited_by: 5, invited_by_username: 'ana' });
  });

  it('should return empty list when user has no workspaces', async () => {
    scopeMock.getUserTenantScope.mockResolvedValue({ userId: 1, activeWorkspaceId: null, workspaceIds: [] });
    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/workspaces/:id (suspender)', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
  });

  it('should only allow the creator to suspend (isActive)', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, created_by: 5, deleted_at: null }]]) // SELECT ws
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
    const res = await request(app)
      .patch('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/creador/);
  });

  it('should allow the creator to suspend', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, created_by: 1, deleted_at: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .patch('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, updated: true });
  });

  it('should return 404 for a soft-deleted workspace', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, created_by: 1, deleted_at: '2026-08-14' }]]);
    const res = await request(app)
      .patch('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/workspaces/:id (soft-delete)', () => {
  let app: express.Express;
  let pool: any;
  let scopeMock: any;
  let mockConn: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createWorkspacesApp();
    pool = getPool();
    scopeMock = getScopeMock();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    scopeMock.getUserTenantScope.mockResolvedValue(MEMBER_SCOPE);
    mockConn = {
      query: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    pool.getConnection.mockResolvedValue(mockConn);
  });

  it('should soft-delete as creator and reassign members', async () => {
    mockConn.query
      .mockResolvedValueOnce([[{ id: 1, created_by: 1 }]]) // SELECT ws
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE deleted_at
      .mockResolvedValueOnce([[{ user_id: 2 }]]) // members
      .mockResolvedValueOnce([[{ workspace_id: 99 }]]) // other ws of member 2
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE users
    const res = await request(app)
      .delete('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, deleted: true });
    expect(mockConn.query).toHaveBeenCalledWith(
      expect.stringContaining('deleted_at = NOW()'),
      [1]
    );
    expect(mockConn.release).toHaveBeenCalled();
  });

  it('should create a new workspace for members without alternatives', async () => {
    mockConn.query
      .mockResolvedValueOnce([[{ id: 1, created_by: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ user_id: 2 }]]) // members
      .mockResolvedValueOnce([[]]) // no other ws
      .mockResolvedValueOnce([[{ username: 'bob' }]]) // SELECT username
      .mockResolvedValueOnce([{ insertId: 555 }]) // INSERT workspace
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT member
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE users
    const res = await request(app)
      .delete('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('should return 403 for non-creator', async () => {
    mockConn.query.mockResolvedValueOnce([[{ id: 1, created_by: 5 }]]);
    const res = await request(app)
      .delete('/api/workspaces/1')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(403);
    expect(mockConn.release).toHaveBeenCalled();
  });

  it('should return 404 when workspace not found', async () => {
    mockConn.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .delete('/api/workspaces/999')
      .set('Authorization', `Bearer ${testToken}`);
    expect(res.status).toBe(404);
  });
});
