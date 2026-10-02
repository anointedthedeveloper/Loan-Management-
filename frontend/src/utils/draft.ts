/** Unsaved-form drafts, kept in this browser only so a refresh or accidental navigation doesn't lose typing. */
const PREFIX = 'protech.draft.'
export interface Draft<T> { data: T; savedAt: number }

export function loadDraft<T>(key: string): Draft<T> | null {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as Draft<T>) : null } catch { return null }
}
export function saveDraft<T>(key: string, data: T) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() })) } catch { /* storage unavailable */ }
}
export function clearDraft(key: string) {
  try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
}
