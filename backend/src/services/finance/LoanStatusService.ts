import { loanStatus } from '../../config/loanOptions.js';
import type { LoanState } from './BalanceService.js';

/**
 * Resolves a loan's status from its current status and its replayed state.
 * Workflow statuses (pending, approved, rejected, cancelled) never change here.
 * Rules for completion / overdue / default are configuration, not code.
 */
export function resolveStatus(current: string, state: LoanState, opts: { defaultAfterDays?: number | null } = {}): string {
  const def = loanStatus(current);
  if (!def) return current;
  if (def.manual && current !== 'defaulted') return current;
  if (state.fullyPaid) return 'completed';
  if (current === 'defaulted') return 'defaulted';
  if (current === 'completed') return state.overdueAmount > 0 ? 'overdue' : 'active'; // e.g. a payment was reversed
  if (opts.defaultAfterDays && state.daysOverdue >= opts.defaultAfterDays) return 'defaulted';
  return state.overdueAmount > 0 ? 'overdue' : 'active';
}
