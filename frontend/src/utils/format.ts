const tz = 'en-NG'
export const formatDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(tz, { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const formatDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString(tz, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
export const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')

/** CUSTOMER_STATUS_CHANGED -> "Customer status changed" */
export const humanizeAction = (a: string) => {
  const t = a.toLowerCase().replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

