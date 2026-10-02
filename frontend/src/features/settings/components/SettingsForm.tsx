import { useState } from 'react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { SelectField } from '../../../components/ui/FormControls'
import type { SettingSection } from '../config'
import { settingsService } from '../services/settingsService'

/** Generic, config-driven form for one settings section. */
export function SettingsForm({ section, initial, onSaved }: { section: SettingSection; initial: Record<string, unknown>; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState<Record<string, unknown>>(initial)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: string, val: unknown) => { setV((s) => ({ ...s, [k]: val })); setErrs((e) => ({ ...e, [k]: '' })) }
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)

  async function save() {
    setBusy(true); setErrs({})
    try { await settingsService.save(section.key, v); toast('success', `${section.label} settings saved`); onSaved() }
    catch (e) { if (e instanceof ApiError && e.fields) setErrs(e.fields); toast('error', e instanceof ApiError ? e.message : 'Could not save settings') }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-5">
      <div><h2 className="font-semibold">{section.label}</h2><p className="text-sm text-slate-500">{section.description}</p></div>
      <div className="grid gap-5 sm:grid-cols-2">
        {section.fields.map((f) => {
          const val = v[f.key]
          if (f.type === 'toggle') return (
            <label key={f.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 sm:col-span-2">
              <input type="checkbox" checked={!!val} onChange={(e) => set(f.key, e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
              <span><span className="text-sm font-medium">{f.label}</span>{f.help && <span className="block text-xs text-slate-500">{f.help}</span>}</span>
            </label>
          )
          if (f.type === 'select') return <div key={f.key}><SelectField label={f.label} options={f.options} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)} error={errs[f.key]} placeholder="Choose…" />{f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}</div>
          if (f.type === 'multi') return (
            <fieldset key={f.key} className="sm:col-span-2"><legend className="mb-2 text-sm font-medium text-slate-700">{f.label}</legend>
              <div className="flex flex-wrap gap-2">{f.options.map((o) => { const on = ((val as string[]) ?? []).includes(o.value); return (
                <label key={o.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}><input type="checkbox" checked={on} className="accent-brand-700" onChange={() => set(f.key, on ? (val as string[]).filter((x) => x !== o.value) : [...((val as string[]) ?? []), o.value])} />{o.label}</label>) })}</div></fieldset>
          )
          return <div key={f.key}><Field label={f.label} type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} value={val === null || val === undefined ? '' : String(val)} onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? (f.nullable ? null : '') : Number(e.target.value)) : e.target.value)} error={errs[f.key]} />{f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}</div>
        })}
      </div>
      <div className="flex justify-end"><Button onClick={save} loading={busy} disabled={!dirty}>Save changes</Button></div>
    </div>
  )
}
