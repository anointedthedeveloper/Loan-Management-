const NAMES: Record<string, string> = {
  ceo: 'Dashboard', accountant: 'Dashboard', customers: 'Customers', loans: 'Loans', products: 'Loan products', repayments: 'Repayments', transactions: 'Transactions',
  topups: 'Top-ups', monthly: 'Monthly upload', faq: 'Help & FAQ', reports: 'Reports', staff: 'Staff & Permissions', audit: 'Audit log', settings: 'Settings',
}
const isId = (s: string) => /^[a-f\d]{24}$/i.test(s)

/** "/loans/64b.../statement" -> "Loan statement" — a readable name for the audit log. */
export function pageTitle(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)
  if (!seg.length) return 'Home'
  const base = NAMES[seg[0]!] ?? seg[0]!
  const singular = base.replace(/s$/, '').replace(/ie$/, 'y')
  const rest = seg.slice(1)
  if (!rest.length) return base
  if (seg[0] === 'loans' && rest[0] === 'completed') return 'Completed loans'
  if (rest[0] === 'new') return `New ${singular.toLowerCase()}`
  if (isId(rest[0]!)) return rest[1] ? `${singular} ${rest[1]}` : `${singular} details`
  return `${base} ${rest.join(' ')}`
}
