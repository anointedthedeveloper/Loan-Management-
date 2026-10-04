import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES } from '../config/permissions.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    permissions: { type: [String], default: [] },
    /** Which PERMISSION_GRANTS have been applied to this account (absent = none). */
    grantsVersion: { type: Number },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: import('mongoose').Types.ObjectId };
export const User = model('User', userSchema);
