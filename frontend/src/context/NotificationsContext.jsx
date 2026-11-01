import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)

/**
 * Notificaciones en tiempo real (Supabase Realtime, sin polling → cero carga extra en el servidor).
 * Además: toasts dentro de la app + notificación nativa del sistema si el usuario la permite.
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [toasts, setToasts] = useState([])
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')

  const pushToast = useCallback((n) => {
    const id = crypto.randomUUID()
    setToasts((t) => [...t, { ...n, toastId: id }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.toastId !== id)), 6500)
  }, [])

  useEffect(() => {
    if (!user) return setItems([])
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setItems(data ?? []))

    const channel = supabase
      .channel(`notif-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, ({ new: n }) => {
        setItems((prev) => [n, ...prev].slice(0, 50))
        pushToast(n)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          const sys = new Notification(n.title, { body: n.body, icon: '/favicon.ico', tag: n.id })
          sys.onclick = () => { window.focus(); if (n.analysis_id) window.location.assign(`/reportes/${n.analysis_id}`) }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, pushToast])

  const markAllRead = async () => {
    setItems((p) => p.map((n) => ({ ...n, is_read: true })))
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
  }
  const markRead = async (id) => {
    setItems((p) => p.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  }
  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }

  return (
    <Ctx.Provider value={{ items, unread: items.filter((n) => !n.is_read).length, markAllRead, markRead, toasts, pushToast, permission, requestPermission,
      dismissToast: (id) => setToasts((t) => t.filter((x) => x.toastId !== id)) }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotifications = () => useContext(Ctx)
