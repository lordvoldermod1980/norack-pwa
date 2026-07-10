import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TabletDashboard from './pages/TabletDashboard'
import AuthGate from './components/AuthGate'
import ErrorBoundary from './components/ErrorBoundary'

// The boundary sits inside AuthGate: reporting a crash needs a session, and a crash before login is a login
// problem, which AuthGate already surfaces.
export default function App() {
  return (
    <AuthGate>
      <ErrorBoundary>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/tablet" element={<TabletDashboard />} />
            <Route path="/dashboard" element={<TabletDashboard />} />
            <Route path="*" element={<Navigate to="/tablet" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </AuthGate>
  )
}
