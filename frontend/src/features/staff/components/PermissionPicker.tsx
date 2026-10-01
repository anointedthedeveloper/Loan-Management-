import type { PermissionGroup } from '../../../types'

/** Renders permissions grouped by module exactly as the API supplies them — add a permission on the server and it appears here. */
export function PermissionPicker({ groups, value, onChange, disabled }: { groups: PermissionGroup[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])
  const setGroup = (g: PermissionGroup, on: boolean) => {
    const keys = g.permissions.map((p) => p.key)
    onChange(on ? [...new Set([...value, ...keys])] : value.filter((k) => !keys.includes(k)))
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g) => {
        const selected = g.permissions.filter((p) => value.includes(p.key)).length
        const all = selected === g.permissions.length
        return (
          <fieldset key={g.key} className={`rounded-lg border p-3 ${selected ? 'border-brand-100 bg-brand-50/40' : 'border-slate-200'}`} disabled={disabled}>
            <legend className="sr-only">{g.label}</legend>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{g.label}</span>
              {g.permissions.length > 1 && !disabled && <button type="button" onClick={() => setGroup(g, !all)} className="text-xs font-medium text-brand-600 hover:underline">{all ? 'Clear' : 'Select all'}</button>}
            </div>
            <div className="space-y-1.5">
              {g.permissions.map((p) => (
                <label key={p.key} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={value.includes(p.key)} onChange={() => toggle(p.key)} className="size-4 accent-brand-700" />{p.label}
                </label>
              ))}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
