import { CheckCircle2 } from 'lucide-react'
import type { Installment } from '../../../types/finance'
import { InstallmentBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatMoney } from '../../../utils/format'

/** Payment window opens on the 25th of the due month (monthly cycle). */
const opens = (due: string) => { const d = new Date(due); return d.getUTCDate() >= 25 ? formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 25)).toISOString()) : null }

export function ScheduleTable({ rows, showPaid = true, compact = false, monthly = true, onMarkPaid }: { rows: Installment[]; showPaid?: boolean; compact?: boolean; /** monthly cycle: show when each payment window opens */ monthly?: boolean; /** When provided, unpaid rows get a "Mark paid" button. */ onMarkPaid?: (i: Installment) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Due date</th><th className="px-4 py-3 text-right">Expected</th>{!compact && <><th className="hidden px-4 py-3 text-right md:table-cell">Principal</th><th className="hidden px-4 py-3 text-right md:table-cell">Interest</th></>}
            {showPaid && <><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Remaining</th><th className="px-4 py-3">Status</th></>}{onMarkPaid && <th className="px-4 py-3 text-right">Action</th>}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {rows.map((i) => (
            <tr key={i.number}>
              <td className="px-4 py-2.5 font-medium">{i.number}</td><td className="whitespace-nowrap px-4 py-2.5">{formatDate(i.dueDate)}{monthly && opens(i.dueDate) && <span className="block text-[10px] font-normal text-slate-400">window opens {opens(i.dueDate)}</span>}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(i.expectedAmount)}</td>
              {!compact && <><td className="hidden px-4 py-2.5 text-right md:table-cell">{formatMoney(i.principalComponent)}</td><td className="hidden px-4 py-2.5 text-right md:table-cell">{formatMoney(i.interestComponent)}</td></>}
              {showPaid && <><td className="px-4 py-2.5 text-right">{formatMoney(i.amountPaid)}</td><td className="px-4 py-2.5 text-right">{formatMoney(i.remaining)}</td><td className="px-4 py-2.5"><InstallmentBadge status={i.status} /></td></>}
              {onMarkPaid && <td className="px-4 py-2 text-right">{i.remaining > 0 ? <button onClick={() => onMarkPaid(i)} className="inline-flex items-center gap-1 rounded-lg border border-brand-500 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"><CheckCircle2 className="size-3.5" />Mark paid</button> : <span className="text-xs text-slate-400">—</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
