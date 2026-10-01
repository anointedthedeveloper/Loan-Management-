import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[i.path.join('.') || '_'] ??= i.message;
  return AppError.badRequest('Please check the highlighted fields', 'VALIDATION_ERROR', fields);
}

export const validateBody = <T>(schema: ZodType<T>) => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return next(fieldErrors(r.error.issues));
  req.body = r.data;
  next();
};

/** Express 5 makes req.query read-only, so parsed values are exposed on res.locals.query. */
export const validateQuery = <T>(schema: ZodType<T>) => (req: Request, res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.query);
  if (!r.success) return next(fieldErrors(r.error.issues));
  res.locals.query = r.data;
  next();
};
