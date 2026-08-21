import { Router, Request, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getPendingIncomingCall } from '../socket/signalingHandler';

const router = Router();

// GET /api/calls/pending - Obtener llamada entrante pendiente (para cold start desde notificación)
router.get('/pending', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const pending = getPendingIncomingCall(userId);
  if (!pending) {
    res.json({ hasPending: false });
    return;
  }
  res.json({
    hasPending: true,
    callerId: pending.callerId,
    callerUsername: pending.callerUsername,
    callType: pending.callType,
    offer: pending.offer,
  });
});

export default router;
