import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { LoanMeta } from '../types/finance'

let cache: LoanMeta | null = null
let inflight: Promise<LoanMeta> | null = null

/** Statuses, frequencies, payment methods and transaction types come from the API. */
export function useLoanMeta() {
  const [meta, setMeta] = useState<LoanMeta | null>(cache)
  useEffect(() => {
    if (cache) return
    inflight ??= api<LoanMeta>('/loans/meta').then((m) => (cache = m))
    inflight.then(setMeta).catch(() => { inflight = null })
  }, [])
  return meta
}
