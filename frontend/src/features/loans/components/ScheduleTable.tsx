import type { Installment } from '../../../types/finance'
import { InstallmentBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatMoney } from '../../../utils/format'

export function ScheduleTable({ rows, showPaid = true, compact = false }: { rows: Installment[]; showPaid?: boolean; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Due date</th><th className="px-4 py-3 text-right">Expected</th>{!compact && <><th className="hidden px-4 py-3 text-right md:table-cell">Principal</th><th className="hidden px-4 py-3 text-right md:table-cell">Interest</th></>}
            {showPaid && <><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Remaining</th><th className="px-4 py-3">Status</th></>}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {rows.map((i) => (
            <tr key={i.number}>
              <td className="px-4 py-2.5 font-medium">{i.number}</td><td className="whitespace-nowrap px-4 py-2.5">{formatDate(i.dueDate)}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(i.expectedAmount)}</td>
              {!compact && <><td className="hidden px-4 py-2.5 text-right md:table-cell">{formatMoney(i.principalComponent)}</td><td className="hidden px-4 py-2.5 text-right md:table-cell">{formatMoney(i.interestComponent)}</td></>}
              {showPaid && <><td className="px-4 py-2.5 text-right">{formatMoney(i.amountPaid)}</td><td className="px-4 py-2.5 text-right">{formatMoney(i.remaining)}</td><td className="px-4 py-2.5"><InstallmentBadge status={i.status} /></td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
