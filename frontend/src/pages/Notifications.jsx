import { useNavigate } from 'react-router-dom'
import { BellRing, CheckCheck } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext'
import { NOTIF_DOT } from '../components/NotificationBell'
import { dateTime } from '../lib/format'

export default function Notifications() {
  const { items, unread, markAllRead, markRead, permission, requestPermission } = useNotifications()
  const nav = useNavigate()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Notificaciones</h1><p className="text-leaf-900/60">{unread} sin leer</p></div>
        <div className="flex gap-2">
          {permission !== 'granted' && <button onClick={requestPermission} className="btn-outline"><BellRing className="h-4 w-4" /> Activar en el navegador</button>}
          {unread > 0 && <button onClick={markAllRead} className="btn-primary"><CheckCheck className="h-4 w-4" /> Marcar todas</button>}
        </div>
      </div>
      <div className="card divide-y divide-leaf-900/5">
        {items.length === 0 && <p className="p-10 text-center text-leaf-900/50">Sin notificaciones.</p>}
        {items.map((n) => (
          <button key={n.id} onClick={() => { markRead(n.id); n.analysis_id && nav(`/reportes/${n.analysis_id}`) }}
            className={`flex w-full gap-4 p-5 text-left hover:bg-soil-50 ${n.is_read ? '' : 'bg-leaf-50/50'}`}>
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${NOTIF_DOT[n.type]}`} />
            <span className="flex-1">
              <span className="block font-semibold">{n.title}</span>
              <span className="block text-sm text-leaf-900/70">{n.body}</span>
              <span className="mt-1 block text-xs text-leaf-900/40">{dateTime(n.created_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
