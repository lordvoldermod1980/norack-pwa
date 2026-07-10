import { Component } from 'react'
import { reportClientError } from '../api/norack'

// A crash used to mean a white screen and no trace. Now it shows a code the staff member can act on (or
// paste into a chat) and reports itself to /api/system/client-errors, where it joins the same error log as
// backend failures. The message is sanitized server-side — never send a customer's data here.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { crashed: false }
  }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error) {
    reportClientError({
      code: 'C9_FRONTEND_CRASH',
      route: window.location.pathname,
      message: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
    })
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', gap: 12, padding: 24, textAlign: 'center', fontFamily: 'var(--font-sans)' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>เกิดข้อผิดพลาด</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-faint)' }}>C9_FRONTEND_CRASH</div>
        <div style={{ fontSize: 15, color: 'var(--text-muted)', maxWidth: 420 }}>
          รายงานถูกส่งให้ระบบแล้ว · กด "โหลดใหม่" เพื่อใช้งานต่อ ถ้าเกิดซ้ำ ให้แจ้ง admin พร้อมรหัสด้านบน
        </div>
        <button onClick={() => window.location.reload()}
          style={{ marginTop: 8, height: 44, padding: '0 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--brand-600, #2563eb)', color: '#fff', fontWeight: 600, fontSize: 15 }}>
          โหลดใหม่
        </button>
      </div>
    )
  }
}
