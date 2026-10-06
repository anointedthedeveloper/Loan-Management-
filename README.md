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
**Production** uses `npm run seed:users` instead: it creates/updates the real accounts (Dr Peter Agunloye - CEO, Taiwo Oyegbata - accountant) with no demo data. `npm run seed` (demo loans) refuses to run against a hosted/production database.

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

## Approval flow (who approves what)
- **CEO / anyone holding `loans.approve`** creating a loan (or `topups.approve` requesting a top-up): approved and disbursed immediately; the approval and disbursement are still written to the ledger and audit log.
- **Accountants** (default permission `loans.create`) submit loans and top-ups for approval; the CEO approves or rejects them. The settings `requireApproval` / `autoDisburseOnApproval` still apply.

## Marking a month paid and settling early
- **Mark paid** (schedule row): records a repayment for exactly what is still owed on that installment, targeted at it (`POST /loans/:id/installments/:n/pay`). Other months are untouched; reversing it from Transactions undoes it.
- **Settle loan** (`GET .../settlement-quote`, `POST .../settle`): closes the loan before its term ends. Rule is a setting (Settings > Repayment rules > Early settlement): `full_balance` (default, pay everything still owed) or `waive_future_interest` (interest on installments not yet due is written off as a non-cash `waiver` entry; requires `loans.approve`). Waived amounts never count as cash collected.

## Statements and the audit trail
- **Workflow**: register client -> enter loan -> record repayments -> balance is calculated from the ledger -> **Generate statement** (loan page, customer page).
- **Statement** (`GET /api/loans/:id/statement`, `GET /api/customers/:id/statement`; `format=json|pdf|xlsx|csv`, optional `from`/`to`): client information (IPPIS number, name, ministry), loan information (amount taken, principal, interest, total loan, EMI, payment/repayment dates) and the transaction statement with Date, Reference, Description, DR, CR and running Balance. Debit = what the client owes, credit = what reduces it; the closing balance always equals the loan balance (covered by tests). Reversals show as the original credit plus an offsetting debit.
- **Audit log** (CEO): records page visits (`PAGE_VIEW`), sign-ins/outs, statement generation and every change, each with person, role, time and IP. Filter by what (changes / pages / sign-ins), role, account, action, record type, date and search; export to CSV.

## Performance notes (hosted deployment)
- **Run the backend in the same region as MongoDB.** The Atlas cluster is in `eu-west-3` (Paris), so `backend/vercel.json` pins the function to `cdg1`. Each database call is then milliseconds instead of ~90 ms across the Atlantic; pages make 3-30 database calls.
- The dashboard runs its queries concurrently, settings are cached for 30 s per server instance, loans are recalculated once a day / on payment (not on every view), and the Excel/PDF libraries are loaded only when an export is requested (faster cold starts). `npm run measure` prints the database calls per endpoint.
- Set `VITE_API_URL=https://<backend>/api` on the frontend project to call the backend directly. Without it the frontend proxies `/api` through its own host (works, but adds a hop).
- The PDF library reads font files at runtime; `vercel.json` bundles them explicitly (`includeFiles`), otherwise PDF exports fail on Vercel.

## Interest (flat, one-time)
Interest is worked out once on the original principal: monthly interest = principal x rate, total interest = monthly interest x tenor (never on a reducing balance). It is added to the loan (Gross Loan) and repaid through the equal monthly installments (EMI = Gross Loan / tenor). The worked example from the calculator site (OKOH ABBA EMMANUEL: 100,000.00 / 136,012.38 / 81,607.43 / 217,619.81 / 18,134.98) is a test. A product can instead use "% of principal for the whole loan" as its rate basis if a flat single percentage is ever wanted.

## Loan book Excel
Reports > "Loan book (monthly breakdown)" (or Loans > "Loan book (Excel)") exports one row per loan in Protech's loan-book layout with live calculator formulas (`=ROUND(I5/0.96,2)`, `=ROUND(K5*5%*F5,2)`, ...), a column per month of repayments, Repayment to date and Balance. Every loan statement's Excel also has a "Monthly breakdown" sheet.

## Repayment cycle, proof of payment and loan rules

- **Monthly cycle:** the first installment is due in the month after the loan starts (whatever day it started), the payment window opens on the 25th and the due date is the 30th (28/29 in February). Set in `REPAYMENT_CYCLE` (`backend/src/config/loanOptions.ts`). Loans with a custom first-payment date keep it.
- **Proof of payment:** repayments, "mark installment paid" and settlements accept uploaded files (PDF, PNG/JPG, Word, Excel; 4 MB each, 5 per payment). Files are stored in MongoDB (`Attachment`) because serverless hosting has no disk, and are downloadable from the payment.
- **Editing money:** the amount in "mark as paid" is editable. A recorded repayment is corrected with `POST /api/repayments/:id/edit` (permission `repayments.edit`, CEO by default): the original is reversed, a linked replacement is posted, proof files move to it, and the reason is audited.
- **One open loan per customer:** a customer with a pending or running loan cannot get another; the API answers `EXISTING_LOAN` and the UI points to a top-up. The limit is configurable in Settings > Loans.
- **Completed loans** are listed under *Completed loans*, not *Loans* (`GET /api/loans?scope=completed`).
- **Admin edits:** the CEO (`loans.editActive`) can edit running loans (terms, rates); the schedule is rebuilt and recorded repayments are replayed. Accountants edit pending loans only.
- **Customers:** NIN and BVN (11 digits each, unique) are required; government workers also need an IPPIS number (unique, searchable); non-government workers don't.

