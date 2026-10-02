const tz = 'en-NG'
export const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(tz, { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const formatDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString(tz, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
export const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')

/** CUSTOMER_STATUS_CHANGED -> "Customer status changed" */
export const humanizeAction = (a: string) => {
  const t = a.toLowerCase().replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}


const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ngn0 = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
/** Display only — every figure is calculated by the backend. */
export const formatMoney = (n?: number | null) => (typeof n === 'number' ? ngn.format(n) : '—')
export const formatMoneyShort = (n?: number | null) => (typeof n === 'number' ? ngn0.format(n) : '—')
export const formatNumber = (n?: number | null) => (typeof n === 'number' ? new Intl.NumberFormat('en-NG').format(n) : '—')
export const titleCase = (v: string) => v.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase())
