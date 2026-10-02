import { useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { useLoanMeta } from '../../../hooks/useLoanMeta'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { SelectField } from '../../../components/ui/FormControls'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { CustomerPicker, LoanPicker, type Hit } from '../../../components/ui/Pickers'
import { transactionService } from '../../repayments/services/repaymentService'

export function ManualTransactionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const meta = useLoanMeta()
  const [customer, setCustomer] = useState<Hit | null>(null)
  const [loan, setLoan] = useState<Hit | null>(null)
  const [f, setF] = useState({ type: 'fee', amount: '', date: '', method: '', reference: '', description: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((s) => ({ ...s, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: '' })) }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!customer && !loan) return setErrs({ customerId: 'Choose a customer or a loan' })
    setBusy(true); setErrs({})
    try { await transactionService.create({ type: f.type, amount: Number(f.amount), date: f.date || undefined, method: f.method || undefined, reference: f.reference || undefined, description: f.description || undefined, ...(loan ? { loanId: loan.id } : { customerId: customer!.id }) }); toast('success', 'Transaction recorded'); onDone() }
    catch (err) { if (err instanceof ApiError && err.fields) setErrs(err.fields); toast('error', err instanceof ApiError ? err.message : 'Could not record transaction') }
    finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Record ledger entry">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <SelectField label="Type" options={(meta?.transactionTypes ?? []).filter((t) => t.manual)} value={f.type} onChange={set('type')} placeholder="Choose type" error={errs.type} />
        <LoanPicker value={loan} onChange={setLoan} statuses="active,overdue,defaulted,completed" />
        {!loan && <CustomerPicker value={customer} onChange={setCustomer} error={errs.customerId} />}
        <MoneyField label="Amount" value={f.amount} onChange={(v) => { setF((s) => ({ ...s, amount: v })); setErrs((x) => ({ ...x, amount: '' })) }} error={errs.amount} placeholder="0.00" />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Date" type="date" value={f.date} onChange={set('date')} error={errs.date} /><SelectField label="Method" options={meta?.paymentMethods ?? []} value={f.method} onChange={set('method')} /></div>
        <Field label="Reference" value={f.reference} onChange={set('reference')} error={errs.reference} />
        <Field label="Description" value={f.description} onChange={set('description')} />
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Fees, adjustments, refunds and other entries are recorded in the ledger but do not change loan balances. Use <b>Record repayment</b> for loan payments.</p>
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} loadingText="Saving…">Record entry</Button></ModalActions>
      </form>
    </Modal>
  )
}
