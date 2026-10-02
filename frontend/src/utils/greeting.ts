/** Hour (0-23) in Nigeria, so the greeting is right regardless of the device's timezone. */
export function lagosHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(now))
}

export function greetingFor(now: Date = new Date()): string {
  const h = lagosHour(now)
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening'
}

const TITLES = new Set(['dr', 'dr.', 'prof', 'prof.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'chief', 'engr', 'engr.', 'barr', 'barr.', 'alhaji', 'alhaja', 'pastor', 'rev', 'hon', 'hon.', 'sir', 'madam'])

/** "Dr Peter Agunloye" -> "Dr Peter"; "Taiwo Oyegbata" -> "Taiwo". Keeps a leading title with the first name. */
export function greetingName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length > 1 && TITLES.has(parts[0]!.toLowerCase())) return `${parts[0]} ${parts[1]}`
  return parts[0] ?? ''
}
