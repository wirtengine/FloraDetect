import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, FileText, ImagePlus, MapPin, RotateCcw, Upload } from 'lucide-react'
import { api, compressImage } from '../lib/api'
import { getDiseases, ImageViewer, Probabilities, Recommendations, Verdict } from '../components/ResultView'

export default function Analyze() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [meta, setMeta] = useState({ plot_name: '', notes: '' })
  const [geo, setGeo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [diseases, setDiseases] = useState({})
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(), camRef = useRef()

  useEffect(() => { getDiseases().then(setDiseases) }, [])
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const pick = (f) => {
    if (!f?.type.startsWith('image/')) return setError('Selecciona una imagen (JPG, PNG o WEBP)')
    setError(null); setResult(null); setFile(f); setPreview(URL.createObjectURL(f))
  }

  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setGeo({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
    () => setError('No se pudo obtener la ubicación'))

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const small = await compressImage(file)
      const fd = new FormData()
      fd.append('image', small)
      Object.entries({ ...meta, ...geo }).forEach(([k, v]) => v !== '' && v != null && fd.append(k, v))
      setResult(await api('/analyses', { method: 'POST', form: fd }))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const reset = () => { setFile(null); setPreview(null); setResult(null); setMeta({ plot_name: '', notes: '' }) }

  if (result)
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Resultado</h1>
          <div className="flex gap-2">
            <button onClick={reset} className="btn-outline"><RotateCcw className="h-4 w-4" /> Analizar otra</button>
            <Link to={`/reportes/${result.id}`} className="btn-primary"><FileText className="h-4 w-4" /> Ver reporte completo</Link>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          {result.status === 'done' ? <ImageViewer a={result} /> : <img src={preview} alt="" className="card max-h-[480px] w-full object-contain" />}
          <div className="space-y-6"><Verdict a={result} />{result.status === 'done' && <Probabilities a={result} diseases={diseases} />}</div>
        </div>
        {result.status === 'done' && <Recommendations a={result} diseases={diseases} />}
      </div>
    )

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analizar una hoja</h1>
        <p className="text-leaf-900/60">Sube una foto manualmente. Lo ideal: una sola hoja, centrada, con luz natural y sin sombra fuerte.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }}
          className={`card relative grid min-h-[340px] place-items-center overflow-hidden border-2 border-dashed transition ${drag ? 'border-leaf-500 bg-leaf-50' : 'border-leaf-900/10'}`}>
          {preview ? (
            <div className="relative h-full w-full bg-leaf-950">
              <img src={preview} alt="Vista previa" className="h-full max-h-[420px] w-full object-contain" />
              {busy && <div className="scan-line" />}
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-leaf-100"><ImagePlus className="h-8 w-8 text-leaf-700" /></div>
              <p className="mt-4 font-semibold">Arrastra la foto aquí</p>
              <p className="text-sm text-leaf-900/50">o elige una opción</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button onClick={() => inputRef.current.click()} className="btn-outline"><Upload className="h-4 w-4" /> Galería</button>
                <button onClick={() => camRef.current.click()} className="btn-outline"><Camera className="h-4 w-4" /> Cámara</button>
              </div>
            </div>
          )}
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files[0])} />
        </div>

        <div className="card space-y-4 p-6">
          <div><label className="label">Parcela / surco (opcional)</label><input className="input" value={meta.plot_name} onChange={(e) => setMeta({ ...meta, plot_name: e.target.value })} placeholder="Ej. Lote 2 – surco 5" /></div>
          <div><label className="label">Notas (opcional)</label><textarea className="input min-h-[80px]" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} placeholder="Observaciones de campo" /></div>
          <button type="button" onClick={locate} className="btn-ghost -ml-2"><MapPin className="h-4 w-4" />{geo ? `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}` : 'Agregar ubicación'}</button>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
          <button onClick={submit} disabled={!file || busy} className="btn-primary w-full py-3">{busy ? 'Analizando la hoja…' : 'Analizar hoja'}</button>
          {file && !busy && <button onClick={reset} className="btn-ghost w-full">Cambiar foto</button>}
          <p className="text-xs text-leaf-900/50">La foto se reduce en tu dispositivo antes de enviarse para que el análisis sea rápido.</p>
        </div>
      </div>
    </div>
  )
}
