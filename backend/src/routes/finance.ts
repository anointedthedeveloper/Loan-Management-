import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import * as v from '../validators/finance.js';
import { settingsSchemas } from '../validators/settings.js';
import { createUserSchema } from '../validators/users.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import * as c from '../controllers/financeControllers.js';

const body = validateBody, query = validateQuery, perm = requirePermission;
const mk = () => Router();

export const productsRouter = mk();
productsRouter.use(authenticate);
productsRouter.get('/', perm('products.manage', 'loans.view', 'loans.create', 'topups.request'), c.productList);
productsRouter.post('/', perm('products.manage'), body(v.createProductSchema), c.productCreate);
productsRouter.patch('/:id', perm('products.manage'), body(v.updateProductSchema), c.productUpdate);
productsRouter.delete('/:id', perm('products.manage'), c.productDelete);

export const loansRouter = mk();
loansRouter.use(authenticate);
loansRouter.get('/meta', perm('loans.view', 'loans.create', 'repayments.view', 'transactions.view', 'topups.view', 'reports.view', 'products.manage'), c.loanMeta);
loansRouter.get('/', perm('loans.view'), query(v.listLoansSchema), c.loanList);
loansRouter.post('/preview', perm('loans.create', 'loans.edit'), body(v.previewLoanSchema), c.loanPreview);
loansRouter.post('/', perm('loans.create'), body(v.createLoanSchema), c.loanCreate);
loansRouter.get('/:id', perm('loans.view'), c.loanGet);
loansRouter.patch('/:id', perm('loans.edit'), body(v.updateLoanSchema), c.loanUpdate);
loansRouter.post('/:id/approve', perm('loans.approve'), c.loanApprove);
loansRouter.post('/:id/disburse', perm('loans.approve'), c.loanDisburse);
loansRouter.post('/:id/reject', perm('loans.approve'), body(v.reasonSchema), c.loanReject);
loansRouter.post('/:id/cancel', perm('loans.edit', 'loans.approve'), body(v.reasonSchema), c.loanCancel);
loansRouter.post('/:id/default', perm('loans.approve'), body(v.reasonSchema), c.loanDefault);
loansRouter.post('/:id/recalculate', perm('loans.edit', 'loans.approve'), c.loanRecalculate);
loansRouter.post('/:id/installments/:number/pay', perm('repayments.record'), body(v.markPaidSchema), c.installmentPay);
loansRouter.get('/:id/settlement-quote', perm('repayments.record', 'loans.approve'), query(v.settlementQuerySchema), c.settlementQuote);
loansRouter.post('/:id/settle', perm('repayments.record', 'loans.approve'), body(v.settleSchema), c.loanSettle);
loansRouter.get('/:id/transactions', perm('transactions.view', 'loans.view'), c.loanTransactions);

export const repaymentsRouter = mk();
repaymentsRouter.use(authenticate);
repaymentsRouter.get('/', perm('repayments.view'), query(v.listTransactionsSchema), c.repaymentList);
repaymentsRouter.post('/', perm('repayments.record'), body(v.recordRepaymentSchema), c.repaymentCreate);

export const transactionsRouter = mk();
transactionsRouter.use(authenticate);
transactionsRouter.get('/', perm('transactions.view'), query(v.listTransactionsSchema), c.txList);
transactionsRouter.post('/', perm('transactions.create'), body(v.manualTransactionSchema), c.txCreate);
transactionsRouter.get('/:id', perm('transactions.view'), c.txGet);
transactionsRouter.post('/:id/reverse', perm('transactions.reverse'), body(v.reasonSchema), c.txReverse);

export const topupsRouter = mk();
topupsRouter.use(authenticate);
topupsRouter.get('/', perm('topups.view'), query(v.listTopUpsSchema), c.topupList);
topupsRouter.post('/preview', perm('topups.request'), body(v.previewTopUpSchema), c.topupPreview);
topupsRouter.post('/', perm('topups.request'), body(v.requestTopUpSchema), c.topupRequest);
topupsRouter.get('/:id', perm('topups.view'), c.topupGet);
topupsRouter.post('/:id/approve', perm('topups.approve'), c.topupApprove);
topupsRouter.post('/:id/reject', perm('topups.approve'), body(v.reasonSchema), c.topupReject);
topupsRouter.post('/:id/cancel', perm('topups.request', 'topups.approve'), body(v.optionalReasonSchema), c.topupCancel);

export const reportsRouter = mk();
reportsRouter.use(authenticate, perm('reports.view'));
reportsRouter.get('/', c.reportCatalog);
reportsRouter.get('/:type', query(v.reportQuerySchema), c.reportRun);

export const settingsRouter = mk();
settingsRouter.use(authenticate);
settingsRouter.get('/public', c.settingsPublic);
settingsRouter.get('/', perm('settings.manage'), c.settingsGet);
settingsRouter.put('/:section', perm('settings.manage'), (req, _res, next) => {
  const s = (settingsSchemas as Record<string, z.ZodType>)[String(req.params.section)];
  if (!s) return next(AppError.notFound('Unknown settings section', 'SETTINGS_SECTION_NOT_FOUND'));
  next();
}, c.settingsUpdate);

export const auditRouter = mk();
auditRouter.use(authenticate, perm('audit.view'));
auditRouter.get('/meta', c.auditMeta);
auditRouter.get('/', query(v.listAuditSchema), c.auditList);

/** Called by a scheduler (e.g. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Disabled unless CRON_SECRET is set. */
export const jobsRouter = mk();
const cronAuth: RequestHandler = (req, _res, next) => {
  if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) return next(AppError.forbidden('Not allowed', 'FORBIDDEN'));
  next();
};
jobsRouter.all('/refresh-overdue', cronAuth, c.refreshOverdue);
/** One-time first-CEO creation for a brand-new deployment. Refuses once any user exists. */
jobsRouter.post('/bootstrap', cronAuth, body(createUserSchema.pick({ name: true, email: true, username: true, password: true })), c.bootstrapCeo);
