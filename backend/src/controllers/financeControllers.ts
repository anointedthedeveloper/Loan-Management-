import type { Request } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import { sendPage } from '../utils/pagination.js';
import { actorOf } from './customerController.js';
import * as products from '../services/product.service.js';
import * as loans from '../services/loan.service.js';
import * as repayments from '../services/repayment.service.js';
import * as tx from '../services/transaction.service.js';
import * as topups from '../services/topup.service.js';
import * as settings from '../services/settings.service.js';
import * as reports from '../services/report.service.js';
import * as exporter from '../services/export.service.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs, auditFilter, listAudit } from '../services/AuditService.js';
import { recalculateLoan, refreshLiveLoans } from '../services/loanLedger.service.js';
import { Loan } from '../models/Loan.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { DURATION_UNITS, FREQUENCIES, LOAN_STATUSES, PAYMENT_METHODS, RATE_BASES, TRANSACTION_TYPES } from '../config/loanOptions.js';
import { AUDIT as A } from '../config/auditActions.js';

const id = (r: Request) => String(r.params.id);
const q = (r: { locals: { query?: any } }) => r.locals.query;

/* meta */
export const loanMeta = asyncHandler(async (_req, res) => ok(res, { statuses: LOAN_STATUSES, frequencies: FREQUENCIES, durationUnits: DURATION_UNITS, rateBases: RATE_BASES, paymentMethods: PAYMENT_METHODS, transactionTypes: TRANSACTION_TYPES }));

/* products */
export const productList = asyncHandler(async (req, res) => ok(res, { products: await products.listProducts({ activeOnly: !req.auth!.permissions.includes('products.manage') }) }));
export const productCreate = asyncHandler(async (req, res) => ok(res, { product: await products.createProduct(req.body, actorOf(req)) }, 'Loan product created', 201));
export const productUpdate = asyncHandler(async (req, res) => ok(res, { product: await products.updateProduct(id(req), req.body, actorOf(req)) }, 'Loan product updated'));
export const productDelete = asyncHandler(async (req, res) => { await products.deleteProduct(id(req), actorOf(req)); ok(res, null, 'Loan product deleted'); });

