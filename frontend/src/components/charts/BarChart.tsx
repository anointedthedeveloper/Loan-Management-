import { formatMoneyShort } from '../../utils/format'

interface Series { key: string; label: string; color: string }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return m ? `${MONTHS[Number(m) - 1]} ${y?.slice(2)}` : ym }
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

/** Dependency-free grouped bar chart over real API data. */
export function GroupedBarChart({ data, labelKey, series }: { data: Record<string, number | string>[]; labelKey: string; series: Series[] }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))
  const W = 560, H = 200, pad = { l: 44, r: 8, t: 8, b: 24 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const group = iw / Math.max(1, data.length), bar = Math.min(18, (group - 6) / series.length)
  const ticks = [0, 0.5, 1]
  const hasData = data.some((d) => series.some((s) => Number(d[s.key]) > 0))
  return (
    <div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">{series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Bar chart">
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - t)} y2={pad.t + ih * (1 - t)} stroke="#e2e8f0" /><text x={pad.l - 6} y={pad.t + ih * (1 - t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{compact(Math.round(max * t))}</text></g>)}
        {data.map((d, i) => (
          <g key={String(d[labelKey])}>
            {series.map((s, j) => {
              const v = Number(d[s.key]) || 0, h = (v / max) * ih
              const x = pad.l + i * group + (group - bar * series.length) / 2 + j * bar
              return <rect key={s.key} x={x} y={pad.t + ih - h} width={bar - 1} height={Math.max(h, v > 0 ? 1 : 0)} rx="2" fill={s.color}><title>{`${d[labelKey]} · ${s.label}: ${formatMoneyShort(v)}`}</title></rect>
            })}
            <text x={pad.l + i * group + group / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">{monthLabel(String(d[labelKey]))}</text>
          </g>
        ))}
      </svg>
      {!hasData && <p className="-mt-2 pb-2 text-center text-xs text-slate-400">No transactions in this period yet.</p>}
    </div>
  )
}

/** Horizontal bars for a single measure (e.g. outstanding by status). */
export function HorizontalBars({ items, format = formatMoneyShort }: { items: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="mt-4 space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex justify-between text-sm"><span>{i.label}</span><span className="font-medium">{format(i.value)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}
