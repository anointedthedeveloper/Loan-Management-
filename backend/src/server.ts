import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';

await connectDb();
createApp().listen(env.PORT, () => console.log(`Protech API listening on :${env.PORT} (${env.NODE_ENV})`));
