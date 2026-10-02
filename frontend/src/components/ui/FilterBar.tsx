import { Search, X } from 'lucide-react'
import type { Option } from '../../types'
import { MoneyInput } from './MoneyField'

export type FilterDef =
  | { key: string; type: 'search'; placeholder: string }
  | { key: string; type: 'select'; label: string; options: readonly Option[]; all?: string }
  | { key: string; type: 'date' | 'number' | 'money'; label: string; placeholder?: string }

const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'

export function FilterBar({ defs, value, onChange }: { defs: FilterDef[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const set = (k: string, v: string) => onChange({ ...value, [k]: v })
  const dirty = defs.some((d) => value[d.key])
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
      {defs.map((d) => d.type === 'search' ? (
        <div key={d.key} className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input aria-label="Search" value={value[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} placeholder={d.placeholder} className={`${input} w-full pl-9`} /></div>
      ) : d.type === 'select' ? (
        <label key={d.key} className="text-xs font-medium text-slate-500">{d.label}
          <select value={value[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} className={`${input} mt-1 block`}><option value="">{d.all ?? 'All'}</option>{d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      ) : d.type === 'money' ? (
        <label key={d.key} className="text-xs font-medium text-slate-500">{d.label}
          <MoneyInput value={value[d.key] ?? ''} onChange={(v) => set(d.key, v)} placeholder={d.placeholder} className={`${input} mt-1 block w-36 tabular-nums`} /></label>
      ) : (
        <label key={d.key} className="text-xs font-medium text-slate-500">{d.label}
          <input type={d.type} value={value[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} placeholder={d.placeholder} className={`${input} mt-1 block ${d.type === 'number' ? 'w-32' : ''}`} /></label>
      ))}
      {dirty && <button onClick={() => onChange(Object.fromEntries(defs.map((d) => [d.key, ''])))} className="flex items-center gap-1 pb-2 text-sm font-medium text-brand-600 hover:underline"><X className="size-4" />Clear</button>}
    </div>
  )
}
