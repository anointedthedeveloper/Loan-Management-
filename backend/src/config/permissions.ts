/**
 * Central permission catalogue. Add a new entry here and it becomes assignable
 * to any staff member; backend routes guard themselves with requirePermission().
 */
export const PERMISSIONS = {
  'dashboard.view': 'View dashboard',
  'customers.view': 'View customers',
  'customers.create': 'Register customers',
  'customers.edit': 'Edit customers',
  'customers.delete': 'Delete customers',
  'loans.view': 'View loans',
  'loans.create': 'Create loans',
  'loans.edit': 'Edit loans',
  'loans.approve': 'Approve / reject loans',
  'repayments.view': 'View repayments',
  'repayments.record': 'Record repayments',
  'transactions.view': 'View transactions',
  'transactions.create': 'Record transactions',
  'transactions.reverse': 'Reverse transactions',
  'topups.view': 'View top-ups',
  'topups.request': 'Request top-ups',
  'topups.approve': 'Approve top-ups',
  'reports.view': 'View reports',
  'reports.export': 'Export reports',
  'products.manage': 'Manage loan products',
  'staff.manage': 'Manage staff and permissions',
  'audit.view': 'View audit logs',
  'settings.manage': 'Manage system settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES = ['ceo', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

/** Defaults granted when a user of a role is created. CEO may then tailor per user. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ceo: ALL_PERMISSIONS,
  accountant: [
    'dashboard.view',
    'customers.view',
    'customers.create',
    'loans.view',
    'repayments.view',
    'repayments.record',
    'transactions.view',
    'transactions.create',
    'topups.view',
    'topups.request',
    'reports.view',
  ],
};

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
