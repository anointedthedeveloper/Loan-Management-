import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { helpFor } from '../../config/pageHelp'

const KEY = 'protech.help.seen'
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const write = (v: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* storage unavailable */ } }

/** "About this page": opens by itself the first time someone visits a page, then stays out of the way behind a small button. */
export function PageHelp({ pathname }: { pathname: string }) {
  const help = helpFor(pathname)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!help) return
    setOpen(!read().includes(help.key)) // first visit: open; it is remembered as seen once the person closes it
  }, [help?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); if (help) { const seen = read(); if (!seen.includes(help.key)) write([...seen, help.key]) } }
  if (!help) return null
  return (
    <div className="mb-4 print:hidden">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50" aria-expanded="false"><Info className="size-3.5" />About this page</button>
      ) : (
        <section className="animate-fade-in rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm" aria-label={`About ${help.title}`}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="flex items-center gap-1.5 font-semibold text-brand-900"><Info className="size-4" />About this page: {help.title}</p><p className="mt-1 text-slate-700">{help.about}</p></div>
            <button type="button" onClick={close} aria-label="Hide this explanation" className="rounded p-1 text-slate-500 hover:bg-white"><X className="size-4" /></button>
          </div>
          {help.steps && <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How to use it</p><ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-700">{help.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>}
          {help.notes && <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Good to know</p><ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{help.notes.map((s) => <li key={s}>{s}</li>)}</ul></div>}
        </section>
      )}
    </div>
  )
}