## One-time interest and current-loan documents

- **Interest is a one-time flat charge** (default rate basis `per_loan`): 5% of ₦1,000,000 = ₦50,000, total ₦1,050,000, regardless of tenor. Products saved earlier are moved to it once; the CEO can still pick another basis per product, and can switch a running loan's basis when editing it. The bank-deduction gross-up (÷ 0.96) still applies if a product sets one; set it to 0 for a plain 5% of the amount.
- **Downloads use current loans:** the loan book and the loan report list each customer's open loan only; a client statement shows the current loan (the latest completed one if none is open), with "Include completed loans" for the full history.

## Overpayment tolerance, previews and statements with proofs

- A payment may exceed what is owed by up to `repayment.overpaymentTolerance` (default ₦1,000; Settings > Repayment rules): ₦30,000 sent for ₦29,999.82 clears the loan and the excess is held as credit.
- The schedule shows unpaid installments first (due order) and paid ones below.
- Uploads preview before saving; clicking a payment shows its proof with preview and download.
- Statement PDFs can include the uploaded proofs (`?includeUploads=true`, PDF only): images and PDF pages are appended as captioned pages; Word/Excel files are listed on a note page. Responses are capped near 4 MB (serverless limit).

## Customer sheet import, client numbers and incomplete profiles

- **Client numbers are customer IDs:** client 640 is `PTC-000640`. New customers continue after the highest number (the counter never goes below 640).
- **Import:** CEO (permission `customers.import`) uses *Customers > Import from Excel* (a dry run shows what will happen first), or runs `npm run import:customers -- file.xlsx [--dry-run]` with `MONGODB_URI` set. Rows with an IPPIS number are government workers; without one they are non-government and the MINISTRY column is their organisation. Duplicate or missing client numbers get a free/new number and are listed in the report. Re-running is safe (existing IPPIS numbers only have empty details filled in).
- **Incomplete profiles:** imported customers lack phone, address, NIN, BVN, date of birth, marital status, next of kin... Each profile lists what is missing (banner, badge, *Profile: Incomplete* filter and a dashboard reminder). Staff can fill details piece by piece; registering a new customer in the app still requires them all.

## Top-up (liquidation) formula and monthly upload

- **Liquidation formula** (Settings > Top-up rules, now the default): (a) loan taken, (b) revised tenor = months actually used, (c) revised cost = (a) × (1 + rate × (b)), (d) repaid to date, (e) outstanding = (c) − (d), (f) fee = 5% of (e), (g) amount due = (e) + (f). (g) is carried into the new loan as its balance brought forward; the new loan is priced on (g) + the new funds. A one-time-interest loan keeps its full cost. The months used can be overridden in the top-up request.
- **Monthly upload** (*Monthly upload* page, needs `loans.create`): the month's loans taken in the book's columns (Clients ID, Clients Name, IPPIS NO, MINISTRY, Tenor, Payment Date, Balance B/Fwd, Bank payment, EMI, Start Date, Status NEW / TOP UP / RENEWAL). Rows are matched to customers by client number **and** IPPIS (a mismatch is refused); gross = bank ÷ (1 − deduction), principal = B/Fwd + gross; the EMI in the sheet is respected (total = EMI × tenor). TOP UP rows liquidate the customer's running loan. Uploaders without `loans.approve` create **pending** loans: the CEO edits and approves them (a top-up only liquidates the old loan on approval).
- **Customer register** (report `customer-register`, also on the Monthly upload page): every customer once with client ID, IPPIS, status and current loan in the same layout.

## Editable monthly sheet and the FAQ

- The **register download is the upload format.** Download it (Monthly upload → Register, Excel), edit cells, upload it back. Rows are matched by Clients ID and IPPIS NO. Differing customer details (name, IPPIS, ministry, phone, address, NIN, BVN, date of birth, marital status, next of kin phone) are updated; blank cells never erase. A row with a **Loan ID** edits that customer's current loan (tenor, bank payment, B/Fwd, dates, EMI; the CEO for running loans); a row **without** a Loan ID that has loan figures is a new loan (NEW / RENEWAL, or TOP UP). Untouched rows are never changed, whatever rounding the EMI implies.
- Accountants now get `customers.update` by default (one-time grant for existing accounts) so they can complete profiles.
- The per-page "About this page" panels were replaced by one searchable **Help & FAQ** page (`frontend/src/features/help/faq.ts`).
