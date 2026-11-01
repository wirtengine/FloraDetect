import { useEffect, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { dateTime, ROLES } from '../lib/format'

export default function Admin() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [counts, setCounts] = useState({})
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setUsers(data ?? [])
    const { data: an } = await supabase.from('analyses').select('user_id').limit(10000)
    const c = {}; (an ?? []).forEach((a) => (c[a.user_id] = (c[a.user_id] ?? 0) + 1)); setCounts(c)
  }
  useEffect(() => { load() }, [])

  const setRole = async (u, role) => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role } }); setMsg(`Rol de ${u.email} → ${ROLES[role]}`); load() }
    catch (e) { setMsg(e.message) }
  }

  const list = users.filter((u) => `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">Administración</h1><p className="text-leaf-900/60">Gestiona usuarios y roles. Los agrónomos ven todos los reportes; los operadores solo los suyos.</p></div>
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(ROLES).map(([k, v]) => (
          <div key={k} className="card p-5"><p className="text-3xl font-bold">{users.filter((u) => u.role === k).length}</p><p className="text-sm text-leaf-900/60">{{ admin: 'Administradores', agronomo: 'Agrónomos', operador: 'Operadores' }[k]}</p></div>
        ))}
      </div>
      {msg && <p className="rounded-xl bg-leaf-50 px-4 py-2.5 text-sm text-leaf-800">{msg}</p>}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-leaf-900/5 p-4">
          <Users className="h-5 w-5 text-leaf-700" /><p className="font-display font-bold">Usuarios ({users.length})</p>
          <div className="relative ml-auto w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-leaf-900/40" /><input className="input py-2 pl-9" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-soil-50 text-left text-xs uppercase tracking-wider text-leaf-900/50">
              <tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Registrado</th><th className="px-4 py-3">Análisis</th><th className="px-4 py-3">Rol</th></tr>
            </thead>
            <tbody className="divide-y divide-leaf-900/5">
              {list.map((u) => (
                <tr key={u.id} className="hover:bg-soil-50/60">
                  <td className="px-4 py-3"><p className="font-semibold">{u.full_name || '—'}</p><p className="text-xs text-leaf-900/50">{u.email}</p></td>
                  <td className="px-4 py-3 text-xs">{dateTime(u.created_at)}</td>
                  <td className="px-4 py-3 font-semibold">{counts[u.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <select className="input w-auto py-1.5" value={u.role} disabled={u.id === user.id} onChange={(e) => setRole(u, e.target.value)}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
