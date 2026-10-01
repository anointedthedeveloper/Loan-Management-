import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    action: { type: String, required: true, index: true }, // e.g. "auth.login", "customer.created"
    entity: { type: String, index: true },
    entityId: { type: String, index: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export const AuditLog = model('AuditLog', auditLogSchema);
