import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Spinner from './components/Spinner'
import AuthPage from './pages/AuthPage'

// Carga diferida: cada página se descarga solo cuando se visita
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Analyze = lazy(() => import('./pages/Analyze'))
const History = lazy(() => import('./pages/History'))
const Report = lazy(() => import('./pages/Report'))
const Robots = lazy(() => import('./pages/Robots'))
const Admin = lazy(() => import('./pages/Admin'))
const Notifications = lazy(() => import('./pages/Notifications'))

function Private({ children, admin }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Spinner full />
  if (!user) return <Navigate to="/login" replace />
  if (admin && !isAdmin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Suspense fallback={<Spinner full />}>
      <Routes>
        <Route path="/login" element={!loading && user ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="analizar" element={<Analyze />} />
          <Route path="reportes" element={<History />} />
          <Route path="reportes/:id" element={<Report />} />
          <Route path="robots" element={<Robots />} />
          <Route path="notificaciones" element={<Notifications />} />
          <Route path="admin" element={<Private admin><Admin /></Private>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
