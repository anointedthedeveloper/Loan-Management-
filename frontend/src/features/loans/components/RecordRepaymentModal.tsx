import { useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { SelectField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { LoanPicker, type Hit } from '../../../components/ui/Pickers'
import { repaymentService } from '../../repayments/services/repaymentService'
import { formatMoney } from '../../../utils/format'

/** Records a repayment through the API; all balance/schedule updates are performed by the backend. */
export function RecordRepaymentModal({ loan, onClose, onDone }: { loan?: { id: string; loanId: string; outstandingBalance: number; nextInstallmentAmount: number }; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const meta = useLoanMeta()
  const [picked, setPicked] = useState<Hit | null>(loan ? { id: loan.id, title: loan.loanId, sub: `Outstanding ${formatMoney(loan.outstandingBalance)}` } : null)
  const [f, setF] = useState({ amount: '', date: '', method: 'bank_transfer', reference: '', description: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!picked) return setErrs({ loanId: 'Choose a loan' })
    if (!f.amount) return setErrs({ amount: 'Enter the amount received' })
    setBusy(true); setErrs({})
    try {
      await repaymentService.record({ loanId: picked.id, amount: Number(f.amount), date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined, description: f.description || undefined })
      toast('success', 'Repayment recorded'); onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrs(err.fields)
      toast('error', err instanceof ApiError ? err.message : 'Could not record repayment')
    } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Record repayment">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {loan ? <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{loan.loanId}</b> · Outstanding {formatMoney(loan.outstandingBalance)}{loan.nextInstallmentAmount > 0 && <> · Next installment {formatMoney(loan.nextInstallmentAmount)}</>}</div>
          : <LoanPicker value={picked} onChange={setPicked} error={errs.loanId} />}
        <MoneyField label="Amount received" autoFocus value={f.amount} onChange={(v) => { setF((s) => ({ ...s, amount: v })); setErrs((x) => ({ ...x, amount: '' })) }} error={errs.amount} placeholder="0.00" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment date" type="date" value={f.date} onChange={set('date')} error={errs.date} />
          <SelectField label="Method" options={meta?.paymentMethods ?? []} value={f.method} onChange={set('method')} placeholder="Choose method" error={errs.method} />
        </div>
        <Field label="Reference" value={f.reference} onChange={set('reference')} error={errs.reference} placeholder="Transfer / receipt reference" />
        <Field label="Note (optional)" value={f.description} onChange={set('description')} />
        <p className="text-xs text-slate-500">Balances, the schedule and the loan status are updated automatically. Leave the date empty for today.</p>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">Record repayment</Button></ModalActions>
      </form>
    </Modal>
  )
}
