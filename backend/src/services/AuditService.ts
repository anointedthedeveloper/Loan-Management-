import { AuditLog } from '../models/AuditLog.js';
import { type PageQuery, skipOf } from '../utils/pagination.js';
import type { Actor } from '../types/index.js';
import type { AuditAction } from '../config/auditActions.js';

export interface AuditEntry {
  userId?: string;
  userName?: string;
  userRole?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  entityLabel?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Audit failures must never break the business operation that triggered them. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({ ...entry, user: entry.userId });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

/** Convenience wrapper so services only supply the actor + what happened. */
export const auditAs = (actor: Actor, entry: Omit<AuditEntry, 'userId' | 'userName' | 'userRole' | 'ip'>) =>
  recordAudit({ ...entry, userId: actor.id, userName: actor.name, userRole: actor.role, ip: actor.ip });

export async function listAudit(filter: Record<string, unknown>, q: PageQuery) {
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return {
    total,
    items: items.map((a) => ({
      id: String(a._id), action: a.action, userName: a.userName ?? null, userRole: a.userRole ?? null, ip: a.ip ?? null, entity: a.entity ?? null,
      entityId: a.entityId ?? null, entityLabel: a.entityLabel ?? null, before: a.before ?? null, after: a.after ?? null, createdAt: a.createdAt,
    })),
  };
}

/** Filter builder for the audit-log screen (CEO). */
export const AUTH_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED'];
export function auditFilter(q: { q?: string; action?: string[]; entity?: string; user?: string; role?: string; category?: 'navigation' | 'auth' | 'changes'; from?: Date; to?: Date }) {
  const f: Record<string, any> = {};
  if (q.action?.length) f.action = { $in: q.action };
  // navigation = pages visited, auth = sign-ins/outs, changes = everything people actually did to records
  if (q.category === 'navigation' && !q.action?.length) f.action = 'PAGE_VIEW';
  if (q.category === 'auth' && !q.action?.length) f.action = { $in: AUTH_ACTIONS };
  if (q.category === 'changes' && !q.action?.length) f.action = { $nin: ['PAGE_VIEW', ...AUTH_ACTIONS] };
  if (q.role) f.userRole = q.role;
  if (q.entity) f.entity = q.entity;
  if (q.user) f.user = q.user;
  if (q.from || q.to) f.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lt: new Date(q.to.getTime() + 86_400_000) }) };
  if (q.q) { const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ entityLabel: re }, { userName: re }, { entityId: re }]; }
  return f;
}
