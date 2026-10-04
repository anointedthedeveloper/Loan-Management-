import { Router } from 'express';
import express from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, ok } from '../utils/http.js';
import { actorOf } from '../controllers/customerController.js';
import { MAX_ATTACHMENT_BYTES, discardAttachment, getAttachmentFile, uploadAttachment } from '../services/attachment.service.js';

const r = Router();
r.use(authenticate);
/** The file is sent as the raw request body (Content-Type = the file's type); name/loan/transaction go in the query string. */
r.post('/', requirePermission('repayments.record', 'transactions.create'), express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    ok(res, { attachment: await uploadAttachment({ filename: q.filename ?? '', contentType: req.headers['content-type'] ?? '', data: req.body as Buffer, loanId: q.loanId, transactionId: q.transactionId }, actorOf(req)) }, 'File uploaded', 201);
  }));
r.get('/:id', requirePermission('repayments.view', 'transactions.view', 'loans.view'), asyncHandler(async (req, res) => {
  const a = await getAttachmentFile(String(req.params.id));
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${a.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(a.data);
}));
r.delete('/:id', requirePermission('repayments.record', 'transactions.create'), asyncHandler(async (req, res) => { await discardAttachment(String(req.params.id), actorOf(req)); ok(res, {}, 'File removed'); }));
export default r;
