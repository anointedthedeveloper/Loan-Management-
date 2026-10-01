import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '../validators/users.js';
import * as c from '../controllers/userController.js';

const r = Router();
r.use(authenticate, requirePermission('staff.manage'));
r.get('/', c.list);
r.get('/permissions', c.permissionCatalogue);
r.post('/', validateBody(createUserSchema), c.create);
r.get('/:id', c.get);
r.patch('/:id', validateBody(updateUserSchema), c.update);
r.post('/:id/reset-password', validateBody(resetPasswordSchema), c.resetPassword);
r.get('/:id/activity', c.activity);
r.delete('/:id', c.remove);
export default r;
