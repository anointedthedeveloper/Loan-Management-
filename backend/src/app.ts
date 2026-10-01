import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import api from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));
  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
