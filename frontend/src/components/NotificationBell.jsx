import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext'
import { timeAgo } from '../lib/format'

export const NOTIF_DOT = { success: 'bg-leaf-500', info: 'bg-sky-500', warning: 'bg-amber-500', danger: 'bg-tomato-500' }

export default function NotificationBell() {
  const { items, unread, markAllRead, markRead, permission, requestPermission } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const nav = useNavigate()

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2.5 text-leaf-800 hover:bg-leaf-100" aria-label="Notificaciones">
        {unread > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-tomato-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-leaf-900/10 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-leaf-900/5 px-4 py-3">
            <p className="font-display font-bold">Notificaciones</p>
            {unread > 0 && <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-semibold text-leaf-700 hover:underline"><CheckCheck className="h-3.5 w-3.5" /> Marcar leídas</button>}
          </div>
          {permission === 'default' && (
            <button onClick={requestPermission} className="w-full bg-leaf-50 px-4 py-2.5 text-left text-xs text-leaf-800 hover:bg-leaf-100">
              🔔 Activa las notificaciones del navegador para enterarte aunque la pestaña esté en segundo plano
            </button>
          )}
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-leaf-900/50">Sin notificaciones todavía</li>}
            {items.slice(0, 12).map((n) => (
              <li key={n.id}>
                <button onClick={() => { markRead(n.id); setOpen(false); n.analysis_id && nav(`/reportes/${n.analysis_id}`) }}
                  className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-soil-50 ${n.is_read ? '' : 'bg-leaf-50/60'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${NOTIF_DOT[n.type]}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{n.title}</span>
                    <span className="line-clamp-2 block text-xs text-leaf-900/60">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-leaf-900/40">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notificaciones" onClick={() => setOpen(false)} className="block border-t border-leaf-900/5 py-2.5 text-center text-xs font-semibold text-leaf-700 hover:bg-leaf-50">Ver todas</Link>
        </div>
      )}
    </div>
  )
}
