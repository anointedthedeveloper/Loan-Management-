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
| 3 Loan products, loan creation, approval | **Done** |
| 4 Calculation engine, repayment schedules | **Done** (defaults mirror the reference calculator — see assumptions) |
| 5 Transactions, repayments, balance engine | **Done** |
| 6 Top-ups | **Done** (consolidate / new-loan modes; `extend` not implemented) |
| 7 Reports, dashboards | **Done** (CSV / Excel / PDF export) |
| 8 Audit log, settings, automation | **Done** |
| 9 Security hardening, tests, deployment | **Done** (118 backend tests) |

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

## Deploying to Vercel (two separate projects)
**Backend** (project root directory: `backend`) — uses `backend/vercel.json` + `backend/api/index.js` (serverless entry that serves the compiled app from `dist/`; build command `npm run build`).
Set these environment variables in Vercel, then redeploy:
- `MONGODB_URI` — e.g. a MongoDB Atlas string. In Atlas > Network Access allow `0.0.0.0/0` (Vercel IPs are dynamic) and use a least-privilege DB user.
- `JWT_SECRET` — 32+ random characters.
- `CORS_ORIGINS` — your frontend URL(s), comma-separated, e.g. `https://protech-portal.vercel.app` (no trailing slash).
- `NODE_ENV=production`; optional: `JWT_EXPIRES_IN`, `JWT_REMEMBER_EXPIRES_IN`, `BCRYPT_ROUNDS`.
Check: `https://<backend>.vercel.app/api/health`. A JSON 500 now says what is wrong (missing variable names, or DB unreachable — see function logs).
Seed the first users once from your machine: `MONGODB_URI=<atlas uri> npm run seed` (demo data; change or delete these accounts before real use).

**Frontend** (root directory: `frontend`) — set `VITE_API_URL=https://<backend>.vercel.app/api` at build time. `frontend/vercel.json` adds the SPA rewrite so page refreshes don't 404.

## Phases 3-9: how it works
- **Ledger first.** `Transaction` is an append-only ledger. A loan's paid amount, principal/interest balances, schedule statuses and loan status are *replayed* from the ledger (`finance/BalanceService.ts` + `loanLedger.service.ts`), so a reversal is just "replay without that payment". Customer totals and dashboards are aggregated from loans and the ledger — nothing is typed in by hand.
- **Engine** (`backend/src/services/finance/`, pure and unit-tested): `LoanCalculationService` (flat interest), `ScheduleService` logic inside it, `RepaymentAllocationService`, `BalanceService`, `LoanStatusService`, `TopUpCalculationService`. The frontend only displays server results (`/loans/preview`, `/topups/preview`).
- **Configurable rules** live in the database (`Settings` screen, `config/defaultSettings.ts`): approval flow, allocation order, overpayment policy, grace/default days, top-up mode and bases, reference requirements.
- **Automation**: loans created -> terms + schedule; approval -> disbursement entry + activation; repayment -> ledger + replay + audit. Overdue/completed/defaulted are refreshed hourly on long-running hosts and by `GET /api/jobs/refresh-overdue` (Vercel Cron daily at 02:00 UTC, enabled by setting `CRON_SECRET`).
- **Demo data**: `npm run dev:memory` (or `npm run seed`) builds users, products, customers and loans *through the real services* (active, overdue, completed, pending and a top-up). Flagged `isDemoData`.

## Assumptions that need Protech confirmation (all isolated and configurable)
1. **Flat interest as in the reference calculator**: gross = net / (1 - bank deduction); interest = principal x rate x months; installment = total / tenor, kobo remainder on the last installment. Rate basis (per month / per annum / per loan), the 30-day month used for days/weeks, and rounding are single functions in `LoanCalculationService.ts`.
2. **Repayment allocation** default: oldest installment first, interest before principal; overpayments rejected. Change in Settings.
3. **Top-up** default: outstanding balance + new funds become one new loan (calculator "Balance B/Fwd"), old loan closed by a non-cash settlement entry, interest recalculated on the whole new principal. Alternatives (principal-only carry, interest on new funds only, separate loan, minimum % repaid) are settings.
4. **Late penalties are NOT implemented** (no rule supplied). Grace days and auto-default days are. Fees/adjustments/refunds are recorded in the ledger but do not change loan balances until a rule exists.
5. **Verified against Protech's own loan book** (`complete_loan_book.xlsx`): gross payment, principal, interest, gross loan and EMI for its rows are reproduced exactly (see the "matches Protech's loan book" tests). Findings applied: 5% per month flat, 4% bank deduction, interest on balance b/fwd + new money, EMI rounded to the nearest kobo (last installment absorbs the difference), repayments starting on a chosen first-payment date, loan type new / renewal / top-up, IPPIS number and ministry on customers. Still unknown from the sheet: whether a top-up carries the outstanding *total* or *principal* (default: total, configurable).
6. Known advisory: `npm audit` reports 2 moderate issues via `exceljs -> uuid` (only exploitable when callers pass a buffer to uuid; this app does not). Revisit when exceljs releases a fix.

## Deployment environment variables (backend)
`MONGODB_URI`, `JWT_SECRET` (32+ chars), `CORS_ORIGINS`, `NODE_ENV=production`, optional `CRON_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`. Frontend: `VITE_API_URL=https://<backend>/api`.

## First login on a new deployment (no local MongoDB access needed)
Set `CRON_SECRET` (16+ chars) in the backend's environment variables, redeploy, then create the first CEO once:
```bash
curl -X POST https://<backend>/api/jobs/bootstrap \
  -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" \
  -d '{"name":"Your Name","email":"you@company.com","username":"ceo","password":"<10+ chars, upper, lower, number>"}'
```
It only works while the database has no users. Create the accountant afterwards from Staff & Permissions.
