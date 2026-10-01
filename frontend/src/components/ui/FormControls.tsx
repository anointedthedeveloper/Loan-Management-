import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { Option } from '../../types'

const base = 'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-ink transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'

export function SelectField({ label, options, error, placeholder = 'Select…', ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: readonly Option[]; error?: string; placeholder?: string }) {
  const id = `s-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <select id={id} aria-invalid={!!error} className={`${base} ${error ? 'border-red-400' : 'border-slate-300'}`} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function TextareaField({ label, error, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const id = `t-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <textarea id={id} rows={3} aria-invalid={!!error} className={`${base} ${error ? 'border-red-400' : 'border-slate-300'}`} {...rest} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}
