import express from 'express';
import type { Express } from 'express';

export function createTestApp(...routeModules: Array<(app: Express) => void>): Express {
  const app = express();
  app.use(express.json());
  for (const mount of routeModules) {
    mount(app);
  }
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  });
  return app;
}

export function mockPoolQuery<T = any>(rows: T): jest.Mock {
  return jest.fn().mockResolvedValue([rows]);
}

export const mockPool = {
  query: jest.fn(),
  getConnection: jest.fn().mockResolvedValue(true),
  execute: jest.fn(),
};

export function generateToken(id = 1, username = 'testuser'): string {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id, username }, 'test-secret', { expiresIn: '1h' });
}

/**
 * Reemplaza el middleware authenticate por uno sin chequeo de session_epoch,
 * para suites que prueban lógica de rutas (la sesión única se cubre en
 * tests/middleware/auth.test.ts y tests/routes/auth.test.ts).
 * Llamarlo a nivel de módulo del suite, antes de montar las rutas.
 */
export function mockAuthMiddleware(): void {
  // Ruta relativa a este archivo (tests/), no al suite que lo invoca
  jest.mock('../src/middleware/auth', () => {
    const jwtActual = jest.requireActual('jsonwebtoken');
    const secret = () => process.env.JWT_SECRET || 'secret';
    return {
      __esModule: true,
      getJwtSecret: secret,
      setSessionEpoch: jest.fn(),
      getSessionEpoch: jest.fn().mockResolvedValue(1),
      authenticate: (req: any, res: any, next: any) => {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Token requerido' });
          return;
        }
        try {
          const decoded = jwtActual.verify(header.split(' ')[1], secret());
          req.userId = decoded.id;
          req.username = decoded.username;
          next();
        } catch {
          res.status(401).json({ error: 'Token inválido o expirado' });
        }
      },
    };
  });
}
