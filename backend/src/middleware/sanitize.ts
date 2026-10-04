import type { NextFunction, Request, Response } from 'express';

/** Removes MongoDB operator keys ("$where", "$ne"...) from request bodies so user input can never become a query operator. */
function strip(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return v; // raw file uploads
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!k.startsWith('$') && !k.includes('.')) out[k] = strip(val);
    return out;
  }
  return v;
}
export function sanitize(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = strip(req.body);
  next();
}
