import { Customer } from '../models/Customer.js';
import { User } from '../models/User.js';
import { CUSTOMER_STATUSES } from '../config/customerOptions.js';
import { listAudit } from './AuditService.js';
import type { Permission } from '../config/permissions.js';

/** Only real, database-derived values. Financial metrics are added by Phase 7 services. */
export async function getOverview(permissions: Permission[]) {
  const has = (p: Permission) => permissions.includes(p);
  const out: Record<string, unknown> = {};
  if (has('customers.read')) {
    const rows = await Customer.aggregate([{ $match: { isArchived: false } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    out.customers = {
      total: rows.reduce((s, r) => s + r.count, 0),
      byStatus: CUSTOMER_STATUSES.map((s) => ({ value: s.value, label: s.label, tone: s.tone, count: counts[s.value] ?? 0 })),
    };
  }
  if (has('staff.manage')) out.staff = { total: await User.countDocuments(), active: await User.countDocuments({ isActive: true }) };
  if (has('audit.view')) out.recentActivity = (await listAudit({}, { page: 1, limit: 8 })).items;
  return out;
}
