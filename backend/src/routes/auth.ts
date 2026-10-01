import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { changePasswordSchema, forgotPasswordSchema, loginSchema } from '../validators/auth.js';
import * as c from '../controllers/authController.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes.', code: 'RATE_LIMITED' },
});

const r = Router();
r.post('/login', loginLimiter, validateBody(loginSchema), c.login);
r.post('/forgot-password', loginLimiter, validateBody(forgotPasswordSchema), c.forgotPassword);
r.get('/me', authenticate, c.me);
r.post('/logout', authenticate, c.logout);
r.post('/change-password', authenticate, validateBody(changePasswordSchema), c.changePassword);
export default r;
