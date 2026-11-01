import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Flame, Leaf, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'login') {
        const { error } = await signIn(form.email, form.password)
        if (error) throw error
        nav('/')
      } else if (mode === 'register') {
        const { data, error } = await signUp(form.email, form.password, form.name)
        if (error) throw error
        if (data.session) nav('/')
        else setMsg({ ok: true, text: 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.' })
      } else {
        const { error } = await resetPassword(form.email)
        if (error) throw error
        setMsg({ ok: true, text: 'Te enviamos un enlace para restablecer la contraseña.' })
      }
    } catch (err) {
      const t = err.message?.includes('Invalid login') ? 'Correo o contraseña incorrectos' : err.message
      setMsg({ ok: false, text: t })
    } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="leaf-pattern relative hidden flex-col justify-between overflow-hidden bg-leaf-900 p-12 text-leaf-50 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-leaf-400/20 ring-1 ring-leaf-300/30"><Leaf className="h-6 w-6 text-leaf-300" /></div>
          <span className="font-display text-2xl font-bold">FloraDetect</span>
        </div>
        <div className="max-w-lg">
          <h1 className="text-5xl font-bold leading-[1.05]">El robot recorre el surco.<br /><span className="text-leaf-300">Tú ves cada hoja.</span></h1>
          <p className="mt-5 text-lg text-leaf-100/75">Diagnóstico automático de enfermedades del tomate con inteligencia artificial, mapa de calor de la zona afectada y reportes al instante.</p>
          <ul className="mt-10 space-y-4 text-sm">
            {[[Bot, 'Fotos directas desde el robot, procesadas en segundos'], [Flame, 'Mapa de calor: dónde está el daño en la hoja'], [ShieldCheck, 'Solo analiza la hoja, ignora el fondo']].map(([I, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10"><I className="h-4 w-4 text-leaf-300" /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-leaf-200/50">Robot Agrícola · Monitoreo de enfermedades fúngicas en tomate</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border border-leaf-300/10" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 rounded-full border border-leaf-300/10" />
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="animate-rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden"><Leaf className="h-6 w-6 text-leaf-600" /><span className="font-display text-2xl font-bold">FloraDetect</span></div>
          <h2 className="text-3xl font-bold">{mode === 'login' ? 'Bienvenido' : mode === 'register' ? 'Crear cuenta' : 'Recuperar acceso'}</h2>
          <p className="mt-1 text-sm text-leaf-900/60">{mode === 'login' ? 'Inicia sesión para ver los reportes de tus cultivos.' : mode === 'register' ? 'Registra tu cuenta para conectar tu robot.' : 'Te enviaremos un enlace a tu correo.'}</p>

          <div className="mt-8 space-y-4">
            {mode === 'register' && (<div><label className="label">Nombre completo</label><input className="input" required value={form.name} onChange={set('name')} placeholder="Ej. Ana López" /></div>)}
            <div><label className="label">Correo</label><input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="correo@ejemplo.com" autoComplete="email" /></div>
            {mode !== 'reset' && (<div><label className="label">Contraseña</label><input className="input" type="password" required minLength={6} value={form.password} onChange={set('password')} placeholder="Mínimo 6 caracteres" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>)}
          </div>

          {msg && <p className={`mt-4 rounded-xl px-3.5 py-2.5 text-sm ${msg.ok ? 'bg-leaf-50 text-leaf-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

          <button className="btn-primary mt-6 w-full py-3" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}</button>

          <div className="mt-6 flex justify-between text-sm">
            {mode === 'login' ? (
              <>
                <button type="button" className="font-semibold text-leaf-700 hover:underline" onClick={() => setMode('register')}>Crear cuenta</button>
                <button type="button" className="text-leaf-900/60 hover:underline" onClick={() => setMode('reset')}>¿Olvidaste la contraseña?</button>
              </>
            ) : (
              <button type="button" className="font-semibold text-leaf-700 hover:underline" onClick={() => setMode('login')}>← Volver a iniciar sesión</button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
