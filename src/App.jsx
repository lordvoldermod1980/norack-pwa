import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TabletDashboard from './pages/TabletDashboard'
import AuthGate from './components/AuthGate'

export default function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/tablet" element={<TabletDashboard />} />
          <Route path="/dashboard" element={<TabletDashboard />} />
          <Route path="*" element={<Navigate to="/tablet" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}
