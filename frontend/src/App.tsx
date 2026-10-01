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
import NotFound from './pages/NotFound'
import { LoadingScreen } from './components/ui/feedback'

function RoleRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return <Navigate to={user ? dashboardPathFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
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
