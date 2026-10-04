import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import api from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/sanitize.js';
import { registerCustomerFinancials } from './services/customerFinancials.impl.js';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(sanitize);
  // Broad per-IP ceiling on the API (login has its own, stricter limiter).
  app.use('/api', rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : 600, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } }));
  registerCustomerFinancials();
  if (env.NODE_ENV !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.get('/', (_req, res) => res.json({ success: true, data: { service: 'protech-loan-api', status: 'ok', docs: 'Endpoints live under /api (try /api/health)' } }));
  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
