export interface TabDef { key: string; label: string }

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
