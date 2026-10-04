import { Schema, model } from 'mongoose';
import { DEFAULT_CUSTOMER_STATUS, isCustomerStatus } from '../config/customerOptions.js';
import { profileGaps } from '../services/customerProfile.js';

const str = { type: String, trim: true };

const customerSchema = new Schema(
  {
    customerId: { type: String, required: true, unique: true, immutable: true },
    firstName: { ...str, required: true },
    middleName: str,
    lastName: { ...str, required: true },
    fullName: { ...str, required: true },
    phone: str, // required when registering through the app; absent on profiles imported from the old loan book until someone fills it in
    altPhone: str,
    email: { ...str, lowercase: true },
    address: str,
    state: str,
    lga: str,
    dateOfBirth: Date,
    gender: str,
    maritalStatus: str,
    nin: str,
    bvn: str,
    idType: str, // legacy: generic ID captured before NIN and BVN became separate required fields
    idNumber: str,
    employment: { sector: { ...str, enum: ['government', 'non_government'] }, employmentType: str, employerName: str, occupation: str, ippisNumber: str, ministry: str }, // IPPIS no. / ministry as used in the loan book
    legacyId: str, // client number from the previous loan book
    emergencyContact: { name: str, relationship: str, phone: str },
    /** Labels of the profile details still missing (kept up to date on every save) so incomplete profiles can be listed and reminded. */
    profileMissing: { type: [String], default: undefined },
    registrationDate: { type: Date, default: Date.now },
    status: { ...str, default: DEFAULT_CUSTOMER_STATUS, validate: { validator: isCustomerStatus, message: 'Unknown customer status' } },
    notes: str,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Soft delete: financial history must stay auditable, so records are archived, not removed.
    isArchived: { type: Boolean, default: false },
    archivedAt: Date,
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);

customerSchema.pre('save', function () { this.profileMissing = profileGaps(this.toObject()); });

// Duplicate guards enforced by the database (race-proof), limited to non-archived records.
const live = { isArchived: false };
customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { ...live, phone: { $type: 'string' } }, name: 'uniq_phone' });
customerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { ...live, email: { $type: 'string' } }, name: 'uniq_email' });
customerSchema.index({ 'employment.ippisNumber': 1 }, { unique: true, partialFilterExpression: { ...live, 'employment.ippisNumber': { $type: 'string' } }, name: 'uniq_ippis' });
customerSchema.index({ nin: 1 }, { unique: true, partialFilterExpression: { ...live, nin: { $type: 'string' } }, name: 'uniq_nin' });
customerSchema.index({ bvn: 1 }, { unique: true, partialFilterExpression: { ...live, bvn: { $type: 'string' } }, name: 'uniq_bvn' });
customerSchema.index({ idType: 1, idNumber: 1 }, { unique: true, partialFilterExpression: { ...live, idNumber: { $type: 'string' } }, name: 'uniq_identification' });
// Listing / search / filter paths.
customerSchema.index({ isArchived: 1, status: 1, registrationDate: -1 });
customerSchema.index({ fullName: 1 });
customerSchema.index({ registrationDate: -1 });

export const Customer = model('Customer', customerSchema);
