import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

export const validateBody = <T>(schema: ZodType<T>) => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return next(AppError.badRequest('Please check the highlighted fields', 'VALIDATION_ERROR', fields));
  }
  req.body = r.data;
  next();
};
