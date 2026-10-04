import { Banknote } from 'lucide-react'
import { EmptyState } from '../../../components/ui/feedback'
import { TxStateBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatMoney, titleCase } from '../../../utils/format'
import type { Transaction } from '../../../types/finance'

/** Every repayment recorded on this loan, newest first, with what each payment was applied to. */
export function LoanRepaymentsList({ rows }: { rows: Transaction[] }) {
  const repayments = rows.filter((t) => t.type === 'repayment')
  const posted = repayments.filter((t) => t.state === 'posted')
  const total = posted.reduce((s, t) => s + t.amount, 0)
  if (!repayments.length) return <EmptyState icon={<Banknote className="size-6" />} title="No repayments yet" hint="Repayments recorded on this loan are listed here, with the installments each one was applied to." />
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 text-sm">
        <span><b>{posted.length}</b> repayment{posted.length === 1 ? '' : 's'} received</span>
        <span>Total received: <b className="tabular-nums">{formatMoney(total)}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Reference</th><th className="hidden px-4 py-3 md:table-cell">Method</th><th className="px-4 py-3 text-right">Amount</th><th className="hidden px-4 py-3 lg:table-cell">Applied to</th><th className="hidden px-4 py-3 lg:table-cell">Recorded by</th><th className="px-4 py-3">State</th></tr></thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {repayments.map((t, i) => (
              <tr key={t.id} className={t.state === 'reversed' ? 'text-slate-400' : ''}>
                <td className="px-4 py-2.5">{repayments.length - i}</td><td className="whitespace-nowrap px-4 py-2.5">{formatDate(t.date)}</td>
                <td className="px-4 py-2.5"><span className="font-mono text-xs">{t.reference ?? t.transactionId}</span>{t.reference && <span className="block font-mono text-[10px] text-slate-400">{t.transactionId}</span>}</td>
                <td className="hidden px-4 py-2.5 md:table-cell">{t.method ? titleCase(t.method) : '—'}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${t.state === 'reversed' ? 'line-through' : ''}`}>{formatMoney(t.amount)}</td>
                <td className="hidden px-4 py-2.5 text-xs lg:table-cell">{t.allocations.length ? t.allocations.map((a) => `#${a.number}`).join(', ') : '—'}</td>
                <td className="hidden px-4 py-2.5 lg:table-cell">{t.createdBy?.name ?? '—'}</td>
                <td className="px-4 py-2.5"><TxStateBadge state={t.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
