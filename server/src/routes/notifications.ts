import { Router, Response } from 'express';
import pool from '../db/connection';
import { authenticate, AuthRequest } from '../middleware/auth';
import type { components, paths } from '../types/openapi';

type PushTokenResponse = paths['/api/users/push-token']['put']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

router.put('/push-token', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { token, platform } = req.body;

    if (!token || !platform) {
      res.status(400).json({ error: 'Token y plataforma requeridos' } satisfies ErrorResponse);
      return;
    }

    if (!['ios', 'android'].includes(platform)) {
      res.status(400).json({ error: 'Plataforma debe ser ios o android' } satisfies ErrorResponse);
      return;
    }

    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES (?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform`,
      [req.userId, token, platform]
    );

    res.json({ message: 'Token registrado exitosamente' } satisfies PushTokenResponse);
  } catch {
    res.status(500).json({ error: 'Error al registrar token de push' } satisfies ErrorResponse);
  }
});

export default router;
