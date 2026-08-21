import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate, AuthRequest } from '../middleware/auth';
import pool from '../db/connection';
import type { components, paths } from '../types/openapi';

type AvatarResponse = paths['/api/users/avatar']['post']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../public/avatars'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagen no soportado. Usa JPG, PNG, GIF o WebP.'));
    }
  },
});

const router = Router();

router.post('/users/avatar', authenticate, upload.single('avatar'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No se recibió ninguna imagen' } satisfies ErrorResponse);
      return;
    }
    const url = `/avatars/${req.file.filename}`;
    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, req.userId]);
    res.json({ url } satisfies AvatarResponse);
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Error al subir avatar' } satisfies ErrorResponse);
  }
});

export default router;
