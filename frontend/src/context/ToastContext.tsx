import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; message: string }
const Ctx = createContext<{ toast: (kind: Kind, message: string) => void } | null>(null)
let seq = 0

const styles: Record<Kind, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-brand-600' },
  error: { icon: AlertCircle, cls: 'text-red-600' },
  info: { icon: Info, cls: 'text-sky-600' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const dismiss = (id: number) => setItems((t) => t.filter((x) => x.id !== id))
  const toast = useCallback((kind: Kind, message: string) => {
    const id = ++seq
    setItems((t) => [...t, { id, kind, message }])
    setTimeout(() => dismiss(id), 4500)
  }, [])
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed right-4 top-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const { icon: Icon, cls } = styles[t.kind]
          return (
            <div key={t.id} className="flex animate-pop items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <Icon className={`mt-0.5 size-5 shrink-0 ${cls}`} />
              <p className="flex-1 text-sm text-slate-800">{t.message}</p>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used inside ToastProvider')
  return c.toast
}
