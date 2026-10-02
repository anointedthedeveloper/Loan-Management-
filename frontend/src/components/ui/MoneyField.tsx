import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react'

/** "1234567.5" -> "1,234,567.5" (display only; the underlying value never contains commas). */
export const formatAmountInput = (raw: string) => {
  if (!raw) return ''
  const [int = '', dec] = raw.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec === undefined ? grouped : `${grouped}.${dec}`
}

/** Keeps digits and one decimal point, max 2 decimals, no stray leading zeros. */
export const cleanAmountInput = (input: string) => {
  let s = input.replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  if (s.startsWith('.')) s = '0' + s
  return s.replace(/^0+(?=\d)/, '')
}

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

/** Text input that shows thousands separators while typing and reports the clean numeric string. */
export function MoneyInput({ value, onChange, className = '', ...rest }: Base & { value: string; onChange: (raw: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const chars = useRef<number | null>(null) // digits/dots before the caret, restored after reformatting
  const display = formatAmountInput(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (chars.current === null || !el) return
    let count = 0, pos = 0
    while (pos < el.value.length && count < chars.current) { if (el.value[pos] !== ',') count++; pos++ }
    el.setSelectionRange(pos, pos)
    chars.current = null
  }, [display])

  return (
    <input
      ref={ref} inputMode="decimal" autoComplete="off" value={display} className={className} {...rest}
      onChange={(e) => {
        const el = e.target
        chars.current = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^\d.]/g, '').length
        onChange(cleanAmountInput(el.value))
      }}
    />
  )
}

/** Labelled naira field with live comma formatting. */
export function MoneyField({ label, value, onChange, error, id, ...rest }: Base & { label: string; value: string; onChange: (raw: string) => void; error?: string }) {
  const fid = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">₦</span>
        <MoneyInput id={fid} value={value} onChange={onChange} aria-invalid={!!error}
          className={`block w-full rounded-lg border bg-white py-2.5 pl-8 pr-3.5 text-sm tabular-nums text-ink placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${error ? 'border-red-400' : 'border-slate-300'}`} {...rest} />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
