import type { NextFunction, Request, Response } from 'express';
import { effectivePermissions, verifyToken } from '../services/AuthService.js';
import { User } from '../models/User.js';
import type { Permission, Role } from '../config/permissions.js';
import { AppError } from '../utils/AppError.js';

export interface AuthUser { id: string; name: string; role: Role; permissions: Permission[] }

declare module 'express-serve-static-core' {
  interface Request { auth?: AuthUser; userDoc?: InstanceType<typeof User> }
}

/** Verifies JWT, then re-loads the user so deactivation / permission changes apply immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    let payload;
    try { payload = verifyToken(header.slice(7)); } catch { throw AppError.unauthorized('Session expired. Please sign in again.', 'TOKEN_INVALID'); }
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) throw AppError.unauthorized('Session is no longer valid', 'TOKEN_INVALID');
    // Tokens issued before a password change/reset are no longer valid.
    if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) throw AppError.unauthorized('Session expired. Please sign in again.', 'TOKEN_INVALID');
    const role = user.role as Role;
    req.userDoc = user;
    req.auth = { id: String(user._id), name: user.name, role, permissions: effectivePermissions(role, user.permissions) };
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(AppError.unauthorized());
  if (!roles.includes(req.auth.role)) return next(AppError.forbidden());
  next();
};

/** Passes if the user holds ANY of the listed permissions. */
export const requirePermission = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(AppError.unauthorized());
  if (!perms.some((p) => req.auth!.permissions.includes(p))) return next(AppError.forbidden());
  next();
};
