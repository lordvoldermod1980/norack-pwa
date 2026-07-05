import { useState, useEffect } from 'react'
import { login, isAuthed, getBackend, setBackend, BACKEND_LABELS, refreshToken } from '../api/norack'

// Wraps the app: shows a login screen until a Bearer token exists. Listens for `norack-unauth`
// (fired by the API adapter on a 401) to drop back to login. See docs/phase6-frontend-cutover.md.
export default function AuthGate({ children }) {
  const [authed, setAuthed] = useState(isAuthed())
  useEffect(() => {
    const onUnauth = () => setAuthed(false)
    window.addEventListener('norack-unauth', onUnauth)
    return () => window.removeEventListener('norack-unauth', onUnauth)
  }, [])
  // Sliding session keep-alive: slide the 7-day token on app load, when the tab becomes visible again
  // (throttled to ≥1h so quick tab-flips don't spam it), and every 6h. If the session was revoked
  // (token_version bumped / disabled) the refresh returns 401 → apiCall fires `norack-unauth` → back to login.
  useEffect(() => {
    if (!authed) return
    let last = 0
    const MIN_GAP_MS = 60 * 60 * 1000
    const slide = () => { last = Date.now(); refreshToken() }
    slide()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > MIN_GAP_MS) slide()
    }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(slide, 6 * 60 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [authed])
  if (authed) return children
  return <LoginScreen onAuthed={() => setAuthed(true)} />
}

function LoginScreen({ onAuthed }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [backend, setBackendState] = useState(getBackend())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      setBackend(backend)
      await login(username.trim(), password)
      onAuthed()
    } catch (e2) {
      setErr(e2.message || 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const field = {
    width: '100%', padding: '12px 14px', fontSize: 'var(--fs-body, 16px)',
    borderRadius: 'var(--radius-md, 10px)', border: '1px solid var(--border-subtle, #d9d9e0)',
    background: 'var(--surface, #fff)', color: 'var(--text-strong, #16161c)', outline: 'none',
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-sunken, #f4f4f7)', fontFamily: 'var(--font-sans, system-ui)', padding: 20 }}>
      <form onSubmit={submit} style={{ width: 360, maxWidth: '100%', background: 'var(--surface, #fff)',
        borderRadius: 'var(--radius-lg, 16px)', border: '1px solid var(--border-subtle, #e5e5ea)',
        padding: 28, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 8px 30px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-strong, #16161c)' }}>NO.Rack</div>
          <div style={{ fontSize: 13, color: 'var(--text-body, #6b6b76)' }}>เข้าสู่ระบบพนักงาน</div>
        </div>
        <input style={field} placeholder="ชื่อผู้ใช้" value={username} autoFocus autoCapitalize="none"
          onChange={(e) => setUsername(e.target.value)} />
        <input style={field} type="password" placeholder="รหัสผ่าน" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <label style={{ fontSize: 12, color: 'var(--text-body, #6b6b76)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          เซิร์ฟเวอร์
          <select style={field} value={backend} onChange={(e) => setBackendState(e.target.value)}>
            {Object.entries(BACKEND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {err && <div style={{ color: 'var(--red-700, #c0362c)', fontSize: 13, textAlign: 'center' }}>{err}</div>}
        <button type="submit" disabled={busy || !username || !password} style={{
          padding: '12px 14px', fontSize: 16, fontWeight: 700, borderRadius: 'var(--radius-md, 10px)',
          border: 'none', cursor: busy ? 'default' : 'pointer', color: '#fff',
          background: busy ? 'var(--gray-400, #9a9aa5)' : 'var(--brand-600, #2f6bff)', opacity: (!username || !password) ? 0.6 : 1 }}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  )
}
