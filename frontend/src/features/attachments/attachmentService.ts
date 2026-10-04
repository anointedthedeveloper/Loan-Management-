import { api, download, fetchBlob, uploadFile } from '../../services/api'
import type { Attachment } from '../../types/finance'

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt'
export const MAX_BYTES = 4 * 1024 * 1024

export const attachmentService = {
  upload: (file: File, target: { loanId?: string; transactionId?: string }) => {
    const q = new URLSearchParams({ filename: file.name, ...(target.loanId ? { loanId: target.loanId } : {}), ...(target.transactionId ? { transactionId: target.transactionId } : {}) })
    return uploadFile<{ attachment: Attachment }>(`/attachments?${q}`, file).then((r) => r.attachment)
  },
  discard: (id: string) => api(`/attachments/${id}`, { method: 'DELETE', silent: true }),
  blob: (a: Attachment) => fetchBlob(`/attachments/${a.id}`),
  download: (a: Attachment) => download(`/attachments/${a.id}`, a.filename),
}
