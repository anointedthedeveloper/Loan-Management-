import { asyncHandler, ok } from '../utils/http.js';
import * as AuthService from '../services/AuthService.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from '../services/AuditService.js';
import bcrypt from 'bcryptjs';

export const login = asyncHandler(async (req, res) => {
  const { identifier, password, remember } = req.body;
  ok(res, await AuthService.login(identifier, password, remember, req.ip), 'Signed in');
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth!.id);
  if (!user) throw AppError.unauthorized();
  ok(res, { user: AuthService.publicUser({ ...user.toObject(), role: user.role as 'ceo' | 'accountant' }) });
});

export const logout = asyncHandler(async (req, res) => {
  await recordAudit({ userId: req.auth!.id, userName: req.auth!.name, action: 'auth.logout', entity: 'User', entityId: req.auth!.id, ip: req.ip });
  ok(res, null, 'Signed out');
});

// No email provider is configured yet; respond identically whether or not the account exists
// so the endpoint cannot be used to enumerate users. Wire a mailer into this handler later.
export const forgotPassword = asyncHandler(async (req, res) => {
  await recordAudit({ action: 'auth.password_reset_requested', entity: 'User', entityId: String(req.body.identifier).toLowerCase(), ip: req.ip });
  ok(res, null, 'If an account matches, password reset instructions will be sent. Please also contact the CEO to reset your password.');
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth!.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash)))
    throw AppError.badRequest('Current password is incorrect', 'INVALID_CREDENTIALS');
  user.passwordHash = await AuthService.hashPassword(req.body.newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await recordAudit({ userId: req.auth!.id, userName: req.auth!.name, action: 'auth.password_changed', entity: 'User', entityId: req.auth!.id, ip: req.ip });
  ok(res, null, 'Password updated');
});
