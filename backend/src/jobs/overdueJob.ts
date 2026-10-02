import { refreshLiveLoans } from '../services/loanLedger.service.js';

/** Re-evaluates every live loan: marks overdue, completed or defaulted without anyone opening it. */
export const runOverdueJob = () => refreshLiveLoans();

/** For long-running hosts. On serverless hosts use the cron endpoint instead (see vercel.json). */
export function startScheduler(intervalMs = 60 * 60 * 1000) {
  const tick = () => runOverdueJob().then((r) => console.log(`[overdue-job] checked ${r.checked}, changed ${r.changed}`)).catch((e) => console.error('[overdue-job] failed', e));
  setTimeout(tick, 10_000).unref();
  return setInterval(tick, intervalMs).unref();
}
