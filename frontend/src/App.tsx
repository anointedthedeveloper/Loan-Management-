import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute, dashboardPathFor } from './routes/ProtectedRoute'
import AppLayout from './layouts/AppLayout'
import LoginPage from './features/auth/LoginPage'
import DashboardPage from './features/dashboard/DashboardPage'
import StaffPage from './features/staff/StaffPage'
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
                <Route element={<ProtectedRoute permission="staff.manage" />}>
                  <Route path="/staff" element={<StaffPage />} />
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
