import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_REMEMBER_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(15).default(12),
  CRON_SECRET: z.string().min(16).optional(),
  SEED_CEO_PASSWORD: z.string().default('Protech@CEO2026'),
  SEED_ACCOUNTANT_PASSWORD: z.string().default('Protech@Acct2026'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Throw (not process.exit) so serverless hosts can report which variables are wrong.
  const bad = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(`Invalid or missing environment variables: ${bad}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
