import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { startScheduler } from './jobs/overdueJob.js';

await connectDb();
createApp().listen(env.PORT, () => console.log(`Protech API listening on :${env.PORT} (${env.NODE_ENV})`));
startScheduler(); // hourly overdue/completion sweep on long-running hosts
