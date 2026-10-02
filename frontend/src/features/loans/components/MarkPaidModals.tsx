import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useAuth } from '../../../context/AuthContext'
import { PERM } from '../../../config/permissions'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { SelectField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { formatDate, formatMoney } from '../../../utils/format'
import type { Installment, Loan, SettlementQuote } from '../../../types/finance'
import { loanService } from '../services/loanService'

function usePayFields() {
  const meta = useLoanMeta()
  const [f, setF] = useState({ date: '', method: 'bank_transfer', reference: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  return { meta, f, errs, setErrs, set }
}

/** Marks one month's installment as paid: records a repayment for exactly what is still owed on it. */
export function MarkInstallmentPaidModal({ loan, installment, onClose, onDone }: { loan: Loan; installment: Installment; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { meta, f, errs, setErrs, set } = usePayFields()
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    try { await loanService.markInstallmentPaid(loan.id, installment.number, { date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined }); toast('success', `Installment ${installment.number} marked as paid`); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not record payment') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Mark installment ${installment.number} as paid`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          <p className="text-slate-500">{loan.loanId} · due {formatDate(installment.dueDate)}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(installment.remaining)}</p>
          <p className="text-xs text-slate-500">The amount still owed on this installment. This is recorded as a repayment in the ledger.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment date" type="date" value={f.date} onChange={set('date')} error={errs.date} />
          <SelectField label="Method" options={meta?.paymentMethods ?? []} value={f.method} onChange={set('method')} placeholder="Choose method" error={errs.method} />
        </div>
        <Field label="Reference" value={f.reference} onChange={set('reference')} error={errs.reference} placeholder="Transfer / receipt reference" />
        <p className="text-xs text-slate-500">Leave the date empty for today. Other months are not affected.</p>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">Mark as paid</Button></ModalActions>
      </form>
    </Modal>
  )
}

/** Pays a loan off before its term ends. The figure comes from the server and follows the Settings > Repayment rule. */
export function SettleLoanModal({ loan, onClose, onDone }: { loan: Loan; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { can } = useAuth()
  const { meta, f, errs, setErrs, set } = usePayFields()
  const [quote, setQuote] = useState<SettlementQuote | null>(null)
  const [qErr, setQErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setQuote(null); setQErr('')
    loanService.settlementQuote(loan.id, f.date || undefined).then((q) => { if (live) setQuote(q) }).catch((e) => { if (live) setQErr(e instanceof ApiError ? e.message : 'Could not calculate') })
    return () => { live = false }
  }, [loan.id, f.date])

  const needsApproval = !!quote && quote.interestWaived > 0 && !can(PERM.loans.approve)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrs({})
    try { await loanService.settle(loan.id, { date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined }); toast('success', `${loan.loanId} settled`); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not settle the loan') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Settle ${loan.loanId} early`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {qErr ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{qErr}</p> : !quote ? <p className="text-sm text-slate-500">Calculating the settlement figure…</p> : (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Calculated by the server · {quote.mode === 'full_balance' ? 'pay everything still owed' : 'interest on months not yet due is waived'}</p>
            <div className="flex justify-between"><span className="text-slate-500">Still owed ({quote.installmentsRemaining} installments)</span><span className="tabular-nums">{formatMoney(quote.outstandingBalance)}</span></div>
            {quote.interestWaived > 0 && <div className="flex justify-between text-brand-700"><span>Interest waived (installments {quote.waivers.map((w) => w.number).join(', ')})</span><span className="tabular-nums">− {formatMoney(quote.interestWaived)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold"><span>Amount to pay now</span><span className="tabular-nums">{formatMoney(quote.amountToPay)}</span></div>
          </div>
        )}
        {needsApproval && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Waiving interest needs approval rights. Ask the CEO to settle this loan.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Settlement date" type="date" value={f.date} onChange={set('date')} error={errs.date} />
          <SelectField label="Method" options={meta?.paymentMethods ?? []} value={f.method} onChange={set('method')} placeholder="Choose method" error={errs.method} />
        </div>
        <Field label="Reference" value={f.reference} onChange={set('reference')} error={errs.reference} placeholder="Transfer / receipt reference" />
        <p className="text-xs text-slate-500">The loan is marked completed and every remaining installment is closed. This is recorded in the ledger and audit log.</p>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Settling…" disabled={!quote || needsApproval}>Settle loan</Button></ModalActions>
      </form>
    </Modal>
  )
}
