import { useState, type FormEvent } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { MoneyField } from '../../../components/ui/MoneyField'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { approvalService } from '../../approvals/approvalService'

/** Asks the CEO to change a running loan's amount or tenor. Nothing changes until it is approved. */
export function RequestLoanChangeModal({ loanId, amount, months, onClose, onDone }: { loanId: string; amount: number; months?: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ amount: String(amount), months: months ? String(months) : '', reason: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const payload: Record<string, unknown> = {}
    if (Number(f.amount) && Number(f.amount) !== amount) payload.amount = Number(f.amount)
    if (Number(f.months) && Number(f.months) !== months) payload.duration = { value: Number(f.months), unit: 'months' }
    if (!Object.keys(payload).length) return setErr('Change the amount or the number of months first')
    if (f.reason.trim().length < 3) return setErr('Enter the reason for the change')
    setBusy(true); setErr('')
    try { await approvalService.request('loan_edit', loanId, f.reason.trim(), payload); toast('success', 'Sent to the CEO for approval'); onDone() }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send the request') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Request a loan change">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Running loans are changed by the CEO. Send what should change and why; nothing changes until it is approved.</p>
        <MoneyField label="Loan amount" value={f.amount} onChange={(v) => setF((s) => ({ ...s, amount: v }))} />
        <Field label="Duration (months)" type="number" value={f.months} onChange={(e) => setF((s) => ({ ...s, months: e.target.value }))} />
        <Field label="Reason for the change *" value={f.reason} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} />
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        <ModalActions><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Send for approval</Button></ModalActions>
      </form>
    </Modal>
  )
}
