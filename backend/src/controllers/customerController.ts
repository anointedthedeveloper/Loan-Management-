import type { Request } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import { sendPage } from '../utils/pagination.js';
import { paginationSchema } from '../validators/common.js';
import * as svc from '../services/customer.service.js';
import { CUSTOMER_STATUSES, GENDERS, ID_TYPES, EMPLOYMENT_TYPES } from '../config/customerOptions.js';
import type { Actor } from '../types/index.js';

export const actorOf = (req: Request): Actor => ({ id: req.auth!.id, name: req.auth!.name, ip: req.ip, role: req.auth!.role });
const id = (req: Request) => String(req.params.id);
const paging = (req: Request) => paginationSchema.parse(req.query);

export const meta = asyncHandler(async (_req, res) => {
  ok(res, { statuses: CUSTOMER_STATUSES, idTypes: ID_TYPES, genders: GENDERS, employmentTypes: EMPLOYMENT_TYPES });
});
export const list = asyncHandler(async (_req, res) => {
  const q = res.locals.query;
  const { items, total } = await svc.listCustomers(q);
  sendPage(res, items, q, total);
});
export const create = asyncHandler(async (req, res) => ok(res, { customer: await svc.createCustomer(req.body, actorOf(req)) }, 'Customer registered', 201));
export const get = asyncHandler(async (req, res) => ok(res, { customer: await svc.getCustomer(id(req)) }));
export const update = asyncHandler(async (req, res) => ok(res, { customer: await svc.updateCustomer(id(req), req.body, actorOf(req)) }, 'Customer updated'));
export const remove = asyncHandler(async (req, res) => { await svc.deleteCustomer(id(req), actorOf(req)); ok(res, null, 'Customer deleted'); });
export const summary = asyncHandler(async (req, res) => ok(res, await svc.getCustomerSummary(id(req))));

const financialList = (kind: 'listLoans' | 'listRepayments' | 'listTransactions') =>
  asyncHandler(async (req, res) => { const q = paging(req); const r = await svc.getCustomerFinancialList(id(req), kind, q); sendPage(res, r.items, q, r.total); });
export const loans = financialList('listLoans');
export const repayments = financialList('listRepayments');
export const transactions = financialList('listTransactions');

export const activity = asyncHandler(async (req, res) => { const q = paging(req); const r = await svc.getCustomerActivity(id(req), q); sendPage(res, r.items, q, r.total); });
