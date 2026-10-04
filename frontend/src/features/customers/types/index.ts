import type { Option, Tone } from '../../../types'

export interface CustomerStatusOption { value: string; label: string; tone: Tone; canBorrow: boolean }
export interface CustomerMeta { statuses: CustomerStatusOption[]; idTypes: Option[]; genders: Option[]; employmentTypes: Option[] }

export interface Customer {
  id: string
  customerId: string
  firstName: string; middleName?: string; lastName: string; fullName: string
  phone: string; altPhone?: string; email?: string
  address: string; state?: string; lga?: string
  dateOfBirth?: string; gender?: string
  nin?: string; bvn?: string
  employment?: { sector?: 'government' | 'non_government'; employerName?: string; occupation?: string; ippisNumber?: string; ministry?: string }
  legacyId?: string
  emergencyContact?: { name?: string; relationship?: string; phone?: string }
  registrationDate: string
  status: string
  notes?: string
  createdBy?: { id: string; name: string } | string | null
  updatedBy?: { id: string; name: string } | string | null
  createdAt: string; updatedAt: string
}

export interface CustomerListParams { q?: string; status?: string; from?: string; to?: string; sort: string; order: 'asc' | 'desc'; page: number; limit: number }

/** Mirrors GET /customers/:id/summary. `available:false` means the finance modules have no data yet. */
export interface CustomerSummary {
  customerId: string
  available: boolean
  metrics: null | { totalBorrowed: number; totalRepaid: number; outstandingBalance: number; activeLoans: number; completedLoans: number; overdueLoans: number }
  message?: string
}
