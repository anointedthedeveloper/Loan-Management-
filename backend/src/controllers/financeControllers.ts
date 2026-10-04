import type { Request } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import { sendPage } from '../utils/pagination.js';
import { actorOf } from './customerController.js';
import * as products from '../services/product.service.js';
import * as loans from '../services/loan.service.js';
import * as repayments from '../services/repayment.service.js';
import * as settlement from '../services/settlement.service.js';
import * as tx from '../services/transaction.service.js';
import * as topups from '../services/topup.service.js';
import * as settings from '../services/settings.service.js';
import * as reports from '../services/report.service.js';
import * as exporter from '../services/export.service.js';
import * as statements from '../services/statement.service.js';
import * as statementExport from '../services/statementExport.service.js';
import { AUDIT } from '../config/auditActions.js';
import { auditAs, auditFilter, listAudit, recordAudit } from '../services/AuditService.js';
import { AuditLog } from '../models/AuditLog.js';
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
export const loanUpdate = asyncHandler(async (req, res) => ok(res, await loans.updateLoan(id(req), req.body, actorOf(req), req.auth!.permissions.includes('loans.editActive')), 'Loan updated'));
export const loanApprove = asyncHandler(async (req, res) => ok(res, await loans.approveLoan(id(req), actorOf(req)), 'Loan approved'));
export const loanDisburse = asyncHandler(async (req, res) => ok(res, await loans.disburseLoan(id(req), actorOf(req)), 'Loan disbursed'));
export const loanReject = asyncHandler(async (req, res) => ok(res, await loans.rejectLoan(id(req), req.body.reason, actorOf(req)), 'Loan rejected'));
export const loanCancel = asyncHandler(async (req, res) => ok(res, await loans.cancelLoan(id(req), req.body.reason, actorOf(req)), 'Loan cancelled'));
export const loanDefault = asyncHandler(async (req, res) => ok(res, await loans.markLoanDefaulted(id(req), req.body.reason, actorOf(req)), 'Loan marked as defaulted'));
export const loanTransactions = asyncHandler(async (req, res) => { const f = { page: 1, limit: 100, sort: 'date', order: 'desc', loan: id(req) }; const r = await tx.listTransactions(f); sendPage(res, r.items, f, r.total); });
export const loanRecalculate = asyncHandler(async (req, res) => { const l = await Loan.findById(id(req)); if (!l) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND'); await recalculateLoan(l._id); ok(res, await loans.getLoan(id(req)), 'Balances recalculated from the ledger'); });

/* mark a month paid / settle early */
export const installmentPay = asyncHandler(async (req, res) => ok(res, await repayments.markInstallmentPaid(id(req), Number(req.params.number), req.body, actorOf(req)), `Installment ${req.params.number} marked as paid`, 201));
export const settlementQuote = asyncHandler(async (req, res) => ok(res, { quote: await settlement.quoteSettlement(id(req), res.locals.query.date) }));
export const loanSettle = asyncHandler(async (req, res) => ok(res, await settlement.settleLoan(id(req), req.body, actorOf(req), req.auth!.permissions.includes('loans.approve')), 'Loan settled'));

/* repayments & transactions */
export const repaymentList = asyncHandler(async (_req, res) => { const f = q(res); const r = await repayments.listRepayments(f); sendPage(res, r.items, f, r.total); });
export const repaymentCreate = asyncHandler(async (req, res) => ok(res, await repayments.recordRepayment(req.body, actorOf(req)), 'Repayment recorded', 201));
export const repaymentEdit = asyncHandler(async (req, res) => ok(res, await repayments.editRepayment(id(req), req.body, actorOf(req)), 'Repayment updated'));
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

/* statements */
async function sendStatement(req: Request, res: any, s: Awaited<ReturnType<typeof statements.buildLoanStatement>>, entity: string, entityId: string, label: string) {
  const f = res.locals.query;
  await auditAs(actorOf(req), { action: A.STATEMENT_GENERATED, entity, entityId, entityLabel: label, after: { format: f.format, from: f.from ?? null, to: f.to ?? null } });
  if (f.format === 'json') return ok(res, { statement: s });
  const base = `protech-statement-${s.client.customerId}-${new Date().toISOString().slice(0, 10)}`;
  if (f.format === 'csv') return void res.type('text/csv').attachment(`${base}.csv`).send(statementExport.statementToCsv(s));
  if (f.format === 'xlsx') return void res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${base}.xlsx`).send(await statementExport.statementToXlsx(s, req.auth!.name));
  res.type('application/pdf').attachment(`${base}.pdf`).send(await statementExport.statementToPdf(s, req.auth!.name));
}
export const loanStatement = asyncHandler(async (req, res) => { const s = await statements.buildLoanStatement(id(req), res.locals.query); await sendStatement(req, res, s, 'Loan', id(req), s.loans[0]!.loan.loanId); });
export const loanScheduleExport = asyncHandler(async (req, res) => {
  const f = res.locals.query; const s = await statements.buildLoanStatement(id(req), {});
  const ref = s.loans[0]!.loan.loanId;
  await auditAs(actorOf(req), { action: A.STATEMENT_GENERATED, entity: 'Loan', entityId: id(req), entityLabel: ref, after: { document: 'repayment schedule', format: f.format } });
  const base = `protech-schedule-${ref}`;
  if (f.format === 'csv') return void res.type('text/csv').attachment(`${base}.csv`).send(statementExport.scheduleToCsv(s));
  if (f.format === 'xlsx') return void res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${base}.xlsx`).send(await statementExport.scheduleToXlsx(s, req.auth!.name));
  res.type('application/pdf').attachment(`${base}.pdf`).send(await statementExport.scheduleToPdf(s, req.auth!.name));
});
export const clientStatement = asyncHandler(async (req, res) => { const s = await statements.buildClientStatement(id(req), res.locals.query); await sendStatement(req, res, s, 'Customer', id(req), s.client.customerId); });

