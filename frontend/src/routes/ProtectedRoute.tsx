import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LoadingScreen } from '../components/ui/feedback'
import Forbidden from '../pages/Forbidden'

/** Requires a signed-in user; optionally requires a permission (UI guard only — API enforces too). */
export function ProtectedRoute({ permission }: { permission?: string }) {
  const { user, loading, can } = useAuth()
  const loc = useLocation()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (permission && !can(permission)) return <Forbidden />
  return <Outlet />
}

export const dashboardPathFor = (role: string) => (role === 'ceo' ? '/ceo' : '/accountant')
