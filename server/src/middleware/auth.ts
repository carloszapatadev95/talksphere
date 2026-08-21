import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

let _jwtSecret: string | null = null;

export function getJwtSecret(): string {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET no configurado. Revisa las variables de entorno.');
    }
    _jwtSecret = secret;
  }
  return _jwtSecret;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: number;
      username: string;
    };
    req.userId = decoded.id;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
