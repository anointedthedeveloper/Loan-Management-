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
| 2–9 | Pending; folders and mount points exist |

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
