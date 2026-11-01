import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, Layers, Microscope, Monitor, Sprout } from 'lucide-react'
import { api } from '../lib/api'
import { signedUrls } from '../lib/supabase'
import { dateTime, pct, SEVERITY } from '../lib/format'

let diseasesCache = null
export async function getDiseases() {
  if (!diseasesCache) diseasesCache = api('/diseases').catch(() => ({}))
  return diseasesCache
}

export function useImages(a) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    if (!a) return
    signedUrls([a.image_path, a.leaf_path, a.heatmap_path, a.thumb_path]).then(setUrls)
  }, [a?.image_path, a?.heatmap_path, a?.leaf_path, a?.thumb_path])
  return urls
}

export function SeverityBadge({ s }) {
  const v = SEVERITY[s]
  return v ? <span className={`chip ${v.cls}`}>{v.text}</span> : null
}

export function SourceBadge({ source }) {
  return source === 'robot'
    ? <span className="chip bg-leaf-900 text-leaf-100"><Bot className="h-3 w-3" /> Robot</span>
    : <span className="chip bg-soil-100 text-leaf-900"><Monitor className="h-3 w-3" /> Web</span>
}

/** Visor: original / hoja aislada / mapa de calor, con comparador deslizante */
export function ImageViewer({ a }) {
  const urls = useImages(a)
  const [tab, setTab] = useState('heatmap')
  const [split, setSplit] = useState(55)
  const tabs = [
    { k: 'heatmap', label: 'Mapa de calor', icon: Microscope, url: urls[a.heatmap_path] },
    { k: 'leaf', label: 'Hoja aislada', icon: Layers, url: urls[a.leaf_path] },
    { k: 'original', label: 'Original', icon: Sprout, url: urls[a.image_path] },
  ].filter((t) => t.url || t.k === 'original')

  const active = tabs.find((t) => t.k === tab) ?? tabs[tabs.length - 1]
  return (
    <div className="card overflow-hidden">
      <div className="no-print flex gap-1 border-b border-leaf-900/5 p-2">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active?.k === t.k ? 'bg-leaf-800 text-white' : 'text-leaf-800 hover:bg-leaf-50'}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="relative bg-leaf-950">
        {active?.url ? (
          active.k === 'heatmap' && urls[a.leaf_path] ? (
            <div className="relative select-none">
              <img src={active.url} alt="Mapa de calor" className="mx-auto max-h-[480px] w-full object-contain" />
              <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                <img src={urls[a.leaf_path]} alt="Hoja" className="mx-auto h-full max-h-[480px] w-full object-contain" />
              </div>
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${split}%` }} />
              <input type="range" min="0" max="100" value={split} onChange={(e) => setSplit(+e.target.value)}
                className="no-print absolute inset-x-4 bottom-3 accent-leaf-400" aria-label="Comparar" />
            </div>
          ) : (
            <img src={active.url} alt={active.label} className="mx-auto max-h-[480px] w-full object-contain" />
          )
        ) : (
          <div className="grid h-72 place-items-center text-sm text-leaf-200/60">Cargando imagen…</div>
        )}
      </div>
      {active?.k === 'heatmap' && (
        <div className="flex items-center gap-3 px-4 py-3 text-xs text-leaf-900/60">
          <span>Menor</span>
          <span className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg,#00008f,#0080ff,#00ffff,#80ff80,#ffff00,#ff8000,#ff0000,#800000)' }} />
          <span>Mayor afectación</span>
          <span className="hidden sm:inline">· desliza para comparar · contorno rojo = zona más afectada</span>
        </div>
      )}
    </div>
  )
}

export function Verdict({ a }) {
  if (a.status === 'processing') return <div className="card p-6 text-sm">Procesando…</div>
  if (a.status !== 'done')
    return (
      <div className="card flex gap-3 border-amber-200 bg-amber-50 p-6">
        <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <p className="font-display text-lg font-bold">{a.status === 'no_leaf' ? 'No se detectó una hoja' : 'Error de procesamiento'}</p>
          <p className="text-sm text-leaf-900/70">{a.error_message || 'Toma la foto más cerca, con la hoja centrada y buena luz.'}</p>
        </div>
      </div>
    )
  const ok = a.is_healthy
  const conf = Number(a.confidence) * 100
  return (
    <div className={`card relative overflow-hidden p-6 ${ok ? '' : ''}`}>
      <div className={`absolute inset-x-0 top-0 h-1.5 ${ok ? 'bg-leaf-500' : 'bg-tomato-500'}`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Diagnóstico</p>
          <h2 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            {ok ? <CheckCircle2 className="h-7 w-7 text-leaf-600" /> : <AlertTriangle className="h-7 w-7 text-tomato-500" />}
            {ok ? 'Hoja sana' : 'Hoja enferma'}
          </h2>
          {!ok && <p className="mt-1 text-lg font-semibold text-tomato-600">{a.label}</p>}
        </div>
        <Gauge value={conf} ok={ok} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 text-center">
        <Stat label="Salud" value={pct(a.health_score, 0)} />
        <Stat label="Área afectada" value={pct(a.affected_area, 0)} />
        <Stat label="Severidad" value={<SeverityBadge s={a.severity} />} />
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-soil-50 px-2 py-3">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-leaf-900/50">{label}</div>
    </div>
  )
}

export function Gauge({ value, ok, size = 92 }) {
  const r = 38, c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#eef3ea" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={ok ? '#4f9530' : '#e5502d'} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ transition: 'stroke-dashoffset .8s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="text-xl font-bold leading-none">{value.toFixed(1)}%</div><div className="text-[10px] text-leaf-900/50">confianza</div></div>
      </div>
    </div>
  )
}

export function Probabilities({ a, diseases }) {
  const entries = Object.entries(a.probabilities ?? {}).slice(0, 6)
  if (!entries.length) return null
  return (
    <div className="card p-6">
      <p className="label">Probabilidad por clase</p>
      <ul className="mt-3 space-y-2.5">
        {entries.map(([k, v]) => (
          <li key={k}>
            <div className="mb-1 flex justify-between text-sm"><span>{diseases?.[k]?.label ?? k}</span><span className="font-semibold tabular-nums">{pct(v)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-leaf-50">
              <div className={`h-full rounded-full ${k === 'healthy' ? 'bg-leaf-500' : 'bg-tomato-400'}`} style={{ width: `${v * 100}%`, transition: 'width .6s' }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Recommendations({ a, diseases }) {
  const d = diseases?.[a.predicted_class]
  if (!d) return null
  return (
    <div className="card p-6">
      <p className="label">{a.is_healthy ? 'Recomendaciones' : 'Sobre la enfermedad'}</p>
      {d.pathogen && <p className="text-sm italic text-leaf-900/60">Agente: {d.pathogen}</p>}
      <p className="mt-2 text-sm">{d.description}</p>
      <ul className="mt-4 space-y-2">
        {d.recommendations.map((r) => (
          <li key={r} className="flex gap-2 text-sm"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-500" />{r}</li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-leaf-900/40">Diagnóstico automático orientativo. Confirma con un agrónomo antes de aplicar tratamientos.</p>
    </div>
  )
}

export function MetaInfo({ a, robotName }) {
  const rows = [
    ['Fecha', dateTime(a.created_at)],
    ['Origen', <SourceBadge key="s" source={a.source} />],
    robotName && ['Robot', robotName],
    a.plot_name && ['Parcela', a.plot_name],
    a.latitude && ['Ubicación', `${Number(a.latitude).toFixed(5)}, ${Number(a.longitude).toFixed(5)}`],
    ['Hoja en la foto', pct(a.leaf_coverage, 0)],
    ['Tiempo de análisis', a.processing_ms ? `${a.processing_ms} ms` : '—'],
    ['Modelo', a.model_version ?? '—'],
  ].filter(Boolean)
  return (
    <div className="card p-6">
      <p className="label">Datos del reporte</p>
      <dl className="mt-2 divide-y divide-leaf-900/5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-leaf-900/60">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}
