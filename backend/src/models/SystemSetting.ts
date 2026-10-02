import { Schema, model } from 'mongoose';

/** One document per settings section (company, loans, repayment, ...); values override DEFAULT_SETTINGS. */
const schema = new Schema(
  { key: { type: String, required: true, unique: true }, value: { type: Schema.Types.Mixed, required: true }, updatedBy: { type: Schema.Types.ObjectId, ref: 'User' } },
  { timestamps: true },
);
export const SystemSetting = model('SystemSetting', schema);
