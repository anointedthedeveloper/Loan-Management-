import { AuditLog } from '../models/AuditLog.js';
import { type PageQuery, skipOf } from '../utils/pagination.js';
import type { Actor } from '../types/index.js';
import type { AuditAction } from '../config/auditActions.js';

export interface AuditEntry {
  userId?: string;
  userName?: string;
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
export const auditAs = (actor: Actor, entry: Omit<AuditEntry, 'userId' | 'userName' | 'ip'>) =>
  recordAudit({ ...entry, userId: actor.id, userName: actor.name, ip: actor.ip });

export async function listAudit(filter: Record<string, unknown>, q: PageQuery) {
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return {
    total,
    items: items.map((a) => ({
      id: String(a._id), action: a.action, userName: a.userName ?? null, entity: a.entity ?? null,
      entityId: a.entityId ?? null, entityLabel: a.entityLabel ?? null, before: a.before ?? null, after: a.after ?? null, createdAt: a.createdAt,
    })),
  };
}
