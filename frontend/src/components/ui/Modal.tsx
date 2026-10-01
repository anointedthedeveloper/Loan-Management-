import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 animate-fade-in sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full animate-pop overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
