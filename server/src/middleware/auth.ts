import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/connection';

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

// ── Sesión única (session_epoch) ─────────────────────────────
// Cada login incrementa users.session_epoch; el JWT guarda la epoch
// con la que fue emitido y se rechaza si quedó atrás (login en otro
// dispositivo). Tokens sin epoch (previos a este feature) caducan.
const epochCache = new Map<number, number>();

/** Lee la epoch vigente del usuario (con caché en memoria). */
export async function getSessionEpoch(userId: number): Promise<number> {
  const cached = epochCache.get(userId);
  if (cached !== undefined) return cached;

  const [rows] = await pool.query('SELECT session_epoch FROM users WHERE id = ?', [userId]);
  const row = (rows as any[])[0];
  if (!row) return -1; // usuario inexistente → ningún token válido
  const epoch = Number(row.session_epoch ?? 1);
  epochCache.set(userId, epoch);
  return epoch;
}

/** Actualiza la caché tras incrementar la epoch en DB (login). */
export function setSessionEpoch(userId: number, epoch: number): void {
  epochCache.set(userId, epoch);
}

function tokenEpochValid(decoded: { id?: number; epoch?: number }, current: number): boolean {
  return typeof decoded.epoch === 'number' && decoded.epoch === current;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }

  const token = header.split(' ')[1];
  let decoded: { id: number; username: string; epoch?: number };
  try {
    decoded = jwt.verify(token, getJwtSecret()) as {
      id: number;
      username: string;
      epoch?: number;
    };
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  let current: number;
  try {
    current = await getSessionEpoch(decoded.id);
  } catch {
    res.status(500).json({ error: 'Error al validar la sesión' });
    return;
  }

  if (!tokenEpochValid(decoded, current)) {
    res.status(401).json({ error: 'Sesión revocada: la cuenta inició sesión en otro dispositivo' });
    return;
  }

  req.userId = decoded.id;
  req.username = decoded.username;
  next();
}
