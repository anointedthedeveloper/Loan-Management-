import { AuditLog } from '../models/AuditLog.js';

export interface AuditEntry {
  userId?: string;
  userName?: string;
  action: string;
  entity?: string;
  entityId?: string;
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
