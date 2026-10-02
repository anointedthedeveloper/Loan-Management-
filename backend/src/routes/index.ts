import { Router } from 'express';
import auth from './auth.js';
import users from './users.js';
import customers from './customers.js';
import dashboard from './dashboard.js';
import { productsRouter, loansRouter, repaymentsRouter, transactionsRouter, topupsRouter, reportsRouter, settingsRouter, auditRouter, jobsRouter } from './finance.js';

const api = Router();
api.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', service: 'protech-loan-api' } }));
api.use('/auth', auth);
api.use('/users', users);
api.use('/customers', customers);
api.use('/dashboard', dashboard);
api.use('/loan-products', productsRouter);
api.use('/loans', loansRouter);
api.use('/repayments', repaymentsRouter);
api.use('/transactions', transactionsRouter);
api.use('/topups', topupsRouter);
api.use('/reports', reportsRouter);
api.use('/settings', settingsRouter);
api.use('/audit-logs', auditRouter);
api.use('/jobs', jobsRouter);
// Later phases mount here: /loans, /loan-products, /repayments,
// /transactions, /topups, /reports, /settings, /audit-logs
export default api;
