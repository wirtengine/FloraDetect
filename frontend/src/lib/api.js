import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_URL || ''

export async function api(path, { method = 'GET', body, form } = {}) {
  const { data } = await supabase.auth.getSession()
  const headers = { Authorization: `Bearer ${data.session?.access_token ?? ''}` }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.detail?.toString() || `Error ${res.status}`)
  return json
}

/**
 * Reduce la foto EN EL NAVEGADOR antes de subirla (máx 1280 px, JPEG 0.85).
 * Una foto de celular de 4-8 MB pasa a ~200-400 KB → menos red y menos CPU en el servidor.
 */
export async function compressImage(file, maxSide = 1280, quality = 0.85) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) return file
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * s)
  canvas.height = Math.round(bitmap.height * s)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
  return blob ? new File([blob], 'hoja.jpg', { type: 'image/jpeg' }) : file
}
