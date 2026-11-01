import { useEffect, useState } from 'react'
import { Bot, Copy, KeyRound, Plus, Power, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { dateTime, isOnline, timeAgo } from '../lib/format'

export default function Robots() {
  const [robots, setRobots] = useState([])
  const [form, setForm] = useState({ name: '', location: '', description: '' })
  const [showForm, setShowForm] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [error, setError] = useState(null)

  const load = () => supabase.from('robots').select('id,name,location,description,api_key_prefix,is_active,last_seen_at,battery,created_at').order('created_at').then(({ data }) => setRobots(data ?? []))
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [])

  const create = async (e) => {
    e.preventDefault(); setError(null)
    try {
      const r = await api('/robots', { method: 'POST', body: form })
      setNewKey({ name: r.robot.name, key: r.api_key }); setForm({ name: '', location: '', description: '' }); setShowForm(false); load()
    } catch (err) { setError(err.message) }
  }
  const rotate = async (r) => {
    if (!window.confirm(`¿Generar una nueva clave para «${r.name}»? La anterior dejará de funcionar.`)) return
    const res = await api(`/robots/${r.id}/rotate-key`, { method: 'POST' })
    setNewKey({ name: r.name, key: res.api_key }); load()
  }
  const toggle = async (r) => { await supabase.from('robots').update({ is_active: !r.is_active }).eq('id', r.id); load() }
  const remove = async (r) => { if (window.confirm(`¿Eliminar «${r.name}»? Sus reportes se conservan.`)) { await api(`/robots/${r.id}`, { method: 'DELETE' }); load() } }

  const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin) + '/api/robot/analyses'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Robots</h1><p className="text-leaf-900/60">Cada robot tiene su propia clave para enviar fotos de forma segura.</p></div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary"><Plus className="h-4 w-4" /> Registrar robot</button>
      </div>

      {newKey && (
        <div className="card animate-rise border-leaf-300 bg-leaf-50 p-6">
          <p className="font-display text-lg font-bold">🔑 Clave de «{newKey.name}»</p>
          <p className="text-sm text-leaf-900/70">Cópiala ahora y guárdala en el robot. <b>No se volverá a mostrar.</b></p>
          <div className="mt-3 flex gap-2">
            <code className="flex-1 overflow-x-auto rounded-xl bg-leaf-950 px-4 py-3 text-sm text-leaf-200">{newKey.key}</code>
            <button onClick={() => navigator.clipboard.writeText(newKey.key)} className="btn-outline"><Copy className="h-4 w-4" /></button>
          </div>
          <button onClick={() => setNewKey(null)} className="btn-ghost mt-3 -ml-2">Ya la guardé</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card animate-rise grid gap-4 p-6 md:grid-cols-3">
          <div><label className="label">Nombre</label><input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Robot Agrícola V2" /></div>
          <div><label className="label">Ubicación</label><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Invernadero 1" /></div>
          <div><label className="label">Descripción</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Raspberry Pi + cámara" /></div>
          {error && <p className="text-sm text-red-700 md:col-span-3">{error}</p>}
          <div className="md:col-span-3"><button className="btn-primary">Crear y generar clave</button></div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {robots.map((r) => (
          <div key={r.id} className={`card p-5 ${r.is_active ? '' : 'opacity-60'}`}>
            <div className="flex items-start gap-3">
              <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-leaf-900"><Bot className="h-6 w-6 text-leaf-300" />
                <span className={`absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-white ${isOnline(r) ? 'bg-leaf-400' : 'bg-gray-300'}`} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-bold">{r.name}</p>
                <p className="text-xs text-leaf-900/50">{r.location || 'Sin ubicación'}</p>
              </div>
              {r.battery != null && <span className="chip bg-soil-100">🔋 {Math.round(r.battery)}%</span>}
            </div>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-leaf-900/50">Estado</dt><dd className="font-medium">{!r.is_active ? 'Desactivado' : isOnline(r) ? 'En línea' : 'Desconectado'}</dd></div>
              <div className="flex justify-between"><dt className="text-leaf-900/50">Última conexión</dt><dd className="font-medium">{r.last_seen_at ? timeAgo(r.last_seen_at) : 'Nunca'}</dd></div>
              <div className="flex justify-between"><dt className="text-leaf-900/50">Clave</dt><dd className="font-mono text-xs">{r.api_key_prefix}…</dd></div>
              <div className="flex justify-between"><dt className="text-leaf-900/50">Creado</dt><dd className="text-xs">{dateTime(r.created_at)}</dd></div>
            </dl>
            <div className="mt-4 flex gap-1 border-t border-leaf-900/5 pt-3">
              <button onClick={() => rotate(r)} className="btn-ghost px-3 text-xs"><KeyRound className="h-3.5 w-3.5" /> Nueva clave</button>
              <button onClick={() => toggle(r)} className="btn-ghost px-3 text-xs"><Power className="h-3.5 w-3.5" /> {r.is_active ? 'Desactivar' : 'Activar'}</button>
              <button onClick={() => remove(r)} className="btn-ghost ml-auto px-3 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {robots.length === 0 && !showForm && <div className="card p-10 text-center text-leaf-900/60 md:col-span-2 xl:col-span-3">Aún no registras ningún robot.</div>}
      </div>

      <div className="card p-6">
        <p className="font-display text-lg font-bold">Cómo envía fotos el robot</p>
        <p className="mt-1 text-sm text-leaf-900/60">Petición <code>POST multipart/form-data</code> con la cabecera <code>X-Robot-Key</code>. Responde al instante y el resultado te llega como notificación.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-leaf-950 p-4 text-xs leading-relaxed text-leaf-100">{`curl -X POST ${apiUrl} \\
  -H "X-Robot-Key: fd_TU_CLAVE" \\
  -F "image=@hoja.jpg" \\
  -F "plot_name=Lote 2 - surco 5" \\
  -F "battery=87"`}</pre>
        <p className="mt-2 text-xs text-leaf-900/50">En la carpeta <code>robot/</code> del proyecto está el script listo para Raspberry Pi.</p>
      </div>
    </div>
  )
}
