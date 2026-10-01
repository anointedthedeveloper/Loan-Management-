/**
 * Single place the UI refers to permission keys. Keys mirror the backend catalogue
 * (backend/src/config/permissions.ts); the grouped list shown in the permission editor
 * comes from the API, so new permissions need no UI changes unless a screen uses them.
 * These checks only shape the interface — the backend enforces every one.
 */
export const PERM = {
  dashboard: { view: 'dashboard.view' },
  customers: { read: 'customers.read', create: 'customers.create', update: 'customers.update', delete: 'customers.delete', viewFinancials: 'customers.viewFinancials' },
  staff: { manage: 'staff.manage' },
  audit: { view: 'audit.view' },
  settings: { manage: 'settings.manage' },
  reports: { view: 'reports.view' },
  loans: { view: 'loans.view' },
  repayments: { view: 'repayments.view' },
  transactions: { view: 'transactions.view' },
  topups: { view: 'topups.view' },
} as const
