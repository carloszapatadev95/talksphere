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
