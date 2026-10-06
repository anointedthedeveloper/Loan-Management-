import { Schema, model } from 'mongoose';

/** One uploaded monthly sheet of loans taken, with what happened to each row. */
const schema = new Schema(
  {
    filename: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
    needsApproval: Boolean, // loans were created as pending because the uploader cannot approve
    total: Number, created: Number, skipped: Number,
    rows: [{ _id: false, row: Number, name: String, clientId: String, ippis: String, kind: String, loan: String, loanRef: String, status: String, messages: [String] }],
  },
  { timestamps: true },
);
schema.index({ createdAt: -1 });
export const MonthlyUpload = model('MonthlyUpload', schema);
