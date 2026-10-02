import { useState } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'
import { TextareaField } from './FormControls'

/** Destructive / final actions that must be explained (rejections, reversals…). The reason is sent to the audit log. */
export function ReasonDialog({ open, title, message, confirmLabel, danger, required = true, loading, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean; required?: boolean; loading?: boolean; onConfirm: (reason: string) => void; onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const invalid = required && reason.trim().length < 3
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-4"><TextareaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={touched && invalid ? 'Please give a reason (at least 3 characters)' : undefined} /></div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={() => { setTouched(true); if (!invalid) onConfirm(reason.trim()) }}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
