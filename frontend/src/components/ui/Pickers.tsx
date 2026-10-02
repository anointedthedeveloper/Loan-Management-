import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { apiPage, qs } from '../../services/api'
import { useDebounce } from '../../hooks/useDebounce'
import { formatMoney } from '../../utils/format'

interface Hit { id: string; title: string; sub: string }

/** Server-searched picker (never loads the full list into the browser). */
function Picker({ label, placeholder, value, onChange, search, error }: { label: string; placeholder: string; value: Hit | null; onChange: (h: Hit | null) => void; search: (q: string) => Promise<Hit[]>; error?: string }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const dq = useDebounce(q, 250)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) search(dq).then(setHits).catch(() => setHits([])) }, [dq, open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  return (
    <div ref={box} className="relative">
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm"><span><b>{value.title}</b> <span className="text-slate-500">{value.sub}</span></span><button type="button" aria-label="Clear selection" onClick={() => onChange(null)}><X className="size-4 text-slate-400" /></button></div>
      ) : (
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input aria-label={label} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} placeholder={placeholder} aria-invalid={!!error}
            className={`block w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${error ? 'border-red-400' : 'border-slate-300'}`} /></div>
      )}
      {open && !value && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">No matches</li> : hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => { onChange(h); setOpen(false); setQ('') }} className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"><span className="text-sm font-medium">{h.title}</span><span className="text-xs text-slate-500">{h.sub}</span></button></li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export type { Hit }
export function CustomerPicker(props: { value: Hit | null; onChange: (h: Hit | null) => void; error?: string; label?: string }) {
  return <Picker label={props.label ?? 'Customer'} placeholder="Search name, phone or customer ID" value={props.value} onChange={props.onChange} error={props.error}
    search={async (q) => (await apiPage<{ id: string; fullName: string; customerId: string; phone: string; status: string }>(`/customers${qs({ q, limit: 8, status: 'active' })}`)).data.map((c) => ({ id: c.id, title: c.fullName, sub: `${c.customerId} · ${c.phone}` }))} />
}
export function LoanPicker(props: { value: Hit | null; onChange: (h: Hit | null) => void; error?: string; statuses?: string }) {
  return <Picker label="Loan" placeholder="Search loan ID or customer" value={props.value} onChange={props.onChange} error={props.error}
    search={async (q) => (await apiPage<{ id: string; loanId: string; customer: { fullName?: string }; outstandingBalance: number; status: string }>(`/loans${qs({ q, limit: 8, status: props.statuses ?? 'active,overdue,defaulted' })}`)).data.map((l) => ({ id: l.id, title: `${l.loanId} · ${l.customer.fullName ?? ''}`, sub: `Outstanding ${formatMoney(l.outstandingBalance)}` }))} />
}
