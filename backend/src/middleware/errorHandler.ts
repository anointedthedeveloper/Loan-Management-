import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(AppError.notFound('The requested endpoint does not exist', 'ROUTE_NOT_FOUND'));

// Express identifies error middleware by its 4-argument signature.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message, code: err.code, errors: err.details });
  }
  const e = err as { code?: number; type?: string; name?: string };
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Malformed request body', code: 'BAD_JSON' });
  if (e?.code === 11000) return res.status(409).json({ success: false, message: 'A record with these details already exists', code: 'DUPLICATE' });
  if (e?.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid identifier supplied', code: 'BAD_ID' });
  if (env.NODE_ENV !== 'test' || process.env.DEBUG_ERRORS) console.error(err);
  res.status(500).json({ success: false, message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL_ERROR' });
}
