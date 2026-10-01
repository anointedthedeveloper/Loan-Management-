import { Router } from 'express';
import auth from './auth.js';
import users from './users.js';

const api = Router();
api.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', service: 'protech-loan-api' } }));
api.use('/auth', auth);
api.use('/users', users);
// Later phases mount here: /customers, /loans, /loan-products, /repayments,
// /transactions, /topups, /reports, /settings, /audit-logs
export default api;
