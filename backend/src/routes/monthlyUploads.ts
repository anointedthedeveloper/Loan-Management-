import express, { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, ok } from '../utils/http.js';
import { actorOf } from '../controllers/customerController.js';
import { getSection } from '../services/settings.service.js';
import { applyMonthlyUpload, getMonthlyUpload, listMonthlyUploads, monthlyTemplate, planMonthlyUpload, publicPlan } from '../services/monthlyUpload.service.js';

/** Monthly "loans taken" uploads. Needs loans.create; uploaders without loans.approve create pending loans for the CEO to approve. */
const r = Router();
r.use(authenticate, requirePermission('loans.create'));
const raw = express.raw({ type: () => true, limit: '4mb' });
const canApprove = (req: express.Request) => req.auth!.permissions.includes('loans.approve');
const body = (req: express.Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

r.get('/', asyncHandler(async (_req, res) => ok(res, { uploads: await listMonthlyUploads() })));
r.get('/template', asyncHandler(async (_req, res) => {
  const company = (await getSection('company')).name || 'Protech';
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('protech-monthly-upload-template.xlsx').send(await monthlyTemplate(company));
}));
r.post('/preview', raw, asyncHandler(async (req, res) => ok(res, { plan: publicPlan(await planMonthlyUpload(body(req), canApprove(req))) }, 'Checked the file. Nothing was saved.')));
r.post('/', raw, asyncHandler(async (req, res) => {
  const result = await applyMonthlyUpload(body(req), String(req.query.filename ?? 'upload.xlsx').slice(0, 120), actorOf(req), canApprove(req));
  ok(res, { result }, result.needsApproval ? `${result.created} loan(s) submitted for approval` : `${result.created} loan(s) created`, 201);
}));
r.get('/:id', asyncHandler(async (req, res) => ok(res, { upload: await getMonthlyUpload(String(req.params.id)) })));
export default r;
