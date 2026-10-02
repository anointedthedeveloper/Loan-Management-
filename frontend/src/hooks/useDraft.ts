import { useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from '../utils/draft'

/**
 * Autosaves `value` (debounced) under `key` and offers it back on the next visit.
 * `key = null` disables drafts (e.g. when editing an existing record).
 */
export function useDraft<T>(key: string | null, value: T, isEmpty: (v: T) => boolean) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (!key) return
    if (first.current) { first.current = false; return } // don't overwrite a stored draft with the empty initial form
    const t = setTimeout(() => {
      if (isEmpty(value)) { clearDraft(key); setSavedAt(null) } else { saveDraft(key, value); setSavedAt(Date.now()) }
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(value)])

  return {
    restoredAt, savedAt,
    load: () => (key ? loadDraft<T>(key) : null),
    markRestored: (at: number) => setRestoredAt(at),
    discard: () => { if (key) clearDraft(key); setRestoredAt(null); setSavedAt(null) },
    clear: () => { if (key) clearDraft(key) },
  }
}
