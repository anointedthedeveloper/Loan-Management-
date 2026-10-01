import { asyncHandler, ok } from '../utils/http.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSIONS, PERMISSIONS, type Role } from '../config/permissions.js';
import { hashPassword, publicUser } from '../services/AuthService.js';
import { recordAudit } from '../services/AuditService.js';

const toPublic = (u: InstanceType<typeof User>) => publicUser({ ...u.toObject(), role: u.role as Role });

export const list = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  ok(res, { users: users.map(toPublic) });
});

export const permissionCatalogue = asyncHandler(async (_req, res) => {
  ok(res, { permissions: ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSIONS[key] })), defaults: DEFAULT_ROLE_PERMISSIONS });
});

export const create = asyncHandler(async (req, res) => {
  const { password, permissions, ...rest } = req.body;
  const user = await User.create({
    ...rest,
    passwordHash: await hashPassword(password),
    permissions: permissions ?? DEFAULT_ROLE_PERMISSIONS[rest.role as Role],
    createdBy: req.auth!.id,
  });
  await recordAudit({ userId: req.auth!.id, userName: req.auth!.name, action: 'staff.created', entity: 'User', entityId: String(user._id), after: toPublic(user), ip: req.ip });
  ok(res, { user: toPublic(user) }, 'Staff account created', 201);
});

export const update = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('Staff member not found');
  const isSelf = String(user._id) === req.auth!.id;
  if (isSelf && (req.body.isActive === false || (req.body.role && req.body.role !== user.role)))
    throw AppError.badRequest('You cannot deactivate or change the role of your own account', 'SELF_MODIFICATION');
  const before = toPublic(user);
  const { password, ...fields } = req.body;
  Object.assign(user, fields);
  if (password) { user.passwordHash = await hashPassword(password); user.passwordChangedAt = new Date(); }
  await user.save();
  const permissionsChanged = JSON.stringify(before.permissions) !== JSON.stringify(toPublic(user).permissions);
  await recordAudit({
    userId: req.auth!.id, userName: req.auth!.name,
    action: permissionsChanged ? 'staff.permissions_changed' : 'staff.updated',
    entity: 'User', entityId: String(user._id), before, after: toPublic(user), ip: req.ip,
  });
  ok(res, { user: toPublic(user) }, 'Staff account updated');
});

export const remove = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound('Staff member not found');
  if (String(user._id) === req.auth!.id) throw AppError.badRequest('You cannot delete your own account', 'SELF_MODIFICATION');
  await user.deleteOne();
  await recordAudit({ userId: req.auth!.id, userName: req.auth!.name, action: 'staff.deleted', entity: 'User', entityId: String(user._id), before: toPublic(user), ip: req.ip });
  ok(res, null, 'Staff account deleted');
});
