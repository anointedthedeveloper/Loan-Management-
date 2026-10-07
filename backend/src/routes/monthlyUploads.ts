import express, { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, ok } from '../utils/http.js';
import { actorOf } from '../controllers/customerController.js';
import { getSection } from '../services/settings.service.js';
import { applyBalances, planBalances, publicBalancePlan } from '../services/openingBalance.service.js';
import { applyMonthlyUpload, getMonthlyUpload, listMonthlyUploads, monthlyTemplate, planMonthlyUpload, publicPlan, type UploadPerms } from '../services/monthlyUpload.service.js';

/** Monthly "loans taken" uploads. Needs loans.create; uploaders without loans.approve create pending loans for the CEO to approve. */
const r = Router();
r.use(authenticate, requirePermission('loans.create'));
const raw = express.raw({ type: () => true, limit: '4mb' });
const perms = (req: express.Request): UploadPerms => { const p = req.auth!.permissions as string[]; return { canApprove: p.includes('loans.approve'), canEditLoans: p.includes('loans.edit') || p.includes('loans.approve'), canEditRunning: p.includes('loans.editActive'), canUpdateCustomers: p.includes('customers.update'), canCreateCustomers: p.includes('customers.create') }; };
const body = (req: express.Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

r.get('/', asyncHandler(async (_req, res) => ok(res, { uploads: await listMonthlyUploads() })));
r.get('/template', asyncHandler(async (_req, res) => {
  const company = (await getSection('company')).name || 'Protech';
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('protech-monthly-upload-template.xlsx').send(await monthlyTemplate(company));
}));
r.post('/preview', raw, asyncHandler(async (req, res) => ok(res, { plan: publicPlan(await planMonthlyUpload(body(req), perms(req))) }, 'Checked the file. Nothing was saved.')));
r.post('/', raw, asyncHandler(async (req, res) => {
  const result = await applyMonthlyUpload(body(req), String(req.query.filename ?? 'upload.xlsx').slice(0, 120), actorOf(req), perms(req));
  ok(res, { result }, result.needsApproval ? `${result.created} loan(s) submitted for approval, ${result.updated} updated` : `${result.created} loan(s) created, ${result.updated} updated`, 201);
}));
r.post('/balances/preview', raw, asyncHandler(async (req, res) => ok(res, { plan: publicBalancePlan(await planBalances(body(req), perms(req), req.query.asAt ? String(req.query.asAt) : undefined)) }, 'Checked the file. Nothing was saved.')));
r.post('/balances', raw, asyncHandler(async (req, res) => {
  const result = await applyBalances(body(req), String(req.query.filename ?? 'balances.xlsx').slice(0, 120), actorOf(req), perms(req), req.query.asAt ? String(req.query.asAt) : undefined);
  ok(res, { result }, result.needsApproval ? `${result.created} opening balance(s) submitted for approval` : `${result.created} opening balance(s) recorded`, 201);
}));
r.get('/:id', asyncHandler(async (req, res) => ok(res, { upload: await getMonthlyUpload(String(req.params.id)) })));
export default r;
