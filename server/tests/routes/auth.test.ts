import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';

jest.mock('../../src/db/connection', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    getConnection: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('express-rate-limit', () => {
  const mockMw = (_req: any, _res: any, next: any) => next();
  return jest.fn(() => mockMw);
});

function getPool() {
  const poolModule = require('../../src/db/connection');
  return poolModule.default || poolModule;
}

function createAuthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../../src/routes/auth').default);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  });
  return app;
}

const mockConn = {
  query: jest.fn().mockResolvedValue([[], { insertId: 1 }]),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
};

function mockConnection() {
  const poolModule = require('../../src/db/connection');
  const pool = poolModule.default || poolModule;
  pool.getConnection.mockResolvedValue(mockConn);
  return pool;
}

describe('POST /api/auth/register', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createAuthApp();
    pool = mockConnection();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    pool.getConnection.mockResolvedValue(mockConn);
    mockConn.query.mockReset();
    mockConn.beginTransaction.mockResolvedValue(undefined);
    mockConn.commit.mockResolvedValue(undefined);
    mockConn.rollback.mockResolvedValue(undefined);
    mockConn.release.mockResolvedValue(undefined);
  });

  it('should register a new user and return token', async () => {
    // conn.query sequence: existing-user check, INSERT user, slug check, name check, INSERT workspace, INSERT member
    mockConn.query
      .mockResolvedValueOnce([[]])                       // existing users -> none
      .mockResolvedValueOnce([{ insertId: 1 }])        // INSERT users
      .mockResolvedValueOnce([[]])                       // slug free
      .mockResolvedValueOnce([[]])                       // name free
      .mockResolvedValueOnce([{ insertId: 2 }])          // INSERT workspaces
      .mockResolvedValueOnce([]);                        // INSERT workspace_members
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'new@test.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ id: 1, username: 'newuser', email: 'new@test.com' });
  });

  it('should return 409 if email or username already exists', async () => {
    mockConn.query.mockResolvedValueOnce([[{ id: 1 }]]);  // existing users found
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'existing', email: 'existing@test.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('El email o usuario ya existe');
  });

  it('should return 400 if fields are missing', async () => {
    mockConn.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'u' });
    expect(res.status).toBe(400);
  });

  it('should return 500 if DB error on register', async () => {
    mockConn.query.mockRejectedValueOnce(new Error('DB connection failed'));
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'test', email: 'test@test.com', password: 'password123' });
    expect(res.status).toBe(500);
    expect(mockConn.release).toHaveBeenCalled();
  });

  it('should register with invitation code and match workspace_contacts by email', async () => {
    mockConn.query
      .mockResolvedValueOnce([[]])                       // existing users -> none
      .mockResolvedValueOnce([[{ id: 10, workspace_id: 2, created_by: 3, max_uses: 5, use_count: 0, is_revoked: 0, expires_at: null }]]) // code lookup
      .mockResolvedValueOnce([[{ id: 2, max_seats: 50, is_active: 1 }]]) // workspace
      .mockResolvedValueOnce([[{ used: 1 }]])             // seats
      .mockResolvedValueOnce([{ insertId: 1 }])          // INSERT users
      .mockResolvedValueOnce([[]])                       // slug free
      .mockResolvedValueOnce([[]])                       // name free
      .mockResolvedValueOnce([{ insertId: 3 }])          // INSERT own workspace (created_by=1)
      .mockResolvedValueOnce([])                         // INSERT member own workspace
      .mockResolvedValueOnce([])                         // INSERT IGNORE member invited workspace
      .mockResolvedValueOnce([])                         // UPDATE invitations use_count
      .mockResolvedValueOnce([]);                        // UPDATE workspace_contacts registered_user_id
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'inviteduser', email: 'INVITED@x.com', password: 'password123', invitationCode: 'SLUG-A1B2' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ id: 1, username: 'inviteduser' });
    // Verificar el match-on-register (UPDATE de workspace_contacts con email en minúsculas)
    const matchCall = mockConn.query.mock.calls.find((c: any[]) => c[0].includes('workspace_contacts'));
    expect(matchCall).toBeTruthy();
    expect(matchCall[1]).toEqual([1, 2, 'invited@x.com']);
  });

  it('should return 403 with invalid invitation code', async () => {
    mockConn.query
      .mockResolvedValueOnce([[]])                       // existing users -> none
      .mockResolvedValueOnce([[]]);                      // code lookup -> none
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ghost', email: 'ghost@x.com', password: 'password123', invitationCode: 'BAD-CODE' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Código de invitación inválido');
  });
});

describe('POST /api/auth/login', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createAuthApp();
    pool = getPool();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should login with valid credentials', async () => {
    const hash = bcrypt.hashSync('correctpassword', 12);
    pool.query.mockResolvedValueOnce([[{
      id: 1, username: 'testuser', email: 'test@test.com',
      password_hash: hash, avatar_url: null,
    }]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'correctpassword' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ id: 1, username: 'testuser' });
  });

  it('should return 401 if email not found', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('should return 401 if password is wrong', async () => {
    const hash = bcrypt.hashSync('correctpassword', 12);
    pool.query.mockResolvedValueOnce([[{
      id: 1, username: 'testuser', email: 'test@test.com', password_hash: hash,
    }]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('should return 400 if email or password missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com' });
    expect(res.status).toBe(400);
  });

  it('should return 500 if DB error on login', async () => {
    pool.query.mockRejectedValue(new Error('DB connection failed'));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'password123' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/auth/me', () => {
  let app: express.Express;
  let pool: any;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createAuthApp();
    pool = getPool();
  });
  afterAll(() => {
    (console.error as any).mockRestore();
    jest.resetModules();
  });
  beforeEach(() => { jest.clearAllMocks(); });

  it('should return user profile with valid token', async () => {
    pool.query.mockResolvedValueOnce([[{
      id: 1, username: 'testuser', email: 'test@test.com',
      avatar_url: null, is_online: true, last_seen: '2026-01-01T00:00:00Z',
    }]]);
    const token = require('jsonwebtoken').sign(
      { id: 1, username: 'testuser' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('testuser');
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should return 404 if user not found', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const token = require('jsonwebtoken').sign(
      { id: 999, username: 'ghost' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('should return 500 if DB error on /me', async () => {
    pool.query.mockRejectedValue(new Error('DB connection failed'));
    const token = require('jsonwebtoken').sign(
      { id: 1, username: 'test' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});
