import { Types } from 'mongoose';
import { Attachment } from '../models/Attachment.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import type { Statement } from './statement.service.js';

export interface Proof { transactionId: string; date: Date; amount: number; loanId: string; filename: string; mimeType: string; data: Buffer }

const MAX_PDF_BYTES = 4 * 1024 * 1024; // serverless responses are capped at about 4.5 MB

/** Proof-of-payment files for the payments shown on a statement (reversed payments excluded), oldest first. */
export async function collectProofs(s: Statement): Promise<Proof[]> {
  const ids = s.loans.map((l) => new Types.ObjectId(l.loan.id));
  if (!ids.length) return [];
  const files = await Attachment.find({ loan: { $in: ids }, transaction: { $exists: true } }).select('+data').sort({ createdAt: 1 });
  if (!files.length) return [];
  const txs = await Transaction.find({ _id: { $in: files.map((f) => f.transaction) }, reversedAt: { $exists: false } }).select('transactionId date amount loan');
  const byTx = new Map(txs.map((t) => [String(t._id), t]));
  const loanRef = new Map(s.loans.map((l) => [l.loan.id, l.loan.loanId]));
  const out: Proof[] = [];
  for (const f of files) {
    const t = byTx.get(String(f.transaction));
    if (!t) continue;
    if (s.period.from && t.date < s.period.from) continue;
    if (s.period.to && t.date > s.period.to) continue;
    out.push({ transactionId: t.transactionId, date: t.date, amount: t.amount, loanId: loanRef.get(String(t.loan)) ?? '', filename: f.filename, mimeType: f.mimeType, data: f.data });
  }
  return out.sort((a, b) => +a.date - +b.date || a.transactionId.localeCompare(b.transactionId));
}

const naira = (n: number) => `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kind = (p: Proof) => (p.mimeType === 'application/pdf' ? 'pdf' : p.mimeType === 'image/png' ? 'png' : p.mimeType === 'image/jpeg' ? 'jpg' : null);

/**
 * Appends the uploaded proofs to a finished statement PDF: each image or PDF page is placed on its own A4 page under a caption
 * (transaction, date, amount, file). Word/Excel/other files cannot be embedded; they are listed on a closing note page.
 */
export async function appendProofs(pdf: Buffer, proofs: Proof[], company: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const out = await PDFDocument.load(pdf);
  const font = await out.embedFont(StandardFonts.Helvetica); const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28; const H = 841.89; const M = 36; const TOP = 70;
  const green = rgb(0.043, 0.239, 0.18);
  const skipped: Proof[] = [];
  const caption = (page: ReturnType<typeof out.addPage>, p: Proof, extra = '') => {
    page.drawRectangle({ x: 0, y: H - 44, width: W, height: 44, color: green });
    page.drawText(`Proof of payment${extra}`, { x: M, y: H - 20, size: 11, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`${p.transactionId}  |  ${ymd(p.date)}  |  ${naira(p.amount)}  |  ${p.loanId}`, { x: M, y: H - 35, size: 8.5, font, color: rgb(0.75, 0.89, 0.8) });
    page.drawText(p.filename.slice(0, 90), { x: M, y: 24, size: 8, font, color: rgb(0.4, 0.45, 0.5) });
  };
  for (const p of proofs) {
    const k = kind(p);
    try {
      if (k === 'png' || k === 'jpg') {
        const img = k === 'png' ? await out.embedPng(p.data) : await out.embedJpg(p.data);
        const page = out.addPage([W, H]); caption(page, p);
        const box = { w: W - 2 * M, h: H - TOP - 50 }; const sc = Math.min(box.w / img.width, box.h / img.height, 1.6);
        page.drawImage(img, { x: (W - img.width * sc) / 2, y: H - TOP - img.height * sc, width: img.width * sc, height: img.height * sc });
      } else if (k === 'pdf') {
        const src = await PDFDocument.load(p.data, { ignoreEncryption: true });
        const usable = src.getPageIndices().filter((i) => !!src.getPage(i).node.Contents()); // blank pages cannot be embedded
        if (!usable.length) throw new Error('nothing to embed');
        const embedded = await out.embedPdf(src, usable);
        embedded.forEach((ep, i) => {
          const page = out.addPage([W, H]); caption(page, p, embedded.length > 1 ? ` (page ${i + 1} of ${embedded.length})` : '');
          const sc = Math.min((W - 2 * M) / ep.width, (H - TOP - 50) / ep.height);
          page.drawPage(ep, { x: (W - ep.width * sc) / 2, y: H - TOP - ep.height * sc, width: ep.width * sc, height: ep.height * sc });
        });
      } else skipped.push(p);
    } catch { skipped.push(p); } // a damaged file must not break the whole statement
  }
  if (skipped.length) {
    const page = out.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 44, width: W, height: 44, color: green });
    page.drawText('Uploaded files not shown in this document', { x: M, y: H - 28, size: 12, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`${company}: these files are kept in the portal but cannot be embedded in a PDF.`, { x: M, y: H - 70, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    skipped.forEach((p, i) => page.drawText(`${p.transactionId}  ${ymd(p.date)}  ${p.filename.slice(0, 70)}`, { x: M, y: H - 95 - i * 15, size: 9, font, color: rgb(0.1, 0.1, 0.1) }));
  }
  const bytes = Buffer.from(await out.save());
  if (bytes.length > MAX_PDF_BYTES) throw new AppError(413, 'The uploaded files make this PDF too large to download in one go. Choose a shorter date range, or download without the uploads.', 'PDF_TOO_LARGE');
  return bytes;
}
