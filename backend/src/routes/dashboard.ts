import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { overview } from '../controllers/dashboardController.js';

const r = Router();
r.get('/overview', authenticate, requirePermission('dashboard.view'), overview);
export default r;
