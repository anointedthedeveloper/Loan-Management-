import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute, dashboardPathFor } from './routes/ProtectedRoute'
import AppLayout from './layouts/AppLayout'
import LoginPage from './features/auth/LoginPage'
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const StaffListPage = lazy(() => import('./features/staff/pages/StaffListPage'))
const StaffDetailPage = lazy(() => import('./features/staff/pages/StaffDetailPage'))
const CustomersPage = lazy(() => import('./features/customers/pages/CustomersPage'))
const CustomerDetailPage = lazy(() => import('./features/customers/pages/CustomerDetailPage'))
const CustomerFormPage = lazy(() => import('./features/customers/pages/CustomerFormPage'))
import { PERM } from './config/permissions'
const LoansPage = lazy(() => import('./features/loans/pages/LoansPage'))
const LoanFormPage = lazy(() => import('./features/loans/pages/LoanFormPage'))
const LoanDetailPage = lazy(() => import('./features/loans/pages/LoanDetailPage'))
const RepaymentsPage = lazy(() => import('./features/repayments/pages/RepaymentsPage'))
const TransactionsPage = lazy(() => import('./features/transactions/pages/TransactionsPage'))
const MonthlyUploadPage = lazy(() => import('./features/monthly/pages/MonthlyUploadPage'))
const TopUpsPage = lazy(() => import('./features/topups/pages/TopUpsPage'))
const ReportsPage = lazy(() => import('./features/reports/pages/ReportsPage'))
const AuditLogPage = lazy(() => import('./features/audit/pages/AuditLogPage'))
const SettingsPage = lazy(() => import('./features/settings/pages/SettingsPage'))
const ProductsPage = lazy(() => import('./features/products/pages/ProductsPage'))
const StatementPage = lazy(() => import('./features/statements/pages/StatementPage'))
import NotFound from './pages/NotFound'
import { LoadingScreen } from './components/ui/feedback'
import { GlobalLoader } from './components/ui/GlobalLoader'

function RoleRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return <Navigate to={user ? dashboardPathFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <GlobalLoader />
        <AuthProvider>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RoleRedirect />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/ceo" element={<DashboardPage variant="ceo" />} />
                <Route path="/accountant" element={<DashboardPage variant="accountant" />} />
                <Route element={<ProtectedRoute permission={PERM.staff.manage} />}>
                  <Route path="/staff" element={<StaffListPage />} />
                  <Route path="/staff/:id" element={<StaffDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute permission={PERM.loans.view} />}>
                  <Route path="/loans" element={<LoansPage />} />
                  <Route path="/loans/completed" element={<LoansPage completed />} />
                  <Route path="/loans/:id" element={<LoanDetailPage />} />
                  <Route path="/loans/:id/statement" element={<StatementPage kind="loan" />} />
                </Route>
                <Route element={<ProtectedRoute permission={PERM.loans.create} />}><Route path="/loans/new" element={<LoanFormPage />} /></Route>
                <Route element={<ProtectedRoute permission={[PERM.loans.edit, PERM.loans.editActive]} />}><Route path="/loans/:id/edit" element={<LoanFormPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.products.manage} />}><Route path="/products" element={<ProductsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.repayments.view} />}><Route path="/repayments" element={<RepaymentsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.transactions.view} />}><Route path="/transactions" element={<TransactionsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.loans.create} />}><Route path="/monthly" element={<MonthlyUploadPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.topups.view} />}><Route path="/topups" element={<TopUpsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.reports.view} />}><Route path="/reports" element={<ReportsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.audit.view} />}><Route path="/audit" element={<AuditLogPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.settings.manage} />}><Route path="/settings" element={<SettingsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.customers.read} />}>
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
                  <Route path="/customers/:id/statement" element={<StatementPage kind="client" />} />
                </Route>
                <Route element={<ProtectedRoute permission={PERM.customers.create} />}>
                  <Route path="/customers/new" element={<CustomerFormPage />} />
                </Route>
                <Route element={<ProtectedRoute permission={PERM.customers.update} />}>
                  <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
