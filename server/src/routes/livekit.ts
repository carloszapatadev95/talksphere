import { Router, Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { authenticate, AuthRequest } from '../middleware/auth';
import type { components } from '../types/openapi';

type LiveKitTokenResponse = components['schemas']['LiveKitTokenResponse'];
type ErrorResponse = components['schemas']['Error'];

const router = Router();

router.post('/token', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { room } = req.body as components['schemas']['LiveKitTokenRequest'];
    if (!room || typeof room !== 'string') {
      res.status(400).json({ error: 'room es requerido' } satisfies ErrorResponse);
      return;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error('LIVEKIT_API_KEY o LIVEKIT_API_SECRET no configurados');
      res.status(500).json({ error: 'LiveKit no está configurado en el servidor' } satisfies ErrorResponse);
      return;
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(req.userId),
      name: req.username,
    });

    at.addGrant({ roomJoin: true, room });
    const token = await at.toJwt();

    res.json({ token, room, identity: String(req.userId) } satisfies LiveKitTokenResponse);
  } catch (err) {
    console.error('Error al generar token LiveKit:', err);
    res.status(500).json({ error: 'Error al generar token de LiveKit' } satisfies ErrorResponse);
  }
});

export default router;
