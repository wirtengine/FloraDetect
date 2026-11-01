export const pct = (v, d = 1) => (v == null ? '—' : `${(Number(v) * 100).toFixed(d)}%`)

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return `hace ${Math.floor(s / 86400)} d`
}

export const SEVERITY = {
  ninguna: { text: 'Sin daño', cls: 'bg-leaf-100 text-leaf-800' },
  leve: { text: 'Leve', cls: 'bg-amber-100 text-amber-800' },
  moderada: { text: 'Moderada', cls: 'bg-orange-100 text-orange-800' },
  severa: { text: 'Severa', cls: 'bg-red-100 text-red-800' },
}

export const ROLES = { admin: 'Administrador', agronomo: 'Agrónomo', operador: 'Operador' }

export const isOnline = (robot) => robot.last_seen_at && Date.now() - new Date(robot.last_seen_at).getTime() < 3 * 60_000
