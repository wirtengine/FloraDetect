import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Save, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import { getDiseases, ImageViewer, MetaInfo, Probabilities, Recommendations, Verdict } from '../components/ResultView'

export default function Report() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user, isAdmin } = useAuth()
  const [a, setA] = useState(null)
  const [robot, setRobot] = useState(null)
  const [diseases, setDiseases] = useState({})
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDiseases().then(setDiseases)
    supabase.from('analyses').select('*, robots(name)').eq('id', id).single().then(({ data }) => {
      setA(data); setNotes(data?.notes ?? ''); setRobot(data?.robots?.name)
    })
    // Si aún se está procesando (robot), se actualiza solo al terminar
    const ch = supabase.channel(`report-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'analyses', filter: `id=eq.${id}` }, ({ new: n }) => setA((p) => ({ ...p, ...n })))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  if (!a) return <Spinner full />
  const canEdit = a.user_id === user.id || isAdmin

  const saveNotes = async () => {
    await supabase.from('analyses').update({ notes }).eq('id', id)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  const remove = async () => {
    if (!window.confirm('¿Eliminar este reporte y sus imágenes?')) return
    await api(`/analyses/${id}`, { method: 'DELETE' })
    nav('/reportes')
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link to="/reportes" className="btn-ghost -ml-2"><ArrowLeft className="h-4 w-4" /> Reportes</Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn-outline"><Printer className="h-4 w-4" /> Imprimir / PDF</button>
          {canEdit && <button onClick={remove} className="btn-danger"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>

      <div>
        <p className="label">Reporte #{a.id.slice(0, 8).toUpperCase()}</p>
        <h1 className="text-3xl font-bold">{a.status === 'done' ? a.label : 'Análisis de hoja'}</h1>
      </div>

      {a.status === 'processing' ? <Spinner label="El robot envió la foto. Analizando…" full /> : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <ImageViewer a={a} />
            <div className="space-y-6"><Verdict a={a} /><Probabilities a={a} diseases={diseases} /></div>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Recommendations a={a} diseases={diseases} />
            <div className="space-y-6">
              <MetaInfo a={a} robotName={robot} />
              <div className="card p-6">
                <p className="label">Notas</p>
                {canEdit ? (
                  <>
                    <textarea className="input mt-1 min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agrega observaciones, tratamiento aplicado…" />
                    <button onClick={saveNotes} className="btn-outline no-print mt-3"><Save className="h-4 w-4" /> {saved ? 'Guardado ✓' : 'Guardar notas'}</button>
                  </>
                ) : <p className="text-sm">{a.notes || '—'}</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
