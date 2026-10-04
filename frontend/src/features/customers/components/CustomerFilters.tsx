import { Search, X } from 'lucide-react'
import type { CustomerMeta } from '../types'

export interface Filters { q: string; status: string; from: string; to: string }
const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'

export function CustomerFilters({ value, meta, onChange }: { value: Filters; meta: CustomerMeta | null; onChange: (f: Filters) => void }) {
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  const dirty = value.q || value.status || value.from || value.to
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input aria-label="Search customers" value={value.q} onChange={set('q')} placeholder="Search name, IPPIS no., phone, email or ID" className={`${input} w-full pl-9`} />
      </div>
      <label className="text-xs font-medium text-slate-500">Status
        <select value={value.status} onChange={set('status')} className={`${input} mt-1 block`}>
          <option value="">All statuses</option>
          {meta?.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-500">Registered from<input type="date" value={value.from} onChange={set('from')} className={`${input} mt-1 block`} /></label>
      <label className="text-xs font-medium text-slate-500">to<input type="date" value={value.to} onChange={set('to')} className={`${input} mt-1 block`} /></label>
      {dirty && <button onClick={() => onChange({ q: '', status: '', from: '', to: '' })} className="flex items-center gap-1 pb-2 text-sm font-medium text-brand-600 hover:underline"><X className="size-4" />Clear</button>}
    </div>
  )
}
