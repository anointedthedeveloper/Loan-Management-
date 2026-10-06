import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler, ok } from '../utils/http.js';
import { sendPage } from '../utils/pagination.js';
import { actorOf } from '../controllers/customerController.js';
import { editRepaymentSchema, reasonSchema, updateLoanSchema } from '../validators/finance.js';
import { AppError } from '../utils/AppError.js';
import { approveRequest, cancelRequest, createRequest, listRequests, rejectRequest, type ApprovalKind } from '../services/approval.service.js';

/** Change requests: staff without a sensitive permission ask, the CEO (approvals.decide) carries the change out. */
const r = Router();
r.use(authenticate);
const kinds = ['repayment_edit', 'transaction_reverse', 'loan_edit', 'customer_delete'] as const;
// Permission the requester needs just to see the thing they are asking to change.
const NEEDS: Record<ApprovalKind, string[]> = { repayment_edit: ['repayments.view', 'transactions.view'], transaction_reverse: ['transactions.view', 'repayments.view'], loan_edit: ['loans.view', 'loans.edit'], customer_delete: ['customers.read'] };
const schemaFor: Record<ApprovalKind, z.ZodType<any>> = { repayment_edit: editRepaymentSchema, transaction_reverse: reasonSchema, loan_edit: updateLoanSchema, customer_delete: z.object({ reason: z.string().trim().max(500).optional() }) };
const reqSchema = z.object({ kind: z.enum(kinds), targetId: z.string().min(1), reason: z.string().trim().max(500).optional(), payload: z.record(z.string(), z.any()).optional() });

r.get('/', asyncHandler(async (req, res) => {
  const canDecide = req.auth!.permissions.includes('approvals.decide');
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Number(req.query.limit) || 50);
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : undefined;
  const data = await listRequests({ status, mine: canDecide ? undefined : req.auth!.id, page, limit });
  sendPage(res, data.items, { page, limit }, data.total);
}));
r.post('/', validateBody(reqSchema), asyncHandler(async (req, res) => {
  const { kind, targetId, reason, payload } = req.body as z.infer<typeof reqSchema>;
  const perms = req.auth!.permissions as string[];
  if (!NEEDS[kind].some((p) => perms.includes(p))) throw AppError.forbidden();
  const parsed = schemaFor[kind].safeParse({ ...(payload ?? {}), reason: payload?.reason ?? reason });
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues[0]?.message ?? 'Please check the details', 'VALIDATION_ERROR');
  ok(res, { request: await createRequest(kind, targetId, parsed.data, reason, actorOf(req)) }, 'Sent to the CEO for approval', 201);
}));
r.post('/:id/approve', requirePermission('approvals.decide'), asyncHandler(async (req, res) => ok(res, { request: await approveRequest(String(req.params.id), actorOf(req)) }, 'Approved and carried out')));
r.post('/:id/reject', requirePermission('approvals.decide'), validateBody(reasonSchema), asyncHandler(async (req, res) => ok(res, { request: await rejectRequest(String(req.params.id), req.body.reason, actorOf(req)) }, 'Request rejected')));
r.post('/:id/cancel', asyncHandler(async (req, res) => ok(res, { request: await cancelRequest(String(req.params.id), actorOf(req), (req.auth!.permissions as string[]).includes('approvals.decide')) }, 'Request cancelled')));
export default r;
