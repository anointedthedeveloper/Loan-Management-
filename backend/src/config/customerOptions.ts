/**
 * Customer reference data. Statuses are data, not code: add a row to introduce one.
 * `canBorrow` is the single flag later loan-eligibility rules read, so no other
 * file should compare against literal status strings.
 */
export const CUSTOMER_STATUSES = [
  { value: 'active', label: 'Active', tone: 'green', canBorrow: true },
  { value: 'inactive', label: 'Inactive', tone: 'slate', canBorrow: false },
  { value: 'suspended', label: 'Suspended', tone: 'amber', canBorrow: false },
  { value: 'blacklisted', label: 'Blacklisted', tone: 'red', canBorrow: false },
] as const;
export const DEFAULT_CUSTOMER_STATUS = 'active';
export const isCustomerStatus = (v: string) => CUSTOMER_STATUSES.some((s) => s.value === v);

export const ID_TYPES = [
  { value: 'nin', label: 'National ID (NIN)' },
  { value: 'bvn', label: 'BVN' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'voters_card', label: "Voter's card" },
  { value: 'international_passport', label: 'International passport' },
  { value: 'staff_id', label: 'Staff / work ID' },
  { value: 'other', label: 'Other' },
] as const;

export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;

export const EMPLOYMENT_TYPES = [
  { value: 'employed', label: 'Employed' },
  { value: 'civil_servant', label: 'Civil servant' },
  { value: 'self_employed', label: 'Self-employed / business owner' },
  { value: 'other', label: 'Other' },
] as const;
