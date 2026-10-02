// Runs the API against a throwaway in-memory MongoDB (handy when no local MongoDB is installed).
import { MongoMemoryServer } from 'mongodb-memory-server';
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('protech_loans');
const { connectDb } = await import('../config/db.js');
const { seedUsers } = await import('./seedUsers.js');
const { seedDemoData } = await import('./seedDemo.js');
const { createApp } = await import('../app.js');
const { env } = await import('../config/env.js');
await connectDb();
await seedUsers();
await seedDemoData();
createApp().listen(env.PORT, () => console.log(`Protech API (in-memory DB, demo data) on :${env.PORT}`));
