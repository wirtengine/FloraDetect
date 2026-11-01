import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext'

const STYLE = {
  success: 'border-leaf-400 bg-leaf-50',
  info: 'border-sky-400 bg-sky-50',
  warning: 'border-amber-400 bg-amber-50',
  danger: 'border-tomato-500 bg-red-50',
}

export default function Toasts() {
  const { toasts, dismissToast } = useNotifications()
  const nav = useNavigate()
  return (
    <div className="no-print fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.toastId} className={`animate-rise cursor-pointer rounded-xl border-l-4 p-3.5 shadow-lg ${STYLE[t.type] ?? STYLE.info}`}
          onClick={() => { dismissToast(t.toastId); t.analysis_id && nav(`/reportes/${t.analysis_id}`) }}>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-xs text-leaf-950/70">{t.body}</p>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); dismissToast(t.toastId) }} className="text-leaf-950/40 hover:text-leaf-950"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
