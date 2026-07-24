import { useEffect, useState } from 'react'
import Icon from './Icon'
import { getSystemStatus, getErrorCatalog, healWebhook, runWatcher, isAdmin } from '../api/norack'

// The "ระบบ" badge — the one place in the header that answers "is anything wrong right now?".
//
// It exists because on 2026-07-10 Loyverse silently disabled our customer webhook and the only notice was
// an email. Nothing in the app could have told a staff member that new customers had stopped arriving.
//
// Rules it must obey:
//  • fail-closed — a status we cannot fetch, or one the cron hasn't refreshed in 15 minutes, is GREY
//    ("ไม่ทราบสถานะ"), never green. A green light we cannot justify is worse than no light.
//  • every staff member sees it. Knowing the system is healthy is not an admin privilege; only the FIX is.
//  • it never calls Loyverse. The backend serves a cache the watcher cron writes every 4 hours.
const COLORS = {
  ok: { dot: '#4ade80', label: 'ปกติ' },
  warning: { dot: '#fbbf24', label: 'มีบางอย่างผิดปกติ' },
  critical: { dot: '#f87171', label: 'ระบบมีปัญหา' },
  unknown: { dot: '#9ca3af', label: 'ไม่ทราบสถานะ' },
  offline: { dot: '#9ca3af', label: 'ต่อ backend ไม่ได้' },
}

export default function SystemBadge({ pollMs = 30000 }) {
  const [status, setStatus] = useState(null)
  const [catalog, setCatalog] = useState({})
  const [open, setOpen] = useState(false)
  const [healing, setHealing] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    getErrorCatalog().then((d) => alive && setCatalog(d.catalog || {})).catch(() => {})
    const tick = () =>
      getSystemStatus()
        .then((d) => alive && setStatus(d))
        // We could not reach ANY backend — that itself is the status, and no endpoint is needed to know it.
        .catch(() => alive && setStatus({ level: 'offline', codes: ['A3_BOTH_DOWN'] }))
    tick()
    const id = setInterval(tick, pollMs)
    return () => { alive = false; clearInterval(id) }
  }, [pollMs])

  const level = status?.level ?? 'unknown'
  const c = COLORS[level] ?? COLORS.unknown
  const codes = status?.codes ?? []
  const canHeal = isAdmin() && codes.includes('C1_LOYVERSE_WEBHOOK_DISABLED')
  const canRun = isAdmin() && codes.includes('C5_RECONCILE_STALE')

  async function onHeal() {
    setHealing(true); setNote('')
    try {
      const r = await healWebhook()
      setNote(r.healed?.length ? `เปิดคืนแล้ว: ${r.healed.join(', ')}` : 'ไม่มีอะไรต้องเปิดคืน')
      setStatus(await getSystemStatus())
    } catch (e) {
      setNote(`เปิดคืนไม่สำเร็จ: ${e.message}`)
    } finally { setHealing(false) }
  }

  async function onRun() {
    setHealing(true); setNote('')
    try {
      const r = await runWatcher()
      const cu = r.customers ? `ลูกค้า ${r.customers.upserted}/${r.customers.scanned}` : ''
      const rc = r.receipts ? ` · ใบเสร็จ ${r.receipts.applied}/${r.receipts.scanned}` : ''
      setNote(`ดึงข้อมูลแล้ว: ${cu}${rc}`)
      setStatus(await getSystemStatus())
    } catch (e) {
      // Losing the response is not the same as the job failing: the pass runs to completion on the server
      // and the browser cannot cancel it. Ask the server what actually happened rather than reporting a
      // failure we never observed — a reconcile stamped in the last few minutes means the pass finished.
      const s = await getSystemStatus().catch(() => null)
      if (s) setStatus(s)
      const ts = Date.parse(s?.last_reconcile_at ?? '')
      if (Number.isFinite(ts) && Date.now() - ts < 5 * 60 * 1000) {
        setNote('ดึงข้อมูลเสร็จแล้ว (เซิร์ฟเวอร์ตอบกลับช้า ไม่ได้ล้มเหลว)')
      } else {
        setNote(`ดึงข้อมูลไม่สำเร็จ: ${e.message}`)
      }
    } finally { setHealing(false) }
  }

  const title = `ระบบ — ${c.label}${codes.length ? ` (${codes.join(', ')})` : ''}`

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} title={title} aria-label={title}
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 10px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.12)', borderRadius: 'var(--radius-md)',
          border: `1.5px solid ${level === 'critical' ? c.dot : 'rgba(255,255,255,0.25)'}` }}>
        <Icon name="message" size={17} color="rgba(255,255,255,0.85)" />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.dot, flexShrink: 0, boxShadow: `0 0 0 3px ${c.dot}33` }} />
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: 46, zIndex: 200, width: 340, color: 'var(--text-body)',
          background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.25))', padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.dot }} />
            <strong style={{ fontSize: 15 }}>สถานะระบบ — {c.label}</strong>
            <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}>
              <Icon name="x" size={16} color="var(--text-muted)" />
            </button>
          </div>

          {level === 'ok' && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>ทุกอย่างทำงานปกติ · ตรวจล่าสุด {fmt(status?.webhooks_checked_at)}</div>}
          {level === 'unknown' && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>ยังไม่มีผลตรวจล่าสุด (ตัวตรวจรันทุก 4 ชม.) — ไม่ได้แปลว่าพัง แต่ยืนยันไม่ได้ว่าปกติ</div>}

          {codes.map((code) => {
            const e = catalog[code]
            return (
              <div key={code} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{code}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {code === 'C5_RECONCILE_STALE' && status?.reconcile_never_ran
                    ? 'ตัวดึงข้อมูลย้อนหลังยังไม่เคยรัน (รอบแรกหลัง deploy)'
                    : e?.title ?? 'ข้อผิดพลาดที่ไม่รู้จัก'}
                </div>
                {e?.fix && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{e.fix}</div>}
              </div>
            )
          })}

          {canRun && (
            <button onClick={onRun} disabled={healing}
              style={{ marginTop: 12, width: '100%', height: 38, borderRadius: 'var(--radius-md)', cursor: healing ? 'wait' : 'pointer',
                border: '1.5px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-strong)', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
              {healing ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลตอนนี้'}
            </button>
          )}
          {canHeal && (
            <button onClick={onHeal} disabled={healing}
              style={{ marginTop: 12, width: '100%', height: 38, borderRadius: 'var(--radius-md)', cursor: healing ? 'wait' : 'pointer',
                border: 'none', background: 'var(--brand-600, #2563eb)', color: '#fff', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
              {healing ? 'กำลังเปิดคืน…' : 'เปิด webhook คืน'}
            </button>
          )}
          {note && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{note}</div>}

          {status?.db === 'up' && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-faint)', display: 'grid', gap: 2 }}>
              <div>ดึงข้อมูลย้อนหลังล่าสุด: {fmt(status.last_reconcile_at)}</div>
              <div>รอเข้าระบบ (DLQ): {status.dlq_unresolved ?? 0} · ข้อผิดพลาดค้าง: {status.open_errors ?? 0}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}
