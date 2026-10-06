/**
 * Single place the UI refers to permission keys. Keys mirror the backend catalogue
 * (backend/src/config/permissions.ts); the grouped list shown in the permission editor
 * comes from the API, so new permissions need no UI changes unless a screen uses them.
 * These checks only shape the interface — the backend enforces every one.
 */
export const PERM = {
  dashboard: { view: 'dashboard.view' },
  customers: { read: 'customers.read', create: 'customers.create', update: 'customers.update', delete: 'customers.delete', import: 'customers.import', viewFinancials: 'customers.viewFinancials' },
  staff: { manage: 'staff.manage' },
  audit: { view: 'audit.view' },
  settings: { manage: 'settings.manage' },
  reports: { view: 'reports.view', export: 'reports.export' },
  loans: { view: 'loans.view', create: 'loans.create', edit: 'loans.edit', editActive: 'loans.editActive', approve: 'loans.approve' },
  products: { manage: 'products.manage' },
  repayments: { view: 'repayments.view', record: 'repayments.record', edit: 'repayments.edit' },
  transactions: { view: 'transactions.view', create: 'transactions.create', reverse: 'transactions.reverse' },
  approvals: { decide: 'approvals.decide' },
  topups: { view: 'topups.view', request: 'topups.request', approve: 'topups.approve' },
} as const
