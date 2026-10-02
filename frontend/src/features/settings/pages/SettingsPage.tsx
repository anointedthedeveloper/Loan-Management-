import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../../hooks/useAsync'
import { ErrorState, Skeleton } from '../../../components/ui/feedback'
import { SETTING_SECTIONS } from '../config'
import { settingsService } from '../services/settingsService'
import { SettingsForm } from '../components/SettingsForm'
import { ProductsPanel } from '../components/ProductsPanel'

export default function SettingsPage() {
  const { data, error, loading, reload } = useAsync(() => settingsService.all(), [])
  const [tab, setTab] = useState('company')
  const tabs = [...SETTING_SECTIONS.slice(0, 1), { key: 'products', label: 'Loan products' }, ...SETTING_SECTIONS.slice(1)]
  const section = SETTING_SECTIONS.find((s) => s.key === tab)
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold tracking-tight">Settings</h1><p className="text-sm text-slate-500">Business rules are stored in the database and take effect immediately. Every change is recorded in the audit log. Staff permissions are managed under <Link to="/staff" className="font-medium text-brand-700 hover:underline">Staff & Permissions</Link>.</p></div>
      <div className="grid gap-5 lg:grid-cols-4">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm lg:flex-col">
          {tabs.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition ${tab === t.key ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}>{t.label}</button>)}
        </nav>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          {tab === 'products' ? <ProductsPanel /> : error ? <ErrorState message={error} onRetry={reload} /> : loading || !data || !section ? <Skeleton className="h-64 w-full" />
            : <SettingsForm key={tab + JSON.stringify(data[tab])} section={section} initial={data[tab] ?? {}} onSaved={reload} />}
        </section>
      </div>
    </div>
  )
}
