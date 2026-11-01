import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Bot, Camera, FileText, LayoutDashboard, Leaf, LogOut, Menu, Shield, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationsContext'
import { ROLES } from '../lib/format'
import NotificationBell from './NotificationBell'
import Toasts from './Toasts'

const NAV = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/robots', label: 'Robots', icon: Bot },
  { to: '/reportes', label: 'Reportes', icon: FileText },
  { to: '/analizar', label: 'Subir foto', icon: Camera },
  { to: '/notificaciones', label: 'Notificaciones', icon: Bell },
]

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const { unread } = useNotifications()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()

  const links = isAdmin ? [...NAV, { to: '/admin', label: 'Administración', icon: Shield }] : NAV

  const Side = (
    <div className="flex h-full flex-col bg-leaf-900 text-leaf-50">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-leaf-400/20 ring-1 ring-leaf-300/30"><Leaf className="h-5 w-5 text-leaf-300" /></div>
        <div>
          <p className="font-display text-xl font-bold leading-none">FloraDetect</p>
          <p className="mt-1 text-[11px] uppercase tracking-[.18em] text-leaf-300/70">Salud del tomate</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${isActive ? 'bg-leaf-50 text-leaf-900' : 'text-leaf-100/80 hover:bg-white/5 hover:text-white'}`}>
            <Icon className="h-[18px] w-[18px]" />
            <span className="flex-1">{label}</span>
            {to === '/notificaciones' && unread > 0 && <span className="chip bg-tomato-500 text-white">{unread}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl bg-white/5 p-4">
        <p className="truncate text-sm font-semibold">{profile?.full_name || 'Usuario'}</p>
        <p className="truncate text-xs text-leaf-200/70">{profile?.email}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="chip bg-leaf-400/20 text-leaf-200">{ROLES[profile?.role] ?? '—'}</span>
          <button onClick={async () => { await signOut(); nav('/login') }} className="flex items-center gap-1.5 text-xs text-leaf-200 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Salir
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{Side}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{Side}</div>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-leaf-900/5 bg-soil-50/85 px-4 py-3 backdrop-blur lg:px-8">
        <button className="btn-ghost -ml-2 px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Menú">{open ? <X /> : <Menu />}</button>
        <div className="hidden lg:block" />
        <NotificationBell />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
      <Toasts />
    </div>
  )
}
