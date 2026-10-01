import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const ok = <T>(res: Response, data: T, message?: string, status = 200) =>
  res.status(status).json({ success: true, message, data });
