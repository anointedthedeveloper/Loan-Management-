import { Link } from 'react-router-dom'
import { LogoMark } from '../components/ui/Logo'

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <LogoMark className="size-14" />
      <p className="mt-6 text-sm font-semibold text-brand-600">Error 404</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-slate-500">The page you are looking for doesn't exist or has been moved.</p>
      <Link to="/" className="mt-6 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-900">Back to Protech portal</Link>
    </div>
  )
}
