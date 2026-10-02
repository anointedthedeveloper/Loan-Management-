import { useEffect, useState, useSyncExternalStore } from 'react'
import { pendingStore } from '../../services/api'

/** Thin progress bar across the top whenever the app is waiting on the server (shown after a short delay to avoid flicker). */
export function GlobalLoader() {
  const pending = useSyncExternalStore(pendingStore.subscribe, pendingStore.get)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (pending === 0) { setShow(false); return }
    const t = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [pending])
  if (!show) return null
  return (
    <div role="progressbar" aria-label="Loading" className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-1 overflow-hidden bg-brand-100">
      <div className="h-full w-1/3 animate-[loader_1.1s_ease-in-out_infinite] rounded-full bg-brand-600" />
    </div>
  )
}
