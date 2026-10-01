import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from '../config/permissions.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from './AuditService.js';
import { AUDIT } from '../config/auditActions.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Used to keep response time constant when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export interface TokenPayload { sub: string; role: Role; iat: number }

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);

export function signToken(userId: string, role: Role, remember: boolean): string {
  const expiresIn = (remember ? env.JWT_REMEMBER_EXPIRES_IN : env.JWT_EXPIRES_IN) as SignOptions['expiresIn'];
  return jwt.sign({ role }, env.JWT_SECRET, { subject: userId, expiresIn });
}

export function verifyToken(token: string): TokenPayload {
  const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return { sub: String(p.sub), role: p.role as Role, iat: p.iat ?? 0 };
}

/** Effective permissions: CEO always has everything; others use their stored list. */
export function effectivePermissions(role: Role, stored: string[]): Permission[] {
  if (role === 'ceo') return ALL_PERMISSIONS;
  return (stored.length ? stored : DEFAULT_ROLE_PERMISSIONS[role]).filter((p): p is Permission =>
    (ALL_PERMISSIONS as string[]).includes(p),
  );
}

export const publicUser = (u: {
  _id: unknown; name: string; email: string; username: string; role: Role; permissions: string[]; isActive: boolean; lastLoginAt?: Date | null;
}) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  username: u.username,
  role: u.role,
  permissions: effectivePermissions(u.role, u.permissions),
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt ?? null,
});

export async function login(identifier: string, password: string, remember: boolean, ip?: string) {
  const id = identifier.trim().toLowerCase();
  const user = await User.findOne({ $or: [{ email: id }, { username: id }] }).select('+passwordHash');
  const invalid = () => AppError.unauthorized('Incorrect email/username or password', 'INVALID_CREDENTIALS');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'Too many failed attempts. Try again in a few minutes.', 'ACCOUNT_LOCKED');
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    await recordAudit({ userId: String(user._id), userName: user.name, action: AUDIT.LOGIN_FAILED, entity: 'User', entityId: String(user._id), ip });
    throw invalid();
  }
  if (!user.isActive) throw AppError.forbidden('This account has been deactivated. Contact the CEO.', 'ACCOUNT_DISABLED');

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({ userId: String(user._id), userName: user.name, action: AUDIT.LOGIN, entity: 'User', entityId: String(user._id), ip });

  const role = user.role as Role;
  return { token: signToken(String(user._id), role, remember), user: publicUser({ ...user.toObject(), role }) };
}
