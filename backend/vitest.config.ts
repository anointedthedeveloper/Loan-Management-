import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', testTimeout: 60000, hookTimeout: 120000, env: { NODE_ENV: 'test', BCRYPT_ROUNDS: '4', MONGODB_URI: 'mongodb://placeholder', JWT_SECRET: 'test-secret-test-secret-test-secret-123' } } });
