import { useEffect, useState } from 'react'
import { customerService } from '../services/customerService'
import type { CustomerMeta } from '../types'

let cache: CustomerMeta | null = null

/** Reference data (statuses, ID types…) comes from the API so it is never duplicated in the UI. */
export function useCustomerMeta() {
  const [meta, setMeta] = useState<CustomerMeta | null>(cache)
  useEffect(() => {
    if (cache) return
    customerService.meta().then((m) => { cache = m; setMeta(m) }).catch(() => undefined)
  }, [])
  return meta
}
