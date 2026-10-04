import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { pendingStore } from '../../services/api'

const MIN_VISIBLE_MS = 700 // on a fast network the bar would flash by unseen, so once shown it stays at least this long
const ROUTE_MS = 600       // every page change also runs the bar, so navigation always feels acknowledged

/** Progress bar across the top: shows instantly on any server request or page change and never disappears faster than MIN_VISIBLE_MS. */
export function GlobalLoader() {
  const pending = useSyncExternalStore(pendingStore.subscribe, pendingStore.get)
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = () => { clearTimeout(hideTimer.current); if (!visible) shownAt.current = Date.now(); setVisible(true) }
  const hideWhenReady = (min: number) => {
    clearTimeout(hideTimer.current)
    const wait = Math.max(0, shownAt.current + min - Date.now())
    hideTimer.current = setTimeout(() => setVisible(false), wait)
  }

  useEffect(() => { // page change
    show(); hideWhenReady(ROUTE_MS)
    return () => clearTimeout(hideTimer.current)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // server requests
    if (pending > 0) show(); else if (visible) hideWhenReady(MIN_VISIBLE_MS)
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null
  return (
    <div role="progressbar" aria-label="Loading" className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] overflow-hidden bg-brand-100">
      <div className="h-full w-1/3 animate-[loader_1s_ease-in-out_infinite] rounded-full bg-brand-600" />
    </div>
  )
}
