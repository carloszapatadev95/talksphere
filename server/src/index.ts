import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import * as OpenApiValidator from 'express-openapi-validator';
import yaml from 'js-yaml';

dotenv.config();

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import notificationRoutes from './routes/notifications';
import pushTestRoutes from './routes/pushTest';
import messageRoutes from './routes/messages';
import groupRoutes from './routes/groups';
import livekitRoutes from './routes/livekit';
import uploadRoutes from './routes/upload';
import avatarRoutes from './routes/avatar';
import callsRoutes from './routes/calls';
import tenantsRoutes from './routes/workspaces';
import invitationsRoutes from './routes/workspaceInvitations';
import adminUsersRoutes from './routes/adminUsers';
import { getJwtSecret, getSessionEpoch } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { setupChatHandler } from './socket/chatHandler';
import { setupSignalingHandler, getPendingIncomingCall, clearPendingIncomingCall } from './socket/signalingHandler';
import { setIO } from './socket';
import { getUserTenantScope } from './middleware/tenantScope';
import pool from './db/connection';

const openApiPath = path.join(__dirname, '../openapi.yaml');
const openApiSpec = yaml.load(fs.readFileSync(openApiPath, 'utf8'));

const app = express();
app.disable('etag');
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 60000,
});
setIO(io);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', cors(), express.static(path.join(__dirname, '../public/uploads')));
app.use('/avatars', cors(), express.static(path.join(__dirname, '../public/avatars')));
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${ip} -> ${res.statusCode}`);
  });
  next();
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec as any));

app.use('/api', apiLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rutas con multer — deben ir ANTES del OpenAPI Validator
// para evitar que el validator consuma el stream multipart primero
app.use('/api', uploadRoutes);
app.use('/api', avatarRoutes);

app.use(
  OpenApiValidator.middleware({
    apiSpec: openApiSpec as any,
    validateRequests: true,
    validateResponses: process.env.VALIDATE_RESPONSES === 'true',
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/users', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/livekit', livekitRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/tenants', tenantsRoutes);
app.use('/api/workspaces', tenantsRoutes);
app.use('/api/invitations', invitationsRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api', pushTestRoutes);

app.use(errorHandler);

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    next(new Error('Token requerido'));
    return;
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: number;
      username: string;
      epoch?: number;
    };
    // Sesión única: rechazar sockets con tokens de logins anteriores
    const currentEpoch = await getSessionEpoch(decoded.id);
    if (typeof decoded.epoch !== 'number' || decoded.epoch !== currentEpoch) {
      next(new Error('Sesión revocada'));
      return;
    }
    (socket as any).userId = decoded.id;
    (socket as any).username = decoded.username;
    next();
  } catch {
    next(new Error('Token inválido'));
  }
});

io.on('connection', async (socket) => {
  const userId = (socket as any).userId;
  const username = (socket as any).username;

  console.log(`User connected: ${username} (${userId})`);
  socket.join(`user:${userId}`);

  const scope = await getUserTenantScope(userId);
  // Unir a rooms de presencia por cada workspace al que pertenece el usuario
  for (const wsId of scope.workspaceIds) {
    socket.join(`workspace:${wsId}`);
  }

  // Registrar handlers ANTES de cualquier await para evitar race conditions
  // donde el cliente envía eventos antes de que los handlers estén listos
  setupChatHandler(io, socket, userId, username);
  setupSignalingHandler(io, socket, userId, username);

  // Re-emitir llamada entrante pendiente si el usuario reconecta
  const pending = getPendingIncomingCall(userId);
  if (pending) {
    socket.emit('incoming_call', pending);
    clearPendingIncomingCall(userId);
  }

  await pool.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = ?', [userId]);

  // Broadcast de presencia scopeado por workspace(s) del usuario
  const broadcastOnline = () => {
    for (const wsId of scope.workspaceIds) {
      io.to(`workspace:${wsId}`).emit('user_status', { userId, isOnline: true });
    }
  };
  broadcastOnline();

  // Enviar estado online actual desde las rooms de Socket.io (sin race condition de DB)
  // Filtrado por los usuarios que comparten al menos un workspace con este usuario.
  const allOnlineIds = Array.from(io.sockets.adapter.rooms.keys())
    .filter((key) => key.startsWith('user:'))
    .map((key) => parseInt(key.replace('user:', ''), 10));

  let onlineIds: number[];
  if (scope.workspaceIds.length) {
    // Miembros de los mismos workspaces → consultar user_ids que están en esos workspaces.
    // Se incluye el propio userId: el usuario activo debe verse a sí mismo en línea
    // (avatar del Dashboard) — si se excluye, el snapshot online_users pisa el
    // user_status propio y su avatar queda siempre "Desconectado".
    const [memberRows] = await pool.query(
      `SELECT DISTINCT user_id FROM workspace_members WHERE workspace_id = ANY(?)`,
      [scope.workspaceIds]
    );
    const memberIds = new Set((memberRows as any[]).map((r: any) => r.user_id));
    onlineIds = allOnlineIds.filter((id) => memberIds.has(id));
  } else {
    onlineIds = [];
  }
  // Asegurar que el propio usuario esté en el set (conectado a este socket)
  if (!onlineIds.includes(userId)) onlineIds.push(userId);
  socket.emit('online_users', onlineIds);

  socket.on('logout', async () => {
    // Logout explícito: cerrar TODOS los sockets del usuario (incluye sockets
    // rezagados de sesiones anteriores) y marcarlo offline inmediatamente.
    console.log(`User logout: ${username} (${userId})`);
    io.in(`user:${userId}`).disconnectSockets(true);
    await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = ?', [userId]);
    const logoutScope = await getUserTenantScope(userId);
    for (const wsId of logoutScope.workspaceIds) {
      io.to(`workspace:${wsId}`).emit('user_status', { userId, isOnline: false });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${username} (${userId})`);

    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    const stillConnected = room && room.size > 0;

    if (!stillConnected) {
      await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = ?', [userId]);
      const discScope = await getUserTenantScope(userId);
      for (const wsId of discScope.workspaceIds) {
        io.to(`workspace:${wsId}`).emit('user_status', { userId, isOnline: false });
      }
    }
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'db/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // Códigos de error PG de "ya aplicado" (tabla/columna/constraint duplicada, unique violation, ...)
  const IDEMPOTENT_CODES = new Set(['42P07', '42701', '42710', '42P04', '23505', '42P16', '42P06', '42830']);

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const [rows] = await pool.query('SELECT id FROM _migrations WHERE name = ?', [file]);
    if ((rows as any[]).length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err: any) {
        const alreadyApplied = err?.code && IDEMPOTENT_CODES.has(err.code);
        if (alreadyApplied) {
          console.warn(`[migration] ${file}: omitting statement (already applied): ${err.message}`);
          continue;
        }
        throw err;
      }
    }
    await pool.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
    console.log(`Migration applied: ${file}`);
  }
}

async function start() {
  try {
    // Validar JWT_SECRET al arranque (después de dotenv)
    getJwtSecret();

    // Asegurar que los directorios de upload existen
    fs.mkdirSync(path.join(__dirname, '../public/uploads'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, '../public/avatars'), { recursive: true });

    await pool.query('SELECT 1');
    console.log('PostgreSQL connected');

    await runMigrations();

    // Resetear estados online al iniciar (limpieza de conexiones previas caídas)
    await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW()');

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
