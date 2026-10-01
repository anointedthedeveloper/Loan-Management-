import { randomInt } from 'node:crypto';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { changedFields } from '../utils/diff.js';
import { AUDIT } from '../config/auditActions.js';
import { DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSIONS, type Role } from '../config/permissions.js';
import { hashPassword, publicUser } from './AuthService.js';
import { auditAs, listAudit } from './AuditService.js';
import type { Actor } from '../types/index.js';

type UserDocLike = InstanceType<typeof User>;
export const toPublic = (u: UserDocLike) => publicUser({ ...u.toObject(), role: u.role as Role });

async function find(id: string) {
  const u = /^[a-f\d]{24}$/i.test(id) ? await User.findById(id) : null;
  if (!u) throw AppError.notFound('Staff member not found', 'STAFF_NOT_FOUND');
  return u;
}

const otherActiveCeos = (id: unknown) => User.countDocuments({ role: 'ceo', isActive: true, _id: { $ne: id } });
const lastCeoError = (what: string) =>
  new AppError(409, `This is the last active CEO account, so it cannot be ${what}. Create or activate another CEO first.`, 'LAST_CEO');

export function generateTempPassword(): string {
  const pick = (chars: string, n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join('');
  const parts = pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 4) + pick('abcdefghijkmnpqrstuvwxyz', 5) + pick('23456789', 3);
  return [...parts].sort(() => randomInt(3) - 1).join('');
}

export async function listStaff() {
  return (await User.find().sort({ createdAt: -1 })).map(toPublic);
}
export async function getStaff(id: string) {
  return toPublic(await find(id));
}

export async function createStaff(input: any, actor: Actor) {
  const { password, permissions, ...rest } = input;
  if (await User.exists({ $or: [{ email: rest.email }, { username: rest.username }] })) {
    const emailTaken = await User.exists({ email: rest.email });
    throw new AppError(409, `That ${emailTaken ? 'email' : 'username'} is already in use`, 'STAFF_DUPLICATE', { [emailTaken ? 'email' : 'username']: 'Already in use' });
  }
  const role = rest.role as Role;
  const user = await User.create({
    ...rest, passwordHash: await hashPassword(password),
    permissions: role === 'ceo' ? ALL_PERMISSIONS : (permissions ?? DEFAULT_ROLE_PERMISSIONS[role]), createdBy: actor.id,
  });
  const out = toPublic(user);
  await auditAs(actor, { action: AUDIT.STAFF_CREATED, entity: 'User', entityId: out.id, entityLabel: out.username, after: out });
  return out;
}

export async function updateStaff(id: string, input: any, actor: Actor) {
  const user = await find(id);
  const isSelf = String(user._id) === actor.id;
  const before = toPublic(user);
  const targetIsCeo = user.role === 'ceo';

  if (isSelf && (input.isActive === false || (input.role && input.role !== user.role)))
    throw AppError.badRequest('You cannot deactivate or change the role of your own account', 'SELF_MODIFICATION');

  if (targetIsCeo && user.isActive) {
    const demoting = input.role && input.role !== 'ceo';
    if ((input.isActive === false || demoting) && (await otherActiveCeos(user._id)) === 0)
      throw lastCeoError(input.isActive === false ? 'deactivated' : 'moved to another role');
  }
  const newRole: Role = input.role ?? (user.role as Role);
  if (input.permissions && newRole === 'ceo' && ALL_PERMISSIONS.some((p) => !input.permissions.includes(p)))
    throw AppError.badRequest('CEO accounts always hold every permission, so they cannot be restricted.', 'CEO_PERMISSIONS_FIXED');
  if (input.email && input.email !== user.email && (await User.exists({ email: input.email, _id: { $ne: user._id } })))
    throw new AppError(409, 'That email is already in use', 'STAFF_DUPLICATE', { email: 'Already in use' });

  if (input.name !== undefined) user.name = input.name;
  if (input.email !== undefined) user.email = input.email;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  if (input.role !== undefined && input.role !== user.role) {
    user.role = input.role;
    user.permissions = newRole === 'ceo' ? ALL_PERMISSIONS : (input.permissions ?? DEFAULT_ROLE_PERMISSIONS[newRole]);
  } else if (input.permissions !== undefined) user.permissions = input.permissions;
  await user.save();
  const after = toPublic(user);

  const entity = { entity: 'User', entityId: after.id, entityLabel: after.username };
  const profile = changedFields(before, after, ['permissions', 'role', 'isActive', 'lastLoginAt']);
  if (profile.changed) await auditAs(actor, { ...entity, action: AUDIT.STAFF_UPDATED, before: profile.before, after: profile.after });
  if (before.isActive !== after.isActive)
    await auditAs(actor, { ...entity, action: after.isActive ? AUDIT.STAFF_ACTIVATED : AUDIT.STAFF_DEACTIVATED, before: { isActive: before.isActive }, after: { isActive: after.isActive } });
  if (before.role !== after.role) await auditAs(actor, { ...entity, action: AUDIT.STAFF_ROLE_CHANGED, before: { role: before.role }, after: { role: after.role } });
  const added = after.permissions.filter((p) => !before.permissions.includes(p));
  const removed = before.permissions.filter((p) => !after.permissions.includes(p));
  if (added.length || removed.length) await auditAs(actor, { ...entity, action: AUDIT.STAFF_PERMISSION_CHANGED, before: { removed }, after: { added } });
  return after;
}

/** Returns the temporary password exactly once (only when the server generated it). Never logged. */
export async function resetStaffPassword(id: string, password: string | undefined, actor: Actor) {
  const user = await find(id);
  const temp = password ? undefined : generateTempPassword();
  user.passwordHash = await hashPassword(password ?? temp!);
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await user.save();
  await auditAs(actor, { action: AUDIT.STAFF_PASSWORD_RESET, entity: 'User', entityId: String(user._id), entityLabel: user.username, after: { generated: !password } });
  return { temporaryPassword: temp ?? null };
}

export async function deleteStaff(id: string, actor: Actor) {
  const user = await find(id);
  if (String(user._id) === actor.id) throw AppError.badRequest('You cannot delete your own account', 'SELF_MODIFICATION');
  if (user.role === 'ceo' && user.isActive && (await otherActiveCeos(user._id)) === 0) throw lastCeoError('deleted');
  const before = toPublic(user);
  await user.deleteOne();
  await auditAs(actor, { action: AUDIT.STAFF_DELETED, entity: 'User', entityId: before.id, entityLabel: before.username, before });
}

/** Actions this person performed (e.g. logins) plus changes made to their account. */
export async function getStaffActivity(id: string, q: { page: number; limit: number }) {
  const user = await find(id);
  return listAudit({ $or: [{ user: user._id }, { entity: 'User', entityId: String(user._id) }] }, q);
}
