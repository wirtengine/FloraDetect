import { useEffect, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { supabase, signedUrls } from '../lib/supabase'
import AnalysisCard from '../components/AnalysisCard'
import Spinner from '../components/Spinner'

const PAGE = 18

export default function History() {
  const [rows, setRows] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState({ health: 'all', source: 'all', q: '' })

  const query = (from) => {
    let q = supabase.from('analyses')
      .select('id,status,label,is_healthy,confidence,affected_area,severity,source,created_at,thumb_path,plot_name,predicted_class')
      .order('created_at', { ascending: false }).range(from, from + PAGE - 1)
    if (f.health !== 'all') q = q.eq('is_healthy', f.health === 'healthy')
    if (f.source !== 'all') q = q.eq('source', f.source)
    if (f.q) q = q.or(`label.ilike.%${f.q}%,plot_name.ilike.%${f.q}%`)
    return q
  }

  const load = async (p) => {
    setLoading(true)
    const { data } = await query(p * PAGE)
    const list = data ?? []
    setMore(list.length === PAGE)
    setRows((prev) => (p === 0 ? list : [...prev, ...list]))
    const t = await signedUrls(list.map((a) => a.thumb_path))
    setThumbs((prev) => ({ ...prev, ...t }))
    setLoading(false)
  }

  useEffect(() => { setPage(0); const t = setTimeout(() => load(0), 250); return () => clearTimeout(t) }, [f])

  const exportCsv = async () => {
    const { data } = await supabase.from('analyses')
      .select('created_at,source,status,label,confidence,health_score,affected_area,severity,plot_name,latitude,longitude')
      .order('created_at', { ascending: false }).limit(5000)
    const head = Object.keys(data?.[0] ?? { created_at: '' })
    const csv = [head.join(','), ...(data ?? []).map((r) => head.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
    a.download = `floradetect-reportes-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const Seg = ({ k, opts }) => (
    <div className="flex rounded-xl bg-white p-1 shadow-card">
      {opts.map(([v, l]) => (
        <button key={v} onClick={() => setF({ ...f, [k]: v })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${f[k] === v ? 'bg-leaf-800 text-white' : 'text-leaf-800 hover:bg-leaf-50'}`}>{l}</button>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Reportes</h1><p className="text-leaf-900/60">Cada foto procesada genera un reporte con diagnóstico y mapa de calor.</p></div>
        <button onClick={exportCsv} className="btn-outline"><Download className="h-4 w-4" /> Exportar CSV</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-leaf-900/40" /><input className="input pl-9" placeholder="Buscar por enfermedad o parcela" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <Seg k="health" opts={[['all', 'Todas'], ['healthy', 'Sanas'], ['sick', 'Enfermas']]} />
        <Seg k="source" opts={[['all', 'Todo'], ['robot', 'Robot'], ['web', 'Web']]} />
      </div>
      {loading && rows.length === 0 ? <Spinner full /> : rows.length === 0 ? (
        <div className="card p-12 text-center text-leaf-900/60">No hay reportes con estos filtros.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((a) => <AnalysisCard key={a.id} a={a} url={thumbs[a.thumb_path]} />)}</div>
      )}
      {more && rows.length > 0 && (
        <div className="text-center"><button disabled={loading} onClick={() => { setPage(page + 1); load(page + 1) }} className="btn-outline">{loading ? 'Cargando…' : 'Cargar más'}</button></div>
      )}
    </div>
  )
}
