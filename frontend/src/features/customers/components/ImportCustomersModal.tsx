import { useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { ApiError } from '../../../services/api'
import { useToast } from '../../../context/ToastContext'
import { Button } from '../../../components/ui/Button'
import { Modal, ModalActions } from '../../../components/ui/Modal'
import { customerService } from '../services/customerService'
import type { ImportReport } from '../types'

/** CEO tool: upload the client sheet, review what will happen (nothing is saved yet), then import. */
export function ImportCustomersModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(f: File) {
    setFile(f); setReport(null); setBusy(true)
    try { setReport(await customerService.importSheet(f, true)) } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Could not read the file'); setFile(null) } finally { setBusy(false) }
  }
  async function run() {
    if (!file) return
    setBusy(true)
    try { const r = await customerService.importSheet(file, false); toast('success', `Imported: ${r.created} created, ${r.updated} updated`); onDone() } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Import failed') } finally { setBusy(false) }
  }
  return (
    <Modal open wide title="Import customers from Excel" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">Use the client sheet (Clients ID, Clients Name, IPPIS NO, MINISTRY, phone no, Address, NIN, BVN, DATE OF BIRTH, MARITAL STATUS, NEXT OF KIN PHONE NO). Client numbers become customer IDs (client 640 = PTC-000640). Rows with an IPPIS number are government workers; rows without are non-government and the MINISTRY column is their organisation. Missing details are flagged on each profile so staff can complete them.</p>
        <input ref={input} type="file" accept=".xlsx" className="sr-only" id="import-file" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
        <label htmlFor="import-file" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:border-brand-500 hover:text-brand-700"><FileSpreadsheet className="size-4" />{file ? file.name : 'Choose the .xlsx file'}</label>
        {busy && !report && <p className="text-slate-500">Checking the file…</p>}
        {report && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([['Rows', report.total], ['Will be created', report.created], ['Already there', report.updated + report.unchanged], ['Skipped', report.skipped.length]] as [string, number][]).map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p><p className="text-xl font-bold tabular-nums">{v}</p></div>)}
            </div>
            <p className="text-slate-600">After this, the next new customer will be <b>{report.nextCustomerId}</b>.</p>
            {report.idChanges.length > 0 && <details open className="rounded-lg border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer font-medium text-amber-900">{report.idChanges.length} client number(s) changed or assigned</summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900">{report.idChanges.map((c) => <li key={c.row}>Row {c.row} · {c.name}: {c.from ?? 'no number'} → <b>{c.to}</b> ({c.reason})</li>)}</ul></details>}
            {report.skipped.length > 0 && <details open className="rounded-lg border border-red-200 bg-red-50 p-3"><summary className="cursor-pointer font-medium text-red-800">{report.skipped.length} row(s) will be skipped</summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-800">{report.skipped.map((c) => <li key={c.row}>Row {c.row} · {c.name}: {c.reason}</li>)}</ul></details>}
            {report.warnings.length > 0 && <p className="text-xs text-slate-500">{report.warnings.length} value(s) were not understood and will be left blank.</p>}
          </div>
        )}
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!report || report.created + report.updated === 0} loading={busy && !!report} loadingText="Importing…" onClick={run}>{report ? `Import ${report.created} customer${report.created === 1 ? '' : 's'}` : 'Import'}</Button>
        </ModalActions>
      </div>
    </Modal>
  )
}
