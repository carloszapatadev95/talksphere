import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate, AuthRequest } from '../middleware/auth';
import type { components, paths } from '../types/openapi';

type UploadResponse = paths['/api/upload']['post']['responses'][200]['content']['application/json'];
type ErrorResponse = components['schemas']['Error'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../public/uploads'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
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

router.post('/upload', authenticate, upload.single('image'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No se recibió ninguna imagen' } satisfies ErrorResponse);
    return;
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url } satisfies UploadResponse);
});

export default router;