/* loans */
export const loanList = asyncHandler(async (_req, res) => { const f = q(res); const r = await loans.listLoans(f); sendPage(res, r.items, f, r.total); });
export const loanPreview = asyncHandler(async (req, res) => ok(res, await loans.previewLoan(req.body)));
export const loanCreate = asyncHandler(async (req, res) => {
  const autoApprove = req.auth!.permissions.includes('loans.approve'); // approvers (CEO) skip the approval step
  ok(res, await loans.createLoan(req.body, actorOf(req), { autoApprove }), autoApprove ? 'Loan created and approved' : 'Loan submitted for approval', 201);
});
export const loanGet = asyncHandler(async (req, res) => ok(res, await loans.getLoan(id(req))));
export const loanUpdate = asyncHandler(async (req, res) => ok(res, await loans.updateLoan(id(req), req.body, actorOf(req)), 'Loan updated'));
export const loanApprove = asyncHandler(async (req, res) => ok(res, await loans.approveLoan(id(req), actorOf(req)), 'Loan approved'));
export const loanDisburse = asyncHandler(async (req, res) => ok(res, await loans.disburseLoan(id(req), actorOf(req)), 'Loan disbursed'));
export const loanReject = asyncHandler(async (req, res) => ok(res, await loans.rejectLoan(id(req), req.body.reason, actorOf(req)), 'Loan rejected'));
export const loanCancel = asyncHandler(async (req, res) => ok(res, await loans.cancelLoan(id(req), req.body.reason, actorOf(req)), 'Loan cancelled'));
export const loanDefault = asyncHandler(async (req, res) => ok(res, await loans.markLoanDefaulted(id(req), req.body.reason, actorOf(req)), 'Loan marked as defaulted'));
export const loanTransactions = asyncHandler(async (req, res) => { const f = { page: 1, limit: 100, sort: 'date', order: 'desc', loan: id(req) }; const r = await tx.listTransactions(f); sendPage(res, r.items, f, r.total); });
export const loanRecalculate = asyncHandler(async (req, res) => { const l = await Loan.findById(id(req)); if (!l) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND'); await recalculateLoan(l._id); ok(res, await loans.getLoan(id(req)), 'Balances recalculated from the ledger'); });

/* repayments & transactions */
export const repaymentList = asyncHandler(async (_req, res) => { const f = q(res); const r = await repayments.listRepayments(f); sendPage(res, r.items, f, r.total); });
export const repaymentCreate = asyncHandler(async (req, res) => ok(res, await repayments.recordRepayment(req.body, actorOf(req)), 'Repayment recorded', 201));
export const txList = asyncHandler(async (_req, res) => { const f = q(res); const r = await tx.listTransactions(f); sendPage(res, r.items, f, r.total); });
export const txGet = asyncHandler(async (req, res) => ok(res, { transaction: await tx.getTransaction(id(req)) }));
export const txCreate = asyncHandler(async (req, res) => ok(res, { transaction: await tx.createManualTransaction(req.body, actorOf(req)) }, 'Transaction recorded', 201));
export const txReverse = asyncHandler(async (req, res) => ok(res, { transaction: await tx.reverseTransaction(id(req), req.body.reason, actorOf(req)) }, 'Transaction reversed'));

/* top-ups */
export const topupList = asyncHandler(async (_req, res) => { const f = q(res); const r = await topups.listTopUps(f); sendPage(res, r.items, f, r.total); });
export const topupPreview = asyncHandler(async (req, res) => ok(res, { calculation: await topups.previewTopUp(req.body) }));
export const topupRequest = asyncHandler(async (req, res) => {
  const autoApprove = req.auth!.permissions.includes('topups.approve');
  ok(res, { topUp: await topups.requestTopUp(req.body, actorOf(req), { autoApprove }) }, autoApprove ? 'Top-up created and approved' : 'Top-up submitted for approval', 201);
});
export const topupGet = asyncHandler(async (req, res) => ok(res, { topUp: await topups.getTopUp(id(req)) }));
export const topupApprove = asyncHandler(async (req, res) => ok(res, { topUp: await topups.approveTopUp(id(req), actorOf(req)) }, 'Top-up approved'));
export const topupReject = asyncHandler(async (req, res) => ok(res, { topUp: await topups.rejectTopUp(id(req), req.body.reason, actorOf(req)) }, 'Top-up rejected'));
export const topupCancel = asyncHandler(async (req, res) => ok(res, { topUp: await topups.cancelTopUp(id(req), req.body.reason, actorOf(req)) }, 'Top-up cancelled'));

/* reports */
export const reportCatalog = asyncHandler(async (_req, res) => ok(res, { reports: reports.reportCatalog() }));
export const reportRun = asyncHandler(async (req, res) => {
  const f = q(res);
  const result = await reports.runReport(String(req.params.type), f);
  if (f.format === 'json') return ok(res, result);
  if (!req.auth!.permissions.includes('reports.export')) throw AppError.forbidden('You do not have permission to export reports');
  const company = (await settings.getSection('company')).name;
  const base = `protech-${result.key}-${new Date().toISOString().slice(0, 10)}`;
  await auditAs(actorOf(req), { action: A.REPORT_EXPORTED, entity: 'Report', entityId: result.key, entityLabel: result.title, after: { format: f.format, rows: result.rows.length } });
  if (f.format === 'csv') { res.type('text/csv').attachment(`${base}.csv`).send(exporter.toCsv(result)); return; }
  if (f.format === 'xlsx') { res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${base}.xlsx`).send(await exporter.toXlsx(result, company)); return; }
  res.type('application/pdf').attachment(`${base}.pdf`).send(await exporter.toPdf(result, company));
});

/* settings */
export const settingsGet = asyncHandler(async (_req, res) => ok(res, { settings: await settings.getSettings() }));
export const settingsPublic = asyncHandler(async (_req, res) => ok(res, await settings.getPublicSettings()));
export const settingsUpdate = asyncHandler(async (req, res) => ok(res, { [String(req.params.section)]: await settings.updateSection(String(req.params.section), req.body, actorOf(req)) }, 'Settings saved'));

/* audit */
export const auditList = asyncHandler(async (_req, res) => { const f = q(res); const r = await listAudit(auditFilter(f), f); sendPage(res, r.items, f, r.total); });
export const auditMeta = asyncHandler(async (_req, res) => ok(res, { actions: Object.values(AUDIT), users: (await User.find().select('name').sort({ name: 1 })).map((u) => ({ id: String(u._id), name: u.name })) }));

/* first-run */
export const bootstrapCeo = asyncHandler(async (req, res) => {
  if (await User.exists({})) throw AppError.conflict('This system already has users, so bootstrap is disabled.', 'ALREADY_INITIALISED');
  const { hashPassword, publicUser } = await import('../services/AuthService.js');
  const { ALL_PERMISSIONS } = await import('../config/permissions.js');
  const user = await User.create({ ...req.body, passwordHash: await hashPassword(req.body.password), role: 'ceo', permissions: ALL_PERMISSIONS });
  const { recordAudit } = await import('../services/AuditService.js');
  await recordAudit({ userName: 'Bootstrap', action: A.STAFF_CREATED, entity: 'User', entityId: String(user._id), entityLabel: user.username, after: { role: 'ceo', via: 'bootstrap' }, ip: req.ip });
  ok(res, { user: publicUser({ ...user.toObject(), role: 'ceo' }) }, 'First CEO created', 201);
});

/* automation */
export const refreshOverdue = asyncHandler(async (_req, res) => ok(res, await refreshLiveLoans(), 'Loans refreshed'));
