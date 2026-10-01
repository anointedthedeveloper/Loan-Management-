# Protech Loan Management Portal

Internal loan-management system. `/backend` (Express + MongoDB, TypeScript) and `/frontend` (React + Vite + Tailwind) are independent and deployable separately.

## Run locally
```bash
# Backend (needs MongoDB; or use the in-memory option below)
cd backend && cp .env.example .env && npm i
npm run dev:memory      # throwaway in-memory DB + demo users, no MongoDB install needed
# or: npm run seed && npm run dev   (uses MONGODB_URI)
npm test && npm run typecheck

# Frontend
cd frontend && npm i && npm run dev   # http://localhost:5173, proxies /api -> :4000
```
Demo users (development data only, `isDemoData: true`): `ceo` / `accountant`; passwords come from `SEED_*` env vars.

## Phase status
| Phase | Status |
|---|---|
| 1 Setup, auth, roles/permissions, layouts, DB | **Done** |
| 2 Customers & full staff management | **Done** |
| 3–9 | Pending; extension points exist (see below) |

## Architecture notes
- **Permissions** live in `backend/src/config/permissions.ts` (single catalogue). Routes guard with `requirePermission()`; CEO always has all. The user is re-read from the DB on every request, so deactivation and permission changes apply immediately. The frontend `can()` is cosmetic only.
- **Responses** are `{ success, message, data }` / `{ success:false, message, code, errors? }`; no stack traces leak.
- **Security**: bcrypt, JWT, helmet, CORS allow-list, login rate limit + account lockout (5 fails -> 15 min), zod validation, audit log of auth/staff actions.
- **Planned extension points** (Phases 3-6), each a service so rules can change without rewrites: `LoanCalculationService`, `RepaymentAllocationService`, `TopUpCalculationService`, `LoanStatusService`, `BalanceService`, `TransactionService`. Rules will be DB-backed `SystemSetting`s where possible.

## Reference calculator findings (https://flatinterestcalculator.vercel.app/)
As published on the page: `Gross payment = Bank payment / (1 - deduction)` (default 0.96), `Principal = Balance B/Fwd + Gross payment`, `Interest = Principal x monthly flat rate x Tenor`, `Gross loan = Principal + Interest`, `EMI = Gross loan / Tenor`. It is a **monthly** flat rate, and top-ups are modelled as "Balance B/Fwd" added to principal.

## Open items needing input
1. **The Excel file was not in the repository** (it was empty). Add it so the engine can be verified against it.
2. Does the bank-deduction gross-up apply to every Protech loan or only some products?
3. Interest rate basis (monthly vs annual), rounding rules, repayment allocation order (interest-first vs principal-first).
4. Password reset: no email provider is configured; the forgot-password endpoint is a safe stub (CEO resets passwords in Staff & Permissions).
5. Login slideshow uses bundled SVG scenes. Drop real photos in `frontend/public/login/` and update `SLIDES` in `LoginPage.tsx`.

## Phase 2 notes
- **Customers**: `PTC-######` IDs from an atomic counter (`models/Counter.ts`); phone/email/ID uniqueness enforced both in `customer.service.ts` and by partial unique indexes. Search, status/date filters, sorting and pagination run server-side. Statuses/ID types/genders are data in `backend/src/config/customerOptions.ts` and served via `GET /api/customers/meta`.
- **Soft delete**: `DELETE /api/customers/:id` archives (never physically removes) and is refused with `CUSTOMER_HAS_FINANCIAL_HISTORY` when any financial history exists. History is detected through `services/customerFinancials.service.ts`, a provider seam that Phases 3-5 will implement; until then financial endpoints return empty data (nothing is fabricated).
- **Permissions** were renamed for customers: `customers.read/create/update/delete/viewFinancials`. They are grouped by module in `config/permissions.ts` and the UI renders groups from `GET /api/users/permissions`.
- **Staff**: `staff.service.ts` protects the last active CEO (deactivate / demote / delete / restrict) and self-lockout; password reset is a dedicated audited endpoint (supply a password or let the server generate a one-time temporary one) and invalidates existing sessions.
- **Audit**: action names are constants in `config/auditActions.ts` (`CUSTOMER_CREATED`, `STAFF_PERMISSION_CHANGED`, ...); entries carry before/after diffs and never include secrets. Phase 1 action names were migrated to the same style (`LOGIN`, `LOGIN_FAILED`, ...).
- **Finance contracts**: `services/finance/contracts.ts` declares (interfaces only) the services that will hold Protech's rules. No financial rule is implemented.
- Limitations: staff changes (e.g. last-CEO check) are check-then-write, not transactional; PATCH of the nested `employment` / `emergencyContact` objects replaces the whole object.
