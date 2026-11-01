import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, Bot, Camera, HeartPulse, Microscope, TriangleAlert } from 'lucide-react'
import { supabase, signedUrls } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { isOnline, pct, timeAgo } from '../lib/format'
import AnalysisCard from '../components/AnalysisCard'
import Spinner from '../components/Spinner'

export default function Dashboard() {
  const { profile, canViewAll } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [robots, setRobots] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [days, setDays] = useState(30)

  const loadRecent = async () => {
    const { data } = await supabase.from('analyses')
      .select('id,status,label,is_healthy,confidence,affected_area,severity,source,created_at,thumb_path')
      .order('created_at', { ascending: false }).limit(6)
    setRecent(data ?? [])
    setThumbs(await signedUrls((data ?? []).map((a) => a.thumb_path)))
  }

  useEffect(() => {
    supabase.rpc('dashboard_stats', { days }).then(({ data }) => setStats(data))
  }, [days])

  useEffect(() => {
    loadRecent()
    supabase.from('robots').select('id,name,location,last_seen_at,battery,is_active').order('created_at').then(({ data }) => setRobots(data ?? []))
    // En vivo: nuevos análisis del robot aparecen sin recargar
    const ch = supabase.channel('dash-analyses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analyses' }, () => loadRecent())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  if (!stats) return <Spinner full />
  const healthRate = stats.total ? stats.healthy / stats.total : 0
  const byClass = Object.entries(stats.by_class ?? {}).sort((a, b) => b[1] - a[1])
  const maxClass = Math.max(1, ...byClass.map(([, n]) => n))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-leaf-900/60">Hola, {profile?.full_name?.split(' ')[0] || 'agricultor'} 👋</p>
          <h1 className="text-3xl font-bold sm:text-4xl">Estado del cultivo</h1>
          {canViewAll && <p className="mt-1 text-xs text-leaf-900/50">Viendo datos de todos los usuarios</p>}
        </div>
        <div className="flex gap-2">
          <select className="input w-auto" value={days} onChange={(e) => setDays(+e.target.value)}>
            <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option>
          </select>
          <Link to="/analizar" className="btn-primary"><Camera className="h-4 w-4" /> Subir foto</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Microscope} label="Hojas analizadas" value={stats.total} sub={`${stats.from_robot} desde robot`} />
        <Kpi icon={HeartPulse} label="Sanas" value={stats.healthy} sub={pct(healthRate, 0) + ' del total'} tone="leaf" />
        <Kpi icon={TriangleAlert} label="Enfermas" value={stats.diseased} sub={stats.diseased ? 'Revisar reportes' : 'Sin alertas'} tone="tomato" />
        <Kpi icon={Activity} label="Confianza media" value={pct(stats.avg_conf, 0)} sub="del modelo" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between"><p className="font-display text-lg font-bold">Actividad diaria</p>
            <div className="flex gap-3 text-xs"><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-leaf-500" />Sanas</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-tomato-400" />Enfermas</span></div>
          </div>
          <DailyChart data={stats.by_day ?? []} />
        </div>
        <div className="card p-6">
          <p className="font-display text-lg font-bold">Diagnósticos</p>
          {byClass.length === 0 && <p className="mt-6 text-sm text-leaf-900/50">Aún no hay análisis en este periodo.</p>}
          <ul className="mt-4 space-y-3">
            {byClass.map(([label, n]) => (
              <li key={label}>
                <div className="mb-1 flex justify-between text-sm"><span className="truncate">{label}</span><span className="font-semibold">{n}</span></div>
                <div className="h-2 rounded-full bg-leaf-50"><div className={`h-full rounded-full ${label === 'Hoja sana' ? 'bg-leaf-500' : 'bg-tomato-400'}`} style={{ width: `${(n / maxClass) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-bold">Últimos reportes</h2><Link to="/reportes" className="flex items-center gap-1 text-sm font-semibold text-leaf-700">Ver todos <ArrowRight className="h-4 w-4" /></Link></div>
          {recent.length === 0 ? (
            <div className="card p-10 text-center text-sm text-leaf-900/60">Todavía no hay fotos. Conecta tu robot o <Link to="/analizar" className="font-semibold text-leaf-700 underline">sube una foto</Link>.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">{recent.map((a) => <AnalysisCard key={a.id} a={a} url={thumbs[a.thumb_path]} />)}</div>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-bold">Robots</h2><Link to="/robots" className="text-sm font-semibold text-leaf-700">Gestionar</Link></div>
          <div className="card divide-y divide-leaf-900/5">
            {robots.length === 0 && <div className="p-6 text-sm text-leaf-900/60">No hay robots registrados. <Link to="/robots" className="font-semibold text-leaf-700 underline">Registrar uno</Link></div>}
            {robots.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-4">
                <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-leaf-100"><Bot className="h-5 w-5 text-leaf-700" />
                  <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${isOnline(r) ? 'bg-leaf-500' : 'bg-gray-300'}`} /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.name}</p><p className="text-xs text-leaf-900/50">{isOnline(r) ? 'En línea' : r.last_seen_at ? `Visto ${timeAgo(r.last_seen_at)}` : 'Nunca conectado'}</p></div>
                {r.battery != null && <span className="text-xs font-semibold text-leaf-900/60">🔋 {Math.round(r.battery)}%</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  const c = tone === 'leaf' ? 'bg-leaf-100 text-leaf-700' : tone === 'tomato' ? 'bg-red-50 text-tomato-600' : 'bg-soil-100 text-leaf-800'
  return (
    <div className="card animate-rise p-5">
      <div className={`grid h-10 w-10 place-items-center rounded-xl ${c}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-4 text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-leaf-900/50">{sub}</p>
    </div>
  )
}

function DailyChart({ data }) {
  if (!data.length) return <div className="grid h-48 place-items-center text-sm text-leaf-900/50">Sin datos en este periodo</div>
  const max = Math.max(1, ...data.map((d) => d.healthy + d.diseased))
  return (
    <div className="mt-6 flex h-48 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.healthy} sanas, ${d.diseased} enfermas`}>
          <div className="rounded-t bg-tomato-400" style={{ height: `${(d.diseased / max) * 100}%` }} />
          <div className="rounded-b bg-leaf-500" style={{ height: `${(d.healthy / max) * 100}%` }} />
          <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-leaf-950 px-2 py-0.5 text-[10px] text-white group-hover:block">{d.day.slice(5)} · {d.healthy + d.diseased}</span>
        </div>
      ))}
    </div>
  )
}
