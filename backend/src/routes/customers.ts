import express, { Router } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import { importCustomers } from '../services/customerImport.service.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { createCustomerSchema, listCustomersSchema, updateCustomerSchema } from '../validators/customers.js';
import { statementQuerySchema } from '../validators/finance.js';
import * as c from '../controllers/customerController.js';
import { clientStatement } from '../controllers/financeControllers.js';

const r = Router();
r.use(authenticate);
r.get('/meta', requirePermission('customers.read'), c.meta);
r.get('/', requirePermission('customers.read'), validateQuery(listCustomersSchema), c.list);
r.post('/', requirePermission('customers.create'), validateBody(createCustomerSchema), c.create);
/** Excel upload (raw body). `?dryRun=true` only reports what would happen. */
r.post('/import', requirePermission('customers.import'), express.raw({ type: () => true, limit: '4mb' }), asyncHandler(async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const report = await importCustomers(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { dryRun, actor: c.actorOf(req) });
  ok(res, { report }, dryRun ? 'Checked the file. Nothing was saved.' : `Imported: ${report.created} created, ${report.updated} updated`);
}));
r.get('/:id', requirePermission('customers.read'), c.get);
r.patch('/:id', requirePermission('customers.update'), validateBody(updateCustomerSchema), c.update);
r.delete('/:id', requirePermission('customers.delete'), c.remove);
r.get('/:id/summary', requirePermission('customers.viewFinancials'), c.summary);
r.get('/:id/loans', requirePermission('customers.viewFinancials'), c.loans);
r.get('/:id/repayments', requirePermission('customers.viewFinancials'), c.repayments);
r.get('/:id/transactions', requirePermission('customers.viewFinancials'), c.transactions);
r.get('/:id/statement', requirePermission('customers.viewFinancials'), validateQuery(statementQuerySchema), clientStatement);
r.get('/:id/activity', requirePermission('audit.view'), c.activity);
export default r;
