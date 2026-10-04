/**
 * Central permission catalogue, grouped by module. Add an entry here and it
 * automatically appears (grouped) in the staff permission UI and can be enforced
 * on the backend with requirePermission(). Nothing else needs editing.
 */
export const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', permissions: { 'dashboard.view': 'View dashboard' } },
  {
    key: 'customers', label: 'Customers',
    permissions: {
      'customers.read': 'View customers',
      'customers.create': 'Create customers',
      'customers.update': 'Edit customers',
      'customers.delete': 'Delete / archive customers',
      'customers.viewFinancials': 'View financial information',
    },
  },
  {
    key: 'loans', label: 'Loans',
    permissions: { 'loans.view': 'View loans', 'loans.create': 'Create loans', 'loans.edit': 'Edit loans', 'loans.editActive': 'Edit running loans (all details)', 'loans.approve': 'Approve / reject loans', 'products.manage': 'Manage loan products' },
  },
  { key: 'repayments', label: 'Repayments', permissions: { 'repayments.view': 'View repayments', 'repayments.record': 'Record repayments', 'repayments.edit': 'Edit recorded repayments' } },
  { key: 'transactions', label: 'Transactions', permissions: { 'transactions.view': 'View transactions', 'transactions.create': 'Record transactions', 'transactions.reverse': 'Reverse transactions' } },
  { key: 'topups', label: 'Top-ups', permissions: { 'topups.view': 'View top-ups', 'topups.request': 'Request top-ups', 'topups.approve': 'Approve top-ups' } },
  { key: 'reports', label: 'Reports', permissions: { 'reports.view': 'View reports', 'reports.export': 'Export reports' } },
  { key: 'staff', label: 'Staff', permissions: { 'staff.manage': 'Manage staff and permissions' } },
  { key: 'settings', label: 'Settings', permissions: { 'settings.manage': 'Manage system settings' } },
  { key: 'audit', label: 'Audit Logs', permissions: { 'audit.view': 'View audit logs' } },
] as const;

type Flatten<T> = T extends { permissions: infer P } ? keyof P : never;
export type Permission = Flatten<(typeof PERMISSION_MODULES)[number]> & string;

export const PERMISSIONS: Record<string, string> = Object.assign({}, ...PERMISSION_MODULES.map((m) => m.permissions));
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Shape served to the UI so it never hard-codes permission names or grouping. */
export const permissionGroups = () =>
  PERMISSION_MODULES.map((m) => ({
    key: m.key, label: m.label,
    permissions: Object.entries(m.permissions).map(([key, label]) => ({ key, label })),
  }));

/** Add a role here (plus a default permission set below) to introduce a new role. */
export const ROLES = ['ceo', 'accountant'] as const;
export const ROLE_LABELS: Record<(typeof ROLES)[number], string> = { ceo: 'CEO / Super Admin', accountant: 'Accountant' };
export type Role = (typeof ROLES)[number];

/** Defaults granted when a user of a role is created. CEO may then tailor per user. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ceo: ALL_PERMISSIONS,
  accountant: [
    'dashboard.view',
    'customers.read',
    'customers.create',
    'customers.viewFinancials',
    'loans.view',
    'loans.create',
    'repayments.view',
    'repayments.record',
    'transactions.view',
    'transactions.create',
    'topups.view',
    'topups.request',
    'reports.view',
    'reports.export',
  ],
};

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * One-time additions to the permissions of existing, non-CEO accounts when a new default is introduced
 * (the stored list otherwise never changes unless the CEO edits it). Bump `version` and add a row to introduce one.
 * Accounts created after a version already include it, so a CEO revoking it later is respected.
 */
export const PERMISSION_GRANTS: { version: number; role: Role; add: Permission[] }[] = [
  { version: 1, role: 'accountant', add: ['loans.view', 'loans.create'] }, // accountants create loans; the CEO approves them
];
export const CURRENT_GRANTS_VERSION = Math.max(...PERMISSION_GRANTS.map((g) => g.version));
