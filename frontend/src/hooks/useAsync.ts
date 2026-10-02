import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../services/api'

/** Small loader with loading / error / reload state. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(() => {
    setLoading(true); setError('')
    run().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'Something went wrong')).finally(() => setLoading(false))
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload }
}
