import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

export const BUCKET = 'leaf-images'

// Caché de URLs firmadas: evita volver a pedirlas al navegar (válidas 1 h)
const urlCache = new Map()

export async function signedUrls(paths) {
  const now = Date.now()
  const missing = [...new Set(paths.filter(Boolean))].filter((p) => !(urlCache.get(p)?.exp > now))
  if (missing.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600)
    data?.forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: now + 3500_000 }))
  }
  return Object.fromEntries(paths.filter(Boolean).map((p) => [p, urlCache.get(p)?.url]))
}
