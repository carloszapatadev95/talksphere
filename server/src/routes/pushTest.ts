import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getUserPushTokens, sendPush } from '../services/pushService';
import { Expo } from 'expo-server-sdk';

const router = Router();

router.get('/users/push-tokens', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await getUserPushTokens(req.userId!);
    res.json({
      userId: req.userId,
      count: tokens.length,
      tokens: tokens.map(t => ({
        ...t,
        token: t.token.substring(0, 30) + '...',
        isValid: Expo.isExpoPushToken(t.token),
      })),
    });
  } catch {
    res.status(500).json({ error: 'Error al obtener tokens' });
  }
});

router.post('/push/test', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, title, body } = req.body;
    const targetUserId = userId || req.userId;
    const pushTitle = title || '🔔 Test Push Notification';
    const pushBody = body || 'Esto es una prueba de push desde el servidor';

    const tokens = await getUserPushTokens(targetUserId);
    if (tokens.length === 0) {
      res.status(404).json({
        error: 'No hay tokens push registrados para este usuario',
        userId: targetUserId,
        hint: 'Asegúrate de que la app se ejecute en un dispositivo físico (no simulador)',
      });
      return;
    }

    const result = await sendPush(
      targetUserId,
      pushTitle,
      pushBody,
      { test: true, timestamp: new Date().toISOString() }
    );

    const isValid = tokens.every(t => Expo.isExpoPushToken(t.token));

    res.json({
      targetUserId,
      tokensFound: tokens.length,
      tokensAreValid: isValid,
      ...result,
      hint: isValid
        ? 'Tokens válidos. Si no llega, verifica firebase/google-services.json en Android o capabilities en iOS.'
        : 'Algunos tokens no tienen formato Expo. Verifica que registerForPushNotifications devuelva un ExpoPushToken.',
    });
  } catch (err) {
    console.error('[PushTest] Error:', err);
    res.status(500).json({ error: 'Error al enviar push de prueba' });
  }
});

export default router;