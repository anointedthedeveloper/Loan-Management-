export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0B3D2E" />
      <path d="M19 50V14h16c8 0 12.5 4.3 12.5 11S43 36 35 36h-7v14z" fill="#fff" />
      <path d="M28 22v7h6.5c2.8 0 4.3-1.3 4.3-3.5S37.300 22 34.500 22z" fill="#0B3D2E" />
      <rect x="19" y="53" width="29" height="3" rx="1.5" fill="#4ADE80" />
    </svg>
  )
}

export function Logo({ dark = false, subtitle = true }: { dark?: boolean; subtitle?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>Protech</div>
        {subtitle && <div className={`text-[11px] font-medium uppercase tracking-wider ${dark ? 'text-brand-100/70' : 'text-slate-500'}`}>Loan Management</div>}
      </div>
    </div>
  )
}
