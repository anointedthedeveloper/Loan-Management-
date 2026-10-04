import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'

/** Open dialogs, innermost last: Escape closes only the one on top (e.g. a file preview opened from a form). */
const openStack: symbol[] = []

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const id = Symbol('modal'); openStack.push(id)
    const h = (e: KeyboardEvent) => e.key === 'Escape' && openStack[openStack.length - 1] === id && onClose()
    document.addEventListener('keydown', h)
    return () => { document.removeEventListener('keydown', h); openStack.splice(openStack.indexOf(id), 1) }
  }, [open, onClose])
  if (!open) return null
  // Rendered on <body> so no parent (transforms, overflow, stacking) can clip or mis-position the dialog.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 animate-fade-in sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full animate-pop flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Action row pinned to the bottom of a scrolling dialog so Save / Cancel are always visible. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="sticky -bottom-5 z-10 -mx-5 mt-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">{children}</div>
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
