import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { FAQ } from './faq'

/** One searchable page that explains how everything works. */
export default function FaqPage() {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const sections = useMemo(() => FAQ.map((s) => ({ ...s, items: s.items.filter((i) => !needle || `${i.q} ${i.a.join(' ')}`.toLowerCase().includes(needle)) })).filter((s) => s.items.length), [needle])
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Help & FAQ</h1><p className="text-sm text-slate-500">How the portal works, in plain language.</p></div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input aria-label="Search the FAQ" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. top-up, IPPIS, approval" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
      </div>
      {!needle && <nav className="flex flex-wrap gap-2" aria-label="Sections">{FAQ.map((s) => <a key={s.id} href={`#${s.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:border-brand-500 hover:text-brand-700">{s.title}</a>)}</nav>}
      {sections.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Nothing matches "{q}".</p>}
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-4">
          <h2 className="mb-2 text-lg font-semibold">{s.title}</h2>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {s.items.map((i) => (
              <details key={i.q} className="group px-4 py-3" open={!!needle}>
                <summary className="cursor-pointer list-none text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden"><span className="mr-2 inline-block text-brand-600 transition group-open:rotate-90">›</span>{i.q}</summary>
                <div className="mt-2 space-y-2 pl-4 text-sm text-slate-600">{i.a.map((p) => <p key={p}>{p}</p>)}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
