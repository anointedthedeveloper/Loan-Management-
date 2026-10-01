import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> { label: string; error?: string; right?: ReactNode }

export const Field = forwardRef<HTMLInputElement, Props>(({ label, error, right, id, className = '', ...rest }, ref) => {
  const fid = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          id={fid}
          aria-invalid={!!error}
          aria-describedby={error ? `${fid}-err` : undefined}
          className={`block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${error ? 'border-red-400' : 'border-slate-300'} ${right ? 'pr-11' : ''} ${className}`}
          {...rest}
        />
        {right && <div className="absolute inset-y-0 right-0 flex items-center pr-3">{right}</div>}
      </div>
      {error && <p id={`${fid}-err`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
})
