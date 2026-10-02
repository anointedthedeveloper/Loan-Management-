import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute, dashboardPathFor } from './routes/ProtectedRoute'
import AppLayout from './layouts/AppLayout'
import LoginPage from './features/auth/LoginPage'
import DashboardPage from './features/dashboard/DashboardPage'
import StaffListPage from './features/staff/pages/StaffListPage'
import StaffDetailPage from './features/staff/pages/StaffDetailPage'
import CustomersPage from './features/customers/pages/CustomersPage'
import CustomerDetailPage from './features/customers/pages/CustomerDetailPage'
import CustomerFormPage from './features/customers/pages/CustomerFormPage'
import { PERM } from './config/permissions'
import LoansPage from './features/loans/pages/LoansPage'
import LoanFormPage from './features/loans/pages/LoanFormPage'
import LoanDetailPage from './features/loans/pages/LoanDetailPage'
import RepaymentsPage from './features/repayments/pages/RepaymentsPage'
import TransactionsPage from './features/transactions/pages/TransactionsPage'
import TopUpsPage from './features/topups/pages/TopUpsPage'
import ReportsPage from './features/reports/pages/ReportsPage'
import AuditLogPage from './features/audit/pages/AuditLogPage'
import SettingsPage from './features/settings/pages/SettingsPage'
import ProductsPage from './features/products/pages/ProductsPage'
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
                  <Route path="/loans/:id" element={<LoanDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute permission={PERM.loans.create} />}><Route path="/loans/new" element={<LoanFormPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.loans.edit} />}><Route path="/loans/:id/edit" element={<LoanFormPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.products.manage} />}><Route path="/products" element={<ProductsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.repayments.view} />}><Route path="/repayments" element={<RepaymentsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.transactions.view} />}><Route path="/transactions" element={<TransactionsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.topups.view} />}><Route path="/topups" element={<TopUpsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.reports.view} />}><Route path="/reports" element={<ReportsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.audit.view} />}><Route path="/audit" element={<AuditLogPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.settings.manage} />}><Route path="/settings" element={<SettingsPage />} /></Route>
                <Route element={<ProtectedRoute permission={PERM.customers.read} />}>
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
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
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
