import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err.status && err.errors) {
    console.warn('[OpenAPI Validation]', JSON.stringify(err.errors));
    const strict = process.env.OPENAPI_STRICT !== 'false';
    if (strict) {
      res.status(err.status).json({ error: 'Validation error', detail: err.errors });
      return;
    }
    next();
    return;
  }
  console.error('Error:', err.message);
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}
