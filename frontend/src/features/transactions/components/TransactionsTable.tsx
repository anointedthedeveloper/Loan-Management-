import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Undo2 } from 'lucide-react'
import { PERM } from '../../../config/permissions'
import { ApiError } from '../../../services/api'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Badge } from '../../../components/ui/feedback'
import { Button } from '../../../components/ui/Button'
import { Drawer, DetailList } from '../../../components/ui/Drawer'
import { ReasonDialog } from '../../../components/ui/ReasonDialog'
import { TxStateBadge } from '../../../components/ui/StatusBadge'
import { formatDate, formatDateTime, formatMoney, titleCase } from '../../../utils/format'
import type { Transaction } from '../../../types/finance'
import { transactionService } from '../../repayments/services/repaymentService'

export const useTxType = () => {
  const meta = useLoanMeta()
  return (t: string) => meta?.transactionTypes.find((x) => x.value === t)
}

export function TxTypeBadge({ type }: { type: string }) {
  const def = useTxType()(type)
  return <Badge tone={type === 'repayment' ? 'green' : type === 'reversal' ? 'red' : type === 'disbursement' || type === 'topup' ? 'blue' : 'slate'}>{def?.label ?? titleCase(type)}</Badge>
}

/** Table + detail drawer + reversal flow. Used on loan, customer and transaction pages. */
export function TransactionsTable({ rows, onChanged }: { rows: Transaction[]; onChanged: () => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const typeOf = useTxType()
  const [sel, setSel] = useState<Transaction | null>(null)
  const [reversing, setReversing] = useState<Transaction | null>(null)
  const [busy, setBusy] = useState(false)

  async function reverse(reason: string) {
    if (!reversing) return
    setBusy(true)
    try { await transactionService.reverse(reversing.id, reason); toast('success', `${reversing.transactionId} reversed`); setReversing(null); setSel(null); onChanged() }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not reverse'); setReversing(null) }
    finally { setBusy(false) }
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Transaction</th><th className="px-4 py-3">Date</th><th className="hidden px-4 py-3 md:table-cell">Customer</th><th className="px-4 py-3">Type</th><th className="hidden px-4 py-3 lg:table-cell">Reference</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">State</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.id} onClick={() => setSel(t)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{t.transactionId}</td><td className="px-4 py-3">{formatDate(t.date)}</td>
                <td className="hidden px-4 py-3 md:table-cell">{t.customer?.fullName}</td><td className="px-4 py-3"><TxTypeBadge type={t.type} /></td>
                <td className="hidden px-4 py-3 text-slate-500 lg:table-cell">{t.reference ?? '—'}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${t.state === 'reversed' ? 'text-slate-400 line-through' : ''}`}>{formatMoney(t.amount)}</td>
                <td className="px-4 py-3"><TxStateBadge state={t.state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={!!sel} title={sel?.transactionId ?? ''} onClose={() => setSel(null)}>
        {sel && (
          <div className="space-y-5">
            <div className="flex items-center gap-2"><TxTypeBadge type={sel.type} /><TxStateBadge state={sel.state} /></div>
            <p className="text-3xl font-bold tabular-nums">{formatMoney(sel.amount)}</p>
            <DetailList items={[
              ['Date', formatDate(sel.date)], ['Customer', sel.customer ? <Link className="text-brand-700 hover:underline" to={`/customers/${sel.customer.id}`}>{sel.customer.fullName} ({sel.customer.customerId})</Link> : null],
              ['Loan', sel.loan ? <Link className="text-brand-700 hover:underline" to={`/loans/${sel.loan.id}`}>{sel.loan.loanId}</Link> : null],
              ['Payment method', sel.method ? titleCase(sel.method) : null], ['Reference', sel.reference], ['Description', sel.description],
              ['Recorded by', sel.createdBy?.name], ['Recorded at', formatDateTime(sel.createdAt)],
              ['Affects loan balance', sel.affectsLoanBalance ? 'Yes' : 'No'], ['Cash movement', sel.isCash ? 'Yes' : 'No (non-cash settlement)'],
              ...(sel.state === 'reversed' ? [['Reversal reason', sel.reversalReason] as [string, string | null]] : []),
            ]} />
            {sel.allocations.length > 0 && (
              <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Applied to</p>
                <ul className="space-y-1 text-sm">{sel.allocations.map((a) => <li key={a.number} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span>Installment {a.number}</span><span className="tabular-nums">Principal {formatMoney(a.principal)} · Interest {formatMoney(a.interest)}</span></li>)}</ul></div>
            )}
            {sel.state === 'posted' && typeOf(sel.type)?.reversible && can(PERM.transactions.reverse) && (
              <Button variant="danger" onClick={() => setReversing(sel)}><Undo2 className="size-4" />Reverse transaction</Button>
            )}
            <p className="text-xs text-slate-500">Ledger entries are never deleted. A reversal writes a new entry and recalculates the loan from the ledger.</p>
          </div>
        )}
      </Drawer>
      {reversing && <ReasonDialog open danger loading={busy} title={`Reverse ${reversing.transactionId}?`} confirmLabel="Reverse" message={`This reverses ${formatMoney(reversing.amount)}${reversing.loan ? ` on ${reversing.loan.loanId}` : ''}. The loan balance, schedule and status are recalculated. Recorded in the audit log.`} onConfirm={reverse} onCancel={() => setReversing(null)} />}
    </>
  )
}
