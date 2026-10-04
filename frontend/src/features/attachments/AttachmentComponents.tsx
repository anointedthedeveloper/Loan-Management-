import { useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { ApiError } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import type { Attachment } from '../../types/finance'
import { ACCEPT, MAX_BYTES, attachmentService } from './attachmentService'

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const Icon = ({ a }: { a: Attachment }) => (a.mimeType.startsWith('image/') ? <ImageIcon className="size-4 shrink-0 text-slate-500" /> : <FileText className="size-4 shrink-0 text-slate-500" />)

/** Click-to-download chips for the proof-of-payment files on a ledger entry. */
export function AttachmentLinks({ files }: { files?: Attachment[] }) {
  const toast = useToast()
  if (!files?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((a) => (
        <li key={a.id}>
          <button type="button" title={`Download ${a.filename}`} onClick={(e) => { e.stopPropagation(); attachmentService.download(a).catch((err) => toast('error', err instanceof ApiError ? err.message : 'Download failed')) }}
            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-brand-500 hover:text-brand-700">
            <Icon a={a} /><span className="truncate">{a.filename}</span><span className="text-slate-400">{size(a.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Picks and uploads proof of payment (debit/credit alert, receipt: PDF, image, Word, Excel).
 * Files upload as soon as they are chosen; the parent receives the uploaded files and links them to the payment on save.
 * With `transactionId` the files are attached to an existing payment straight away.
 */
export function AttachmentPicker({ value, onChange, loanId, transactionId, label = 'Proof of payment (debit / credit alert, receipt)' }: { value: Attachment[]; onChange: (files: Attachment[]) => void; loanId?: string; transactionId?: string; label?: string }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function pick(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    const added: Attachment[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) { toast('error', `${f.name} is larger than 4 MB`); continue }
      try { added.push(await attachmentService.upload(f, { loanId, transactionId })) } catch (e) { toast('error', `${f.name}: ${e instanceof ApiError ? e.message : 'upload failed'}`) }
    }
    if (added.length) onChange([...value, ...added])
    setBusy(false)
    if (input.current) input.current.value = ''
  }
  async function remove(a: Attachment) {
    if (!transactionId) await attachmentService.discard(a.id).catch(() => undefined) // unlinked uploads are discarded; files on a saved payment are kept
    onChange(value.filter((x) => x.id !== a.id))
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="attachment-input" onChange={(e) => pick(e.target.files)} />
      <label htmlFor="attachment-input" className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:border-brand-500 hover:text-brand-700 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <Paperclip className="size-4" />{busy ? 'Uploading…' : 'Attach files'}
      </label>
      <span className="ml-2 text-xs text-slate-500">PDF, PNG, JPG, DOCX, XLSX · up to 4 MB each</span>
      {value.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2"><Icon a={a} /><span className="truncate">{a.filename}</span><span className="shrink-0 text-xs text-slate-400">{size(a.size)}</span></span>
              {!transactionId && <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => remove(a)} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="size-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
