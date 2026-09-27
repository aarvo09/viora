const fs = require('fs');

const shellCode = `
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, apiMode, auth } from '../api/client'

export function Shell() {
  const navigate = useNavigate()
  const staff = auth.staff()
  const [openAlerts, setOpenAlerts] = useState<number | null>(null)
  const [totalCases, setTotalCases] = useState<number | null>(null)
  const [dueFollowups, setDueFollowups] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    api.dashboard().then((d) => {
      if (!alive) return
      setOpenAlerts(d.open_alerts)
      setTotalCases(d.active_cases)
      setDueFollowups(d.follow_ups_due)
    }).catch(() => {})
    
    api.dueFollowUps().then((due) => {
      if (!alive) return
      setDueFollowups(due.length)
    }).catch(() => {})
    
    return () => { alive = false }
  }, [])

  function signOut() {
    auth.clear()
    navigate('/login', { replace: true })
  }

  const initials = (staff?.name || 'Dr. Sharma').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()

  const navItemClass = ({ isActive }: { isActive: boolean }) => (
    \`flex items-center justify-between px-space-md py-space-sm rounded-lg transition-colors font-label-md text-label-md \${isActive ? 'bg-primary-container text-on-primary font-semibold' : 'text-inverse-on-surface/80 hover:bg-surface-variant/20 hover:text-inverse-on-surface'}\`
  )

  return (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen">
      
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-[280px] bg-inverse-surface z-50 flex flex-col justify-between shadow-sm border-r border-sidebar-border">
        <div className="flex flex-col">
          
          {/* Logo */}
          <div className="px-space-lg pt-space-lg pb-space-md">
            <div className="flex items-center gap-space-sm">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-[0_2px_8px_rgba(79,70,229,0.4)]">
                <span className="material-symbols-outlined text-on-primary text-[20px]">psychology</span>
              </div>
              <div>
                <span className="font-headline-lg text-headline-lg text-inverse-on-surface tracking-tight block leading-tight">VIORA</span>
                <span className="text-[10px] text-surface-dim font-medium tracking-wide uppercase block">Clinical Decision Support</span>
              </div>
            </div>
          </div>
          
          {/* Navigation */}
          <nav className="flex flex-col gap-space-2xs px-space-sm mt-space-md">
            <NavLink to="/" end className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">space_dashboard</span>
                <span>Dashboard</span>
              </div>
            </NavLink>
            <NavLink to="/cases" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">folder_shared</span>
                <span>Cases</span>
              </div>
              {totalCases !== null && totalCases > 0 && (
                <span className="font-label-sm text-label-sm px-space-sm py-space-2xs rounded-full bg-secondary text-inverse-on-surface">{totalCases}</span>
              )}
            </NavLink>
            <NavLink to="/alerts" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">warning</span>
                <span>Alerts</span>
              </div>
              {openAlerts !== null && openAlerts > 0 ? (
                <span className="font-label-sm text-label-sm px-space-sm py-space-2xs rounded-full bg-error text-on-error">{openAlerts}</span>
              ) : (
                <span className="font-label-sm text-label-sm px-space-sm py-space-2xs rounded-full bg-surface-variant/10 text-inverse-on-surface">0</span>
              )}
            </NavLink>
            <NavLink to="/conversations" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">forum</span>
                <span>Conversations</span>
              </div>
            </NavLink>
            <NavLink to="/followups" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">event_upcoming</span>
                <span>Follow-ups</span>
              </div>
              {dueFollowups !== null && dueFollowups > 0 && (
                <span className="font-label-sm text-label-sm px-space-sm py-space-2xs rounded-full bg-surface-variant/30 text-inverse-on-surface">{dueFollowups}</span>
              )}
            </NavLink>
            <NavLink to="/reports" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">description</span>
                <span>Reports</span>
              </div>
            </NavLink>
            <NavLink to="/analytics" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">insights</span>
                <span>Analytics</span>
              </div>
            </NavLink>
            <NavLink to="/settings" className={navItemClass}>
              <div className="flex items-center gap-space-md">
                <span className="material-symbols-outlined text-[20px]">settings</span>
                <span>Settings</span>
              </div>
            </NavLink>
          </nav>
        </div>

        {/* User Profile */}
        <div className="p-space-md m-space-sm bg-surface-variant/10 rounded-xl border border-surface-variant/10">
          <div className="flex items-center gap-space-md">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-primary text-on-primary font-headline-sm text-headline-sm flex items-center justify-center">{initials}</div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-secondary ring-2 ring-inverse-surface"></span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md text-inverse-on-surface truncate block">{staff?.name || 'Dr. Sharma'}</span>
              </div>
              <span className="font-body-sm text-body-sm text-surface-dim truncate block">{staff?.role || 'Senior Clinical Counsellor'}</span>
              <div className="flex items-center gap-space-xs mt-space-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-surface-dim"></span>
                <span className="font-label-sm text-label-sm text-inverse-on-surface/70">On Duty</span>
              </div>
            </div>
          </div>
          <button onClick={signOut} className="mt-space-md w-full py-1.5 rounded-lg bg-transparent border border-surface-variant/20 text-inverse-on-surface/80 text-xs font-medium hover:bg-surface-variant/10 flex justify-center items-center gap-1 transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="pl-[280px] min-h-screen flex flex-col bg-background">
        
        {/* Header */}
        <header className="fixed top-0 left-[280px] right-0 h-16 bg-surface/80 backdrop-blur-xl shadow-sm z-40 px-space-xl flex items-center justify-between border-b border-surface-container">
          <div className="w-full max-w-lg relative flex items-center">
            <span className="material-symbols-outlined absolute left-space-md text-on-surface-variant text-[20px]">search</span>
            <input 
              type="text" 
              placeholder="Search cases by patient name, UID, or condition..." 
              className="w-full pl-10 pr-14 py-space-xs bg-surface-container-lowest rounded-lg font-body-md text-body-md text-on-surface placeholder:text-outline border border-surface-container focus:outline-none focus:border-primary focus:bg-surface" 
            />
            <span className="absolute right-space-sm font-data-mono text-xs text-on-surface-variant bg-surface-container px-space-xs py-0.5 rounded font-semibold">⌘K</span>
          </div>

          <div className="flex items-center gap-space-md">
            {apiMode === 'mock' && (
              <span className="px-2 py-0.5 rounded-full bg-risk-moderate-tint text-risk-moderate-text border border-risk-moderate-border text-xs font-semibold">MOCK TELEMETRY</span>
            )}
            <div className="flex items-center gap-space-xs px-space-md py-space-xs rounded-full bg-surface-container-low border border-surface-container">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              <span className="font-label-sm text-label-sm text-primary font-semibold">Live Telemetry Active</span>
            </div>
            <NavLink to="/alerts" className="relative p-space-xs rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors border border-surface-container">
              <span className="material-symbols-outlined text-[22px]">notifications</span>
              {openAlerts !== null && openAlerts > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full"></span>
              )}
            </NavLink>
            <NavLink to="/cases" className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-hover transition-colors shadow-sm">
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>New Referral / Case</span>
            </NavLink>
          </div>
        </header>

        {/* Router Outlet */}
        <main className="w-full pt-[88px] px-space-xl pb-space-2xl max-w-[1600px] mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
`
fs.writeFileSync('src/components/Shell.tsx', shellCode);