/* page-view tracking (who looked at what, when) */
export const pageView = asyncHandler(async (req, res) => {
  const a = req.auth!;
  const recent = await AuditLog.findOne({ user: a.id, action: A.PAGE_VIEW, entityLabel: req.body.path, createdAt: { $gt: new Date(Date.now() - 20_000) } }).select('_id'); // ignore rapid repeats
  if (!recent) await recordAudit({ userId: a.id, userName: a.name, userRole: a.role, action: A.PAGE_VIEW, entity: 'Page', entityLabel: req.body.path, after: req.body.title ? { page: req.body.title } : undefined, ip: req.ip });
  res.status(204).end();
});

/* reports */
export const reportCatalog = asyncHandler(async (_req, res) => ok(res, { reports: reports.reportCatalog() }));
export const reportRun = asyncHandler(async (req, res) => {
  const f = q(res);
  const result = await reports.runReport(String(req.params.type), f);
  if (f.format === 'json') return ok(res, { ...result, rows: result.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')))) });
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
export const auditExport = asyncHandler(async (req, res) => {
  const f = q(res);
  const r = await listAudit(auditFilter(f), { page: 1, limit: 5000 });
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = ['Time,Person,Role,Action,Record type,Record,Before,After,IP'];
  for (const a of r.items) lines.push([new Date(a.createdAt).toISOString(), a.userName, a.userRole, a.action, a.entity, a.entityLabel ?? a.entityId, a.before ? JSON.stringify(a.before) : '', a.after ? JSON.stringify(a.after) : '', a.ip].map(esc).join(','));
  await auditAs(actorOf(req), { action: A.REPORT_EXPORTED, entity: 'Report', entityLabel: 'Audit log', after: { rows: r.items.length } });
  res.type('text/csv').attachment(`protech-audit-log-${new Date().toISOString().slice(0, 10)}.csv`).send('\ufeff' + lines.join('\r\n'));
});
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
