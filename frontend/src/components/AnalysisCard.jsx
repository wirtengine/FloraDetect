import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { pct, timeAgo } from '../lib/format'
import { SeverityBadge, SourceBadge } from './ResultView'

export default function AnalysisCard({ a, url }) {
  const ok = a.is_healthy
  return (
    <Link to={`/reportes/${a.id}`} className="card group flex overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative h-28 w-28 shrink-0 bg-leaf-950 sm:h-32 sm:w-32">
        {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /> : <div className="h-full w-full animate-pulse bg-leaf-900" />}
        {a.status === 'done' && (
          <span className={`absolute bottom-2 left-2 chip ${ok ? 'bg-leaf-500 text-white' : 'bg-tomato-500 text-white'}`}>{ok ? 'Sana' : 'Enferma'}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
        <div>
          {a.status === 'processing' ? (
            <p className="flex items-center gap-2 font-semibold text-leaf-700"><Loader2 className="h-4 w-4 animate-spin" /> Analizando…</p>
          ) : a.status === 'done' ? (
            <p className="truncate font-semibold">{a.label}</p>
          ) : (
            <p className="font-semibold text-amber-700">{a.status === 'no_leaf' ? 'Sin hoja detectada' : 'Error'}</p>
          )}
          {a.status === 'done' && <p className="text-sm text-leaf-900/60">Confianza {pct(a.confidence)} · afectada {pct(a.affected_area, 0)}</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SourceBadge source={a.source} />
          <SeverityBadge s={a.severity} />
          <span className="ml-auto text-xs text-leaf-900/40">{timeAgo(a.created_at)}</span>
        </div>
      </div>
    </Link>
  )
}
