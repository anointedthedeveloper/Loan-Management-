import { useEffect, useRef, useState } from 'react'
import { Download, Eye, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { ApiError } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import type { Attachment } from '../../types/finance'
import { ACCEPT, MAX_BYTES, attachmentService } from './attachmentService'

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const isImage = (a: Attachment) => a.mimeType.startsWith('image/')
const isPdf = (a: Attachment) => a.mimeType === 'application/pdf'
const Icon = ({ a }: { a: Attachment }) => (isImage(a) ? <ImageIcon className="size-4 shrink-0 text-slate-500" /> : <FileText className="size-4 shrink-0 text-slate-500" />)

/** A short-lived blob URL for a file: from the browser's own copy while uploading, otherwise fetched with the user's token. */
function useFileUrl(a: Attachment, local?: File, enabled = true) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let live = true; let made: string | null = null
    setUrl(null); setError(false)
    const load = local ? Promise.resolve<Blob>(local) : attachmentService.blob(a)
    load.then((b) => { if (!live) return; made = URL.createObjectURL(new Blob([b], { type: a.mimeType })); setUrl(made) }).catch(() => { if (live) setError(true) })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [a.id, local, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { url, error }
}

function saveUrl(url: string, name: string) { const l = document.createElement('a'); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove() }

/** Full preview of an uploaded file (image or PDF), with a download button. Other types offer download only. */
export function AttachmentPreview({ file, local, onClose }: { file: Attachment; local?: File; onClose: () => void }) {
  const { url, error } = useFileUrl(file, local)
  return (
    <Modal open wide title={file.filename} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex min-h-[40vh] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {error ? <p className="p-6 text-sm text-red-600">Could not load this file.</p> : !url ? <p className="p-6 text-sm text-slate-500">Loading preview…</p>
            : isImage(file) ? <img src={url} alt={file.filename} className="max-h-[65vh] max-w-full object-contain" />
            : isPdf(file) ? <iframe src={url} title={file.filename} className="h-[65vh] w-full" />
            : <div className="p-8 text-center text-sm text-slate-600"><FileText className="mx-auto mb-2 size-10 text-slate-400" />No preview for this file type. Download it to open it.</div>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-slate-500">{file.filename} · {size(file.size)}</span>
          <Button disabled={!url} onClick={() => url && saveUrl(url, file.filename)}><Download className="size-4" />Download</Button>
        </div>
      </div>
    </Modal>
  )
}

/** Thumbnail card: image preview (or file icon); click to open the full preview, with a download shortcut. */
function Card({ a, local, onOpen }: { a: Attachment; local?: File; onOpen: () => void }) {
  const toast = useToast()
  const { url } = useFileUrl(a, local, isImage(a))
  return (
    <div className="w-36 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onOpen} className="flex h-24 w-full items-center justify-center bg-slate-50 hover:bg-slate-100" title="Preview">
        {isImage(a) ? (url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="size-8 text-slate-300" />) : <FileText className={`size-9 ${isPdf(a) ? 'text-red-400' : 'text-slate-400'}`} />}
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="truncate text-xs text-slate-700" title={a.filename}>{a.filename}</span>
        <button type="button" aria-label={`Download ${a.filename}`} title="Download" className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
          onClick={() => (local ? saveUrl(URL.createObjectURL(local), a.filename) : attachmentService.download(a).catch((e) => toast('error', e instanceof ApiError ? e.message : 'Download failed')))}><Download className="size-3.5" /></button>
      </div>
    </div>
  )
}

/** The proof files on a payment, shown as previews you can click to open and download. */
export function AttachmentGallery({ files }: { files?: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  if (!files?.length) return null
  return (
    <>
      <div className="flex flex-wrap gap-2">{files.map((a) => <Card key={a.id} a={a} onOpen={() => setOpen(a)} />)}</div>
      {open && <AttachmentPreview file={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** Compact chips (for table rows): click opens the preview. */
export function AttachmentLinks({ files }: { files?: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  if (!files?.length) return null
  return (
    <>
      <ul className="flex flex-wrap gap-1.5">
        {files.map((a) => (
          <li key={a.id}>
            <button type="button" title={`Preview ${a.filename}`} onClick={(e) => { e.stopPropagation(); setOpen(a) }}
              className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-brand-500 hover:text-brand-700">
              <Icon a={a} /><span className="truncate">{a.filename}</span><span className="text-slate-400">{size(a.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <AttachmentPreview file={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/**
 * Picks and uploads proof of payment (debit/credit alert, receipt: PDF, image, Word, Excel).
 * Files upload as soon as they are chosen and show a preview; the parent receives the uploaded files and links them to the payment on save.
 * With `transactionId` the files are attached to an existing payment straight away.
 */
export function AttachmentPicker({ value, onChange, loanId, transactionId, label = 'Proof of payment (debit / credit alert, receipt)' }: { value: Attachment[]; onChange: (files: Attachment[]) => void; loanId?: string; transactionId?: string; label?: string }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const locals = useRef(new Map<string, File>()) // the browser's copy of each upload, for instant previews
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Attachment | null>(null)
  async function pick(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    const added: Attachment[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) { toast('error', `${f.name} is larger than 4 MB`); continue }
      try { const a = await attachmentService.upload(f, { loanId, transactionId }); locals.current.set(a.id, f); added.push(a) } catch (e) { toast('error', `${f.name}: ${e instanceof ApiError ? e.message : 'upload failed'}`) }
    }
    if (added.length) onChange([...value, ...added])
    setBusy(false)
    if (input.current) input.current.value = ''
  }
  async function remove(a: Attachment) {
    if (!transactionId) await attachmentService.discard(a.id).catch(() => undefined) // unlinked uploads are discarded; files on a saved payment are kept
    locals.current.delete(a.id)
    onChange(value.filter((x) => x.id !== a.id))
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="attachment-input" onChange={(e) => pick(e.target.files)} />
      <label htmlFor="attachment-input" className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:border-brand-500 hover:text-brand-700 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <Paperclip className="size-4" />{busy ? 'Uploading…' : 'Attach files'}
      </label>
      <span className="mt-1 block text-xs text-slate-500">PDF, PNG, JPG, DOCX, XLSX · up to 4 MB each</span>
      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {value.map((a) => (
            <li key={a.id} className="relative">
              <Card a={a} local={locals.current.get(a.id)} onOpen={() => setOpen(a)} />
              {!transactionId && <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => remove(a)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 shadow hover:text-red-600"><X className="size-3.5" /></button>}
              <button type="button" onClick={() => setOpen(a)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Eye className="size-3" />Preview</button>
            </li>
          ))}
        </ul>
      )}
      {open && <AttachmentPreview file={open} local={locals.current.get(open.id)} onClose={() => setOpen(null)} />}
    </div>
  )
}
