import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    userRole: { type: String, index: true }, // ceo / accountant ... so activity can be filtered by role
    action: { type: String, required: true, index: true }, // e.g. "auth.login", "customer.created"
    entity: { type: String, index: true },
    entityId: { type: String, index: true },
    entityLabel: String, // human-readable reference, e.g. PTC-000001
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export const AuditLog = model('AuditLog', auditLogSchema);
