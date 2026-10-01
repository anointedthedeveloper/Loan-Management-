// Vercel serverless entry. Vercel does not run src/server.ts (no listen()); it calls this handler.
// It serves the compiled Express app from dist/ (built by `npm run build`, see vercel.json).
let app;
let dbReady;

export default async function handler(req, res) {
  try {
    // Dynamic imports so a bad/missing env var becomes a readable JSON error instead of a bare 500.
    const { connectDb } = await import('../dist/src/config/db.js');
    const { createApp } = await import('../dist/src/app.js');
    // The connection is cached across warm invocations; a failed attempt is retried next request.
    dbReady ??= connectDb().catch((e) => { dbReady = undefined; throw e; });
    await dbReady;
    app ??= createApp();
    return app(req, res);
  } catch (err) {
    console.error('API startup failure:', err);
    const message = /environment variables/.test(String(err?.message))
      ? `Server misconfigured: ${err.message}`
      : 'The API could not start. Check the database connection and server logs.';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message, code: 'SERVER_STARTUP_ERROR' }));
  }
}
