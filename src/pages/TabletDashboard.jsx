import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, memo } from 'react'
import { getOpenBills, getBillStatus, updateStatus, customerLookup, openBill, uploadPhoto, updateBill, deleteBill, getBackend, setBackend, BACKEND_LABELS, getReview, syncCustomer, exportBackup, importPreview, importApply, signOut, currentUser } from '../api/norack'
import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import { toStatusKey } from '../lib/status'
import PhotoThumb from '../components/PhotoThumb'
import NRButton from '../components/NRButton'
import { saveBackupXlsx } from '../lib/exportXlsx'
import { parseBackupXlsx } from '../lib/importXlsx'

// ─── data helpers ─────────────────────────────────────────────────────────────

// final_date (dd/mm/yyyy พ.ศ.) → จำนวนวันจากวันนี้ (null ถ้าว่าง/ผิดรูปแบบ)
function daysSinceFinal(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const d = new Date(+m[3] - 543, +m[2] - 1, +m[1])   // -543 = พ.ศ. → ค.ศ.
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function mapBill(b) {
  return {
    rack:     b.rack_id     || b.Rack_ID      || '',
    customer: b.customer_id || b.Customer_ID  || '',
    name:     b.name        || b.customer_name || b.Customer_Name || b.customer_id || '—',
    bags:     parseInt(b.total_bags || b['Total.Bags'] || 0) || 0,
    status:   toStatusKey(b.status  || b['สถานะ'] || ''),
    shelf:    b.no_shelf    || b['No.Shelf']  || '—',
    rack_no:  b.no_rack     || b['No.Rack']   || '—',
    opened:     b.open_date   || b['วันที่เปิดบิล'] || '',
    final_date: b.final_date  || b['Final Date'] || '',
    done_date:  b.done_date   || '',
    positions:  Array.isArray(b.positions) ? b.positions : undefined,
  }
}

function mapCustomer(c) {
  return {
    id:            c.customer_id   || c.Customer_ID    || '',
    name:          c.name          || c.customer_name   || c.Customer_Name  || '—',
    tel:           c.phone         || c.Phone_Number    || c.phone_number   || '—',
    loyverse_uuid: c.loyverse_uuid || c.Loyverse_UUID   || '',
    created:       c['Create Date'] || c.create_date    || c.Create_Date    || '',
    updated:       c.up_date        || c['Up Date']     || c['UP Date']     || c['Update Date'] || c.update_date || c.UP_Date || '',
  }
}

function getTodayThai() {
  const now = new Date()
  const d = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })
  const t = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
  return `${d} · ${t}`
}

function getTodayThaiShort() {
  return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' })
}

// ─── primitives ───────────────────────────────────────────────────────────────

function Avatar({ name = '', size = 40 }) {
  const initials = (name.trim() || '?').split(/\s+/).map(w => w[0] || '').slice(0, 1).join('').toUpperCase()
  const hue = name.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) & 0xffff, 0)
  const COLORS = ['#1F9D6B', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899']
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: COLORS[hue % COLORS.length], color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: Math.round(size * 0.38),
      flexShrink: 0, userSelect: 'none',
    }}>{initials}</span>
  )
}

function Spinner({ size = 24, color = 'var(--brand)' }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${color}`, borderTopColor: 'transparent',
      display: 'inline-block', animation: 'norack-spin 0.7s linear infinite', flexShrink: 0,
    }} />
  )
}

function SearchInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
        <Icon name="search" size={18} />
      </span>
      {value && (
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}>
          <Icon name="x" size={16} />
        </button>
      )}
      <input autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', height: 44, boxSizing: 'border-box', paddingLeft: 40, paddingRight: value ? 36 : 14,
          border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
          background: 'var(--surface-card)', color: 'var(--text-body)', outline: 'none' }} />
    </div>
  )
}

function EmptyState({ icon = 'receipt', text, sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 'var(--space-12)', color: 'var(--text-muted)' }}>
      <Icon name={icon} size={44} color="var(--text-faint)" />
      <p style={{ marginTop: 'var(--space-3)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', color: 'var(--text-muted)', margin: 'var(--space-3) 0 0' }}>{text}</p>
      {sub && <p style={{ fontSize: 'var(--fs-sub)', color: 'var(--text-faint)', margin: 'var(--space-2) 0 0' }}>{sub}</p>}
    </div>
  )
}

// self-contained clock — tick ทุก 30 วิ re-render เฉพาะตัวเอง ไม่ลามทั้ง dashboard
function Clock() {
  const [now, setNow] = useState(getTodayThai)
  useEffect(() => {
    const id = setInterval(() => setNow(getTodayThai()), 30000)
    return () => clearInterval(id)
  }, [])
  return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{now}</div>
}

// ─── backend switch (CF ↔ Deno) + live status ─────────────────────────────────
// Flip the API target without logging out. The dot shows which backend actually served the last request
// (green = CF primary, amber = Deno backup); the border turns amber if a silent auto-failover kicked in.
function BackendSwitch() {
  const [sel, setSel] = useState(getBackend())
  const [active, setActive] = useState(getBackend())
  useEffect(() => {
    const onActive = (e) => setActive(e.detail)
    window.addEventListener('norack-backend-active', onActive)
    return () => window.removeEventListener('norack-backend-active', onActive)
  }, [])
  const change = (e) => { const b = e.target.value; setBackend(b); setSel(b); setActive(b) }
  const failedOver = active !== sel
  const dot = active === 'deno' ? '#fbbf24' : '#4ade80'
  return (
    <div title={`กำลังใช้: ${BACKEND_LABELS[active] || active}${failedOver ? ' (สลับอัตโนมัติ)' : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 8px',
        background: 'rgba(255,255,255,0.12)', borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${failedOver ? '#fbbf24' : 'rgba(255,255,255,0.25)'}` }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0, boxShadow: `0 0 0 3px ${dot}33` }} />
      <select value={sel} onChange={change} title="เลือกเซิร์ฟเวอร์"
        style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 13 }}>
        {Object.entries(BACKEND_LABELS).map(([k, label]) => (
          <option key={k} value={k} style={{ color: '#000' }}>{label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── date field — always shows dd/mm/yyyy, calendar icon on right opens picker ──

function DateField({ value, onChange, readOnly = false }) {
  const inputRef = useRef(null)

  const display = value ? (() => {
    const [y, m, d] = value.split('-').map(Number)
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`
  })() : ''

  const openPicker = () => {
    if (readOnly) return
    try { inputRef.current?.showPicker() } catch { inputRef.current?.click() }
  }

  return (
    <div onClick={openPicker} style={{
      display: 'flex', alignItems: 'center', height: 48, padding: '0 14px',
      border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      background: readOnly ? 'var(--surface-sunken)' : 'var(--surface-card)',
      cursor: readOnly ? 'default' : 'pointer', position: 'relative',
    }}>
      <span style={{
        flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body)',
        color: display ? 'var(--text-body)' : 'var(--text-faint)', userSelect: 'none',
      }}>
        {display || 'วว/ดด/ปปปป'}
      </span>
      {!readOnly && <Icon name="calendar" size={18} color="var(--text-muted)" />}
      {!readOnly && (
        <input ref={inputRef} type="date" value={value} onChange={onChange}
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} />
      )}
    </div>
  )
}

// ─── section divider used in modal ───────────────────────────────────────────

function SectionLabel({ num, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-brand)', fontWeight: 700, flexShrink: 0 }}>{num} ·</span>
      <span style={{ fontSize: 'var(--fs-sub)', fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
      {sub && <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', fontWeight: 400 }}>{sub}</span>}
    </div>
  )
}

// ─── position zone config ─────────────────────────────────────────────────────

const ZONES = [
  { key: 'ราวหลัก', start: 1,  count: 16, unit: 'ราว' },
  { key: 'บ้านตา',  start: 17, count: 6,  unit: 'ราว' },
  { key: 'ชั้นวาง', start: 23, count: 2,  unit: 'ชั้น' },
  { key: 'บนพื้น',  start: 0,  count: 0,  unit: '',  unslotted: true },
]

function todayISO() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function thaiDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`
}

// position key/label helpers — ใช้ร่วมกันใน OpenBill/Done/EditBill modal
const mkPosKey = (zone, slot) => (slot != null ? `${zone}|${slot}` : zone)
const mkPosLabel = (zone, slot) => {
  const z = ZONES.find(zz => zz.key === zone)
  return slot != null ? `${z?.unit || zone} ${slot}` : zone
}

// parse "DD/MM/YYYY" (พ.ศ.) → comparable number YYYYMMDD, or null if invalid
function parseThaiDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = +m[1], mo = +m[2], y = +m[3]
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null
  return y * 10000 + mo * 100 + d
}

// ─── position picker ──────────────────────────────────────────────────────────

function PositionPicker({ zone, onZone, selectedPositions, onToggle, positionBags, onBagChange, bills = [] }) {
  const curZone = ZONES.find(z => z.key === zone)

  const isSelected = (z, s) => selectedPositions.some(p =>
    p.zone === z && (s != null ? p.slot === s : p.slot == null)
  )

  const slotBills = (n) => bills.filter(b =>
    b.shelf === zone && b.rack_no === String(n) && b.status !== 'received'
  ).length

  return (
    <div>
      {/* selected chips */}
      {selectedPositions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          {selectedPositions.map(p => (
            <div key={p.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 38, padding: '0 10px 0 12px',
              background: 'var(--brand-600)', color: '#fff',
              borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-sub)', fontWeight: 600,
            }}>
              <span style={{ whiteSpace: 'nowrap' }}>{p.label}</span>
              <input
                type="number" min="0" inputMode="numeric"
                value={positionBags[p.key] ?? ''}
                onChange={e => onBagChange(p.key, e.target.value)}
                placeholder="0"
                style={{
                  width: 44, height: 24, textAlign: 'center', padding: '0 4px',
                  background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.4)',
                  borderRadius: 6, color: '#fff', fontFamily: 'var(--font-mono)',
                  fontSize: 13, fontWeight: 700, outline: 'none', WebkitAppearance: 'none', MozAppearance: 'textfield',
                }}
              />
              <span style={{ fontSize: 12, opacity: 0.85 }}>ถุง</span>
              <button onClick={() => onToggle(p.zone, p.slot)} style={{
                width: 18, height: 18, borderRadius: '50%', border: 'none', padding: 0,
                background: 'rgba(255,255,255,0.22)', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 2,
              }}>
                <Icon name="x" size={10} color="#fff" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* zone tabs with count badges */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        {ZONES.map(z => {
          const cnt = selectedPositions.filter(p => p.zone === z.key).length
          return (
            <button key={z.key} onClick={() => onZone(z.key)} style={{
              height: 36, padding: '0 14px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
              border: '1.5px solid ' + (z.key === zone ? 'var(--brand-500)' : 'var(--border-subtle)'),
              background: z.key === zone ? 'var(--brand-tint)' : 'var(--surface-card)',
              color: z.key === zone ? 'var(--text-brand)' : 'var(--text-body)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)',
              fontWeight: z.key === zone ? 600 : 400,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {z.key}
              {cnt > 0 && (
                <span style={{
                  minWidth: 18, height: 18, borderRadius: 'var(--radius-pill)', padding: '0 4px',
                  background: 'var(--brand-600)', color: '#fff',
                  fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{cnt}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* slot grid or floor zone */}
      {curZone && !curZone.unslotted ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 'var(--space-2)' }}>
          {Array.from({ length: curZone.count }, (_, i) => curZone.start + i).map(n => {
            const sel = isSelected(zone, n)
            const occ = slotBills(n)
            return (
              <button key={n} onClick={() => onToggle(zone, n)} style={{
                padding: '8px 4px', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center',
                border: '1.5px solid ' + (sel ? 'var(--brand-500)' : 'var(--border-subtle)'),
                background: sel ? 'var(--brand-tint)' : 'var(--surface-card)',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: sel ? 'var(--text-brand)' : 'var(--text-strong)' }}>
                  {curZone.unit} {n}
                </div>
                <div style={{ fontSize: 11, marginTop: 2, color: occ ? 'var(--text-muted)' : 'var(--green-700)' }}>
                  {occ ? `${occ} งาน` : 'ว่าง'}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <button onClick={() => onToggle(zone, null)} style={{
          width: '100%', padding: 'var(--space-4)', cursor: 'pointer', textAlign: 'center',
          border: '1.5px ' + (isSelected(zone, null) ? 'solid var(--brand-500)' : 'dashed var(--border-default)'),
          borderRadius: 'var(--radius-md)',
          background: isSelected(zone, null) ? 'var(--brand-tint)' : 'var(--surface-sunken)',
          color: isSelected(zone, null) ? 'var(--text-brand)' : 'var(--text-muted)',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', fontWeight: isSelected(zone, null) ? 600 : 400,
        }}>
          {isSelected(zone, null) ? '✓ วางบนพื้น — เลือกแล้ว' : 'วางบนพื้น — ไม่มีหมายเลขช่อง'}
          {!isSelected(zone, null) && <div style={{ fontSize: 'var(--fs-caption)', marginTop: 4, color: 'var(--text-faint)' }}>อ้างอิงโดย Rack ID</div>}
        </button>
      )}
    </div>
  )
}

// ─── open bill modal ──────────────────────────────────────────────────────────

function OpenBillModal({ prefillCustId = '', onClose, onCreate }) {
  const [custInput, setCustInput]         = useState(prefillCustId)
  const [custMatch, setCustMatch]         = useState(null)
  const [custSearching, setCustSearching] = useState(false)
  const [loyverseUuid, setLoyverseUuid]   = useState('')
  const [receiptNo, setReceiptNo]         = useState('')
  const [openDate, setOpenDate]           = useState(todayISO)
  const [note, setNote]                   = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState('')
  const [result, setResult]               = useState(null)
  const custTimer = useRef(null)

  useEffect(() => {
    if (prefillCustId) lookupCust(prefillCustId)
  }, []) // eslint-disable-line

  function lookupCust(q) {
    setCustInput(q)
    if (custTimer.current) clearTimeout(custTimer.current)
    if (!q.trim()) { setCustMatch(null); setLoyverseUuid(''); return }
    custTimer.current = setTimeout(async () => {
      setCustSearching(true)
      try {
        const data = await customerLookup(q)
        const list = (data.customers ?? data ?? []).map(mapCustomer)
        const match = list[0] || null
        setCustMatch(match)
        if (match?.loyverse_uuid) setLoyverseUuid(match.loyverse_uuid)
      } catch { setCustMatch(null) }
      finally { setCustSearching(false) }
    }, 300)
  }

  // validation
  const custNotFound = custInput.trim() && !custMatch && !custSearching
  const canSubmit = !!custMatch && !!openDate

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const data = await openBill({
        customer_id:    custMatch?.id || custInput.trim(),
        customer_name:  custMatch?.name || '',
        customer_tel:   custMatch?.tel || '',
        loyverse_uuid:  loyverseUuid.trim(),
        receipt_number: receiptNo.trim(),
        open_date:      thaiDate(openDate),
        note:           note.trim(),
      })
      setResult(data)
    } catch {
      setError('เปิดบิลไม่สำเร็จ กรุณาลองใหม่')
    } finally { setSubmitting(false) }
  }

  const inp = {
    width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px',
    border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
    background: 'var(--surface-card)', color: 'var(--text-body)', outline: 'none',
  }

  const divider = { marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,26,24,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div style={{ width: 640, maxHeight: '94vh', borderRadius: 'var(--radius-xl)', background: 'var(--surface-card)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'norack-fade-up var(--dur-base) var(--ease-out)' }}>

        {/* header */}
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--text-strong)' }}>เปิดบิลใหม่</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>บันทึกลง Master Register · {getTodayThaiShort()}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 'var(--radius-sm)' }}>
            <Icon name="x" size={22} />
          </button>
        </div>

        {result ? (
          /* ── success ── */
          <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-4)' }}>
              <Icon name="check" size={30} color="var(--brand-600)" />
            </div>
            <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>เปิดบิลสำเร็จ</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--text-brand)', letterSpacing: '0.04em', marginBottom: 'var(--space-5)' }}>
              {result.rack_id}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', textAlign: 'left', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
              {[
                ['ลูกค้า',     custMatch?.name || custInput],
                ['วันที่เปิด', thaiDate(openDate)],
                ...(receiptNo ? [['Receipt', receiptNo]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <NRButton block variant="primary" iconLeft={<Icon name="receipt" size={18} color="#fff" />} onClick={() => onCreate(result)}>
                ไปหน้าทะเบียน
              </NRButton>
              <NRButton block variant="outline" onClick={onClose}>ปิด</NRButton>
            </div>
          </div>
        ) : (
          /* ── form ── */
          <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-6)' }}>

            {/* 1 · Rack ID */}
            <div style={divider}>
              <SectionLabel num="1" title="Rack ID" sub="สร้างอัตโนมัติ (1 ชิ้งงาน = 1 Rack ID)" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '12px 14px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <Icon name="receipt" size={18} color="var(--text-faint)" />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sub)', color: 'var(--text-faint)', fontStyle: 'italic' }}>สร้างอัตโนมัติหลังจากกด "เปิดบิล"</span>
              </div>
            </div>

            {/* 2 · Customer ID */}
            <div style={divider}>
              <SectionLabel num="2" title="Customer ID" sub="วางจากหน้า Customer Database หรือพิมพ์ค้นหา" />
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                  <Icon name="user" size={18} />
                </span>
                {custSearching && (
                  <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
                    <Spinner size={16} />
                  </span>
                )}
                <input autoFocus value={custInput} onChange={e => lookupCust(e.target.value)}
                  placeholder="C-001 หรือพิมพ์ชื่อ / เบอร์โทร"
                  style={{ ...inp, paddingLeft: 44, borderColor: custMatch ? 'var(--brand-400)' : 'var(--border-subtle)' }} />
              </div>
              {custMatch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--brand-tint)', border: '1px solid var(--brand-100)', borderRadius: 'var(--radius-md)' }}>
                  <Avatar name={custMatch.name} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--fs-body)' }}>{custMatch.name}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-body)' }}>{custMatch.id} · {custMatch.tel}</div>
                  </div>
                  <Icon name="check" size={20} color="var(--brand-600)" />
                </div>
              )}
              {custNotFound && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--red-50)', border: '1px solid var(--red-500)', borderRadius: 'var(--radius-md)', color: 'var(--red-700)', fontSize: 'var(--fs-sub)' }}>
                  <Icon name="x" size={16} color="var(--red-700)" /> ไม่พบลูกค้า — ตรวจสอบรหัส / ชื่อ / เบอร์โทร (ต้องเลือกลูกค้าที่มีอยู่)
                </div>
              )}
            </div>

            {/* 3 · Loyverse UUID */}
            <div style={divider}>
              <SectionLabel num="3" title="Loyverse UUID" sub="จาก Loyverse API · auto-fill จาก Customer ID" />
              <input value={loyverseUuid} onChange={e => setLoyverseUuid(e.target.value)}
                placeholder="0c8a4f2e-1b3d-4c5a-… (วางไว้ได้)"
                style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sub)', color: loyverseUuid ? 'var(--text-body)' : 'var(--text-faint)' }} />
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', marginTop: 6 }}>
                auto · track เพื่อใช้ในอนาคต · ว่างได้ถ้ายังไม่มี
              </div>
            </div>

            {/* 4 · Receipt Number */}
            <div style={divider}>
              <SectionLabel num="4" title="Receipt Number" sub="Receipt จาก POS API · ว่างไว้ได้" />
              <input value={receiptNo} onChange={e => setReceiptNo(e.target.value)}
                placeholder="รอเชื่อม POS API (ว่างไว้ได้)"
                style={inp} />
            </div>

            {/* 5 · ชื่อ & เบอร์โทร */}
            <div style={divider}>
              <SectionLabel num="5" title="ชื่อ & เบอร์โทร" sub="auto-fill จาก Customer ID" />
              {custMatch ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  {[['ชื่อลูกค้า', custMatch.name], ['เบอร์โทร', custMatch.tel]].map(([l, v]) => (
                    <div key={l} style={{ padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{l}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sub)', fontWeight: 600, color: 'var(--text-strong)' }}>{v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-subtle)', color: 'var(--text-faint)', fontSize: 'var(--fs-sub)' }}>
                  กรอก Customer ID ด้านบนก่อน
                </div>
              )}
            </div>

            {/* 6 · วันที่ */}
            <div style={{ marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
              <SectionLabel num="6" title="วันที่" sub="วันเปิดบิล = วันนี้ · วันซักเสร็จ/รับผ้า เติมอัตโนมัติเมื่อปิดบิล" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>
                    วันเปิดบิล <span style={{ color: 'var(--red-500)' }}>*</span>
                  </div>
                  <DateField value={openDate} onChange={e => setOpenDate(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันซักเสร็จ</div>
                  <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 14px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', gap: 8 }}>
                    <Icon name="calendar" size={15} color="var(--text-faint)" />
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', fontStyle: 'italic' }}>auto — เมื่อซักเสร็จ</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันรับผ้า</div>
                  <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 14px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', gap: 8 }}>
                    <Icon name="calendar" size={15} color="var(--text-faint)" />
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', fontStyle: 'italic' }}>auto — จาก POS</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 7 · NOTE */}
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <SectionLabel num="7" title="NOTE" sub="ถ้ามี (ไม่บังคับ)" />
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="เช่น ซักพิเศษ, แยกถุง, หมายเหตุพิเศษ…" rows={2}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-body)', color: 'var(--text-body)', resize: 'none', outline: 'none', background: 'var(--surface-card)', fontFamily: 'var(--font-sans)' }} />
            </div>

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-3)', marginBottom: 'var(--space-4)', background: 'var(--red-50)', border: '1px solid var(--red-500)', borderRadius: 'var(--radius-md)', color: 'var(--red-700)', fontSize: 'var(--fs-sub)' }}>
                <Icon name="x" size={18} color="var(--red-700)" /> {error}
              </div>
            )}

            <NRButton block size="lg" disabled={!canSubmit} loading={submitting}
              iconLeft={<Icon name="receipt" size={20} color="#fff" />}
              onClick={submit}>
              {submitting ? 'กำลังเปิดบิล...' : 'เปิดบิล'}
            </NRButton>

          </div>
        )}
      </div>
    </div>
  )
}

// ─── done modal (ปิดบิล / ซักเสร็จ) ─────────────────────────────────────────

function DoneModal({ bill, detail, onClose, onSaved }) {
  const raw = detail?.bill || {}
  const cust = detail?.customer || null
  const custName = (cust?.name && cust.name !== '—') ? cust.name
    : (bill.name && bill.name !== bill.customer) ? bill.name : bill.customer || '—'
  const phone = cust?.tel && cust.tel !== '—' ? cust.tel
    : raw.phone_number || raw.Phone_Number || '—'

  const [posZone, setPosZone] = useState(ZONES[0].key)
  const [selectedPositions, setSelectedPositions] = useState([])
  const [positionBags, setPositionBags] = useState({})
  const [doneDate, setDoneDate] = useState(todayISO)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function togglePosition(zone, slot) {
    const key = mkPosKey(zone, slot)
    if (selectedPositions.some(p => p.key === key)) {
      setSelectedPositions(prev => prev.filter(p => p.key !== key))
      setPositionBags(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      setSelectedPositions(prev => [...prev, { key, zone, slot, label: mkPosLabel(zone, slot) }])
    }
  }
  const setBagForKey = (key, val) => setPositionBags(prev => ({ ...prev, [key]: val }))
  const totalBags = Object.values(positionBags).reduce((s, v) => s + (Number(v) || 0), 0)
  const noPosition = selectedPositions.length === 0
  const posMissingBags = selectedPositions.length > 0 && selectedPositions.some(p => !(Number(positionBags[p.key]) > 0))
  const canSubmit = !noPosition && !posMissingBags && !!doneDate && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      // 1) flip status → เสร็จสิ้น ก่อน (backend อาจ stamp done_date = วันนี้ ตอนเปลี่ยนสถานะ)
      const s = await updateStatus(bill.rack, 'เสร็จสิ้น')
      if (s && s.status === 'error') throw new Error(s.error || 'status failed')
      // 2) เขียนรายละเอียด "ทีหลัง" เพื่อให้ positions/bags/done_date ที่ผู้ใช้กรอกเป็นตัวชนะ
      const res = await updateBill({
        rack_id:        bill.rack,
        customer_id:    bill.customer,
        loyverse_uuid:  raw.loyverse_uuid || '',
        receipt_number: raw.receipt_number || '',
        no_rack:        selectedPositions[0]?.slot?.toString() || '',
        no_shelf:       selectedPositions[0]?.zone || '',
        total_bags:     totalBags,
        positions:      selectedPositions.map(p => ({ zone: p.zone, slot: p.slot, bags: Number(positionBags[p.key]) || 0 })),
        open_date:      bill.opened || '',
        done_date:      thaiDate(doneDate),
        final_date:     raw.final_date || '',
        note:           note.trim(),
      })
      if (res && res.status === 'error') throw new Error(res.error || 'update failed')
      onSaved()
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่')
      setSubmitting(false)
    }
  }

  const divider = { marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,26,24,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose() }}>
      <div style={{ width: 580, maxHeight: '94vh', borderRadius: 'var(--radius-xl)', background: 'var(--surface-card)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'norack-fade-up var(--dur-base) var(--ease-out)' }}>

        {/* header */}
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--text-strong)' }}>ปิดบิล (ซักเสร็จ)</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>
              กรอกตำแหน่งผ้า + จำนวนถุง ก่อนบันทึก · Rack <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-brand)' }}>{bill.rack}</b>
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 'var(--radius-sm)' }}>
            <Icon name="x" size={22} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-6)' }}>

          {/* 1 · Rack ID */}
          <div style={divider}>
            <SectionLabel num="1" title="Rack ID" sub="ไม่สามารถแก้ไขได้" />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <Icon name="receipt" size={18} color="var(--text-muted)" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>{bill.rack}</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>ล็อก</span>
            </div>
          </div>

          {/* 2 · Customer */}
          <div style={divider}>
            <SectionLabel num="2" title="ลูกค้า" sub="auto-fill จากบิล" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '11px 14px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 'var(--radius-md)' }}>
              <Avatar name={custName} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--fs-body)' }}>{custName}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>{bill.customer} · {phone}</div>
              </div>
              <Icon name="check" size={17} color="var(--text-brand)" />
            </div>
          </div>

          {/* 3 · ตำแหน่ง */}
          <div style={divider}>
            <SectionLabel num="3" title="ตำแหน่ง (NO.Rack / No.Shelf / OnGround)" sub="เลือกได้หลายที่ + จำนวนถุงต่อตำแหน่ง" />
            <PositionPicker
              zone={posZone} onZone={setPosZone}
              selectedPositions={selectedPositions} onToggle={togglePosition}
              positionBags={positionBags} onBagChange={setBagForKey}
            />
            {totalBags > 0 && (
              <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-sub)', color: 'var(--text-body)', fontWeight: 600 }}>
                จำนวนถุงรวม · <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-brand)' }}>{totalBags} ถุง</span>
              </div>
            )}
            {noPosition && <div style={{ marginTop: 8, fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>* เลือกตำแหน่งอย่างน้อย 1 ช่อง</div>}
          </div>

          {/* 4 · วันที่ */}
          <div style={divider}>
            <SectionLabel num="4" title="วันที่" sub="พ.ศ. DD/MM/YYYY · เปิดบิล ≤ ซักเสร็จ" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันเปิดบิล</div>
                <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 14px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body)', color: bill.opened ? 'var(--text-body)' : 'var(--text-faint)' }}>
                    {bill.opened || '—'}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันซักเสร็จ <span style={{ color: 'var(--red-500)' }}>*</span></div>
                <DateField value={doneDate} onChange={e => setDoneDate(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันรับผ้า</div>
                <DateField value="" readOnly />
              </div>
            </div>
          </div>

          {/* NOTE */}
          <div>
            <label style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
              NOTE <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(ถ้ามี)</span>
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="เช่น ซักพิเศษ, แยกถุง…" rows={2}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-body)', color: 'var(--text-body)', resize: 'none', outline: 'none', background: 'var(--surface-card)', fontFamily: 'var(--font-sans)' }} />
          </div>

          {error && <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-caption)', color: 'var(--red-700)', fontWeight: 600 }}>{error}</div>}
        </div>

        {/* footer */}
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <NRButton size="lg" loading={submitting} disabled={!canSubmit}
            style={{ width: '100%', height: 62, fontSize: 18, fontWeight: 700 }}
            onClick={submit}>
            บันทึกรายการ (ซักเสร็จ)
          </NRButton>
        </div>
      </div>
    </div>
  )
}

// ─── edit bill modal ──────────────────────────────────────────────────────────

function EditBillModal({ bill, detail, onClose, onSaved }) {
  const raw = detail?.bill || {}
  const initPos = billPositions(bill)

  const [custInput, setCustInput]   = useState(bill.customer || '')
  const [custMatch, setCustMatch]   = useState(null)
  const [custSearching, setCustSearching] = useState(false)
  const [loyverseUuid, setLoyverseUuid]   = useState(raw.loyverse_uuid || '')
  const [receiptNo, setReceiptNo]   = useState(raw.receipt_number || '')
  const [posZone, setPosZone]       = useState(initPos[0]?.zone || 'ราวหลัก')
  const [selectedPositions, setSelectedPositions] = useState(
    initPos.map(p => ({ key: mkPosKey(p.zone, p.slot), zone: p.zone, slot: p.slot, label: mkPosLabel(p.zone, p.slot) }))
  )
  const [positionBags, setPositionBags] = useState(() => {
    const m = {}
    initPos.forEach(p => { m[mkPosKey(p.zone, p.slot)] = p.bags || '' })
    return m
  })
  const [openDate, setOpenDate]     = useState(bill.opened || '')
  const [washDate, setWashDate]     = useState(raw.done_date || '')      // วันซักเสร็จ (Done_Date)
  const [finalDate, setFinalDate]   = useState(raw.final_date || '')     // วันรับผ้า (Final Date)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const custTimer = useRef(null)

  useEffect(() => { if ((bill.customer || '').trim()) lookupCust(bill.customer) }, []) // eslint-disable-line

  function lookupCust(q) {
    setCustInput(q)
    if (custTimer.current) clearTimeout(custTimer.current)
    if (!q.trim()) { setCustMatch(null); return }
    custTimer.current = setTimeout(async () => {
      setCustSearching(true)
      try {
        const data = await customerLookup(q)
        const list = (data.customers ?? data ?? []).map(mapCustomer)
        const match = list.find(c => c.id === q.trim()) || list[0] || null
        setCustMatch(match)
        if (match?.loyverse_uuid) setLoyverseUuid(match.loyverse_uuid)
      } catch { setCustMatch(null) }
      finally { setCustSearching(false) }
    }, 300)
  }

  function togglePosition(zone, slot) {
    const key = mkPosKey(zone, slot)
    if (selectedPositions.some(p => p.key === key)) {
      setSelectedPositions(prev => prev.filter(p => p.key !== key))
      setPositionBags(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      setSelectedPositions(prev => [...prev, { key, zone, slot, label: mkPosLabel(zone, slot) }])
    }
  }
  const setBagForKey = (key, val) => setPositionBags(prev => ({ ...prev, [key]: val }))

  const totalBags = Object.values(positionBags).reduce((s, v) => s + (Number(v) || 0), 0)
  const noPosition = selectedPositions.length === 0
  const posMissingBags = selectedPositions.length > 0 && selectedPositions.some(p => !(Number(positionBags[p.key]) > 0))
  // วันที่ต้องเป็น DD/MM/YYYY (พ.ศ.) และวันเปิดต้องไม่หลังวันสำเร็จ
  const openVal  = parseThaiDate(openDate)
  const washVal  = parseThaiDate(washDate)
  const finalVal = parseThaiDate(finalDate)
  const openInvalid  = !!openDate.trim()  && openVal  === null
  const washInvalid  = !!washDate.trim()  && washVal  === null
  const finalInvalid = !!finalDate.trim() && finalVal === null
  const gtDate = (a, b) => a != null && b != null && a > b   // ลำดับที่ถูก: เปิดบิล ≤ ซักเสร็จ ≤ รับผ้า
  const dateOrderError = gtDate(openVal, washVal) || gtDate(washVal, finalVal) || gtDate(openVal, finalVal)
  // ลำดับวันที่บล็อกเฉพาะเมื่อ "ผู้ใช้แก้วันที่เอง" — บิลเก่าที่ลำดับเพี้ยนอยู่แล้วแต่ไม่ได้แตะวันที่ → ยังเซฟได้
  const datesTouched = openDate !== (bill.opened || '') || washDate !== (raw.done_date || '') || finalDate !== (raw.final_date || '')
  const blockDateOrder = dateOrderError && datesTouched
  const canSubmit = !noPosition && !posMissingBags && !submitting && !openInvalid && !washInvalid && !finalInvalid && !blockDateOrder

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      const res = await updateBill({
        rack_id:        bill.rack,
        customer_id:    custMatch?.id || custInput.trim(),
        loyverse_uuid:  loyverseUuid.trim(),
        receipt_number: receiptNo.trim(),
        no_rack:        selectedPositions[0]?.slot?.toString() || '',
        no_shelf:       selectedPositions[0]?.zone || '',
        total_bags:     totalBags,
        positions:      selectedPositions.map(p => ({ zone: p.zone, slot: p.slot, bags: Number(positionBags[p.key]) || 0 })),
        open_date:      openDate.trim(),
        done_date:      washDate.trim(),
        final_date:     finalDate.trim(),
      })
      if (res && res.status === 'error') throw new Error(res.error || 'update failed')
      onSaved()
    } catch {
      setError('บันทึกการแก้ไขไม่สำเร็จ กรุณาลองใหม่')
    } finally { setSubmitting(false) }
  }

  const inp = {
    width: '100%', boxSizing: 'border-box', height: 48, padding: '0 14px',
    border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)',
    background: 'var(--surface-card)', color: 'var(--text-body)', outline: 'none',
  }
  const divider = { marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,26,24,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: 640, maxHeight: '94vh', borderRadius: 'var(--radius-xl)', background: 'var(--surface-card)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'norack-fade-up var(--dur-base) var(--ease-out)' }}>

        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--text-strong)' }}>แก้ไขรายละเอียดบิล</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>แก้ไขได้ทุกอย่างยกเว้น Rack ID · <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-brand)' }}>{bill.rack}</b></div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 'var(--radius-sm)' }}>
            <Icon name="x" size={22} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-6)' }}>

          {/* Rack ID (locked) */}
          <div style={divider}>
            <SectionLabel num="1" title="Rack ID" sub="ไม่สามารถแก้ไขได้" />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <Icon name="receipt" size={18} color="var(--text-muted)" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>{bill.rack}</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 4 }}>ล็อก</span>
            </div>
          </div>

          {/* Customer */}
          <div style={divider}>
            <SectionLabel num="2" title="Customer ID" sub="ลูกค้า / lookup ชื่อ+เบอร์อัตโนมัติ" />
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                <Icon name="user" size={18} />
              </span>
              {custSearching && <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}><Spinner size={16} /></span>}
              <input value={custInput} onChange={e => lookupCust(e.target.value)} placeholder="C-001 หรือพิมพ์ชื่อ / เบอร์โทร"
                style={{ ...inp, paddingLeft: 44, borderColor: custMatch ? 'var(--brand-400)' : 'var(--border-subtle)' }} />
            </div>
            {custMatch && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--brand-tint)', border: '1px solid var(--brand-100)', borderRadius: 'var(--radius-md)' }}>
                <Avatar name={custMatch.name} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--fs-body)' }}>{custMatch.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-body)' }}>{custMatch.id} · {custMatch.tel}</div>
                </div>
                <Icon name="check" size={20} color="var(--brand-600)" />
              </div>
            )}
          </div>

          {/* Receipt + Loyverse */}
          <div style={divider}>
            <SectionLabel num="3" title="Receipt & Loyverse UUID" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <input value={receiptNo} onChange={e => setReceiptNo(e.target.value)} placeholder="Receipt Number" style={inp} />
              <input value={loyverseUuid} onChange={e => setLoyverseUuid(e.target.value)} placeholder="Loyverse UUID"
                style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sub)' }} />
            </div>
          </div>

          {/* Positions */}
          <div style={divider}>
            <SectionLabel num="4" title="ตำแหน่ง (NO.Rack / No.Shelf / OnGround)" sub="เลือกได้หลายที่ + จำนวนถุงต่อตำแหน่ง" />
            <PositionPicker
              zone={posZone} onZone={setPosZone}
              selectedPositions={selectedPositions} onToggle={togglePosition}
              positionBags={positionBags} onBagChange={setBagForKey}
              bills={[]}
            />
            {totalBags > 0 && (
              <div style={{ marginTop: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sub)', color: 'var(--text-body)' }}>
                จำนวนถุงรวม: <b style={{ color: 'var(--text-strong)' }}>{totalBags} ถุง</b>
              </div>
            )}
            {noPosition && <div style={{ marginTop: 'var(--space-2)', color: 'var(--red-700)', fontSize: 'var(--fs-caption)' }}>ยังไม่เลือกตำแหน่ง — เลือกอย่างน้อย 1 ตำแหน่ง</div>}
            {posMissingBags && <div style={{ marginTop: 'var(--space-2)', color: 'var(--red-700)', fontSize: 'var(--fs-caption)' }}>ระบุจำนวนถุงให้ครบทุกตำแหน่ง (อย่างน้อย 1 ถุง)</div>}
          </div>

          {/* Dates — 3 ช่อง: เปิดบิล / ซักเสร็จ / รับผ้า (แก้ได้ทั้งหมด) */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <SectionLabel num="5" title="วันที่" sub="พ.ศ. DD/MM/YYYY · เปิดบิล ≤ ซักเสร็จ ≤ รับผ้า" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันเปิดบิล</div>
                <input value={openDate} onChange={e => setOpenDate(e.target.value)} placeholder="วว/ดด/ปปปป" style={{ ...inp, fontFamily: 'var(--font-mono)', borderColor: openInvalid ? 'var(--red-500)' : 'var(--border-subtle)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันซักเสร็จ</div>
                <input value={washDate} onChange={e => setWashDate(e.target.value)} placeholder="วว/ดด/ปปปป" style={{ ...inp, fontFamily: 'var(--font-mono)', borderColor: washInvalid ? 'var(--red-500)' : 'var(--border-subtle)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 6 }}>วันรับผ้า</div>
                <input value={finalDate} onChange={e => setFinalDate(e.target.value)} placeholder="วว/ดด/ปปปป" style={{ ...inp, fontFamily: 'var(--font-mono)', borderColor: finalInvalid ? 'var(--red-500)' : 'var(--border-subtle)' }} />
              </div>
            </div>
            {(openInvalid || washInvalid || finalInvalid) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-2)', color: 'var(--red-700)', fontSize: 'var(--fs-caption)' }}>
                <Icon name="x" size={14} color="var(--red-700)" /> รูปแบบวันที่ต้องเป็น วว/ดด/ปปปป (พ.ศ.)
              </div>
            )}
            {dateOrderError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-2)', color: blockDateOrder ? 'var(--red-700)' : '#b45309', fontSize: 'var(--fs-caption)' }}>
                {blockDateOrder
                  ? <><Icon name="x" size={14} color="var(--red-700)" /> ลำดับวันที่ต้องเป็น เปิดบิล ≤ ซักเสร็จ ≤ รับผ้า</>
                  : '⚠️ ลำดับวันที่เดิมไม่เรียง — แก้ช่องอื่นแล้วบันทึกได้ (ถ้าแก้วันที่ ต้องเรียงให้ถูก)'}
              </div>
            )}
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-3)', marginBottom: 'var(--space-4)', background: 'var(--red-50)', border: '1px solid var(--red-500)', borderRadius: 'var(--radius-md)', color: 'var(--red-700)', fontSize: 'var(--fs-sub)' }}>
              <Icon name="x" size={18} color="var(--red-700)" /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <NRButton block variant="outline" onClick={onClose}>ยกเลิก</NRButton>
            <NRButton block variant="primary" disabled={!canSubmit} loading={submitting}
              iconLeft={<Icon name="check" size={20} color="#fff" />} onClick={submit}>
              {submitting ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </NRButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function TabletDashboard() {
  // shared
  const [nav, setNav]       = useState('register')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef(null)
  const [bills, setBills]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]       = useState(null) // null | { prefillCustId: string }
  const [editing, setEditing]   = useState(false) // edit-bill modal สำหรับ selBill ปัจจุบัน
  const [doning, setDoning]     = useState(false) // done modal (ปิดบิล/ซักเสร็จ)
  const [receiveRackId, setReceiveRackId] = useState('')
  const [receiveCustId, setReceiveCustId] = useState('')

  // register tab
  const [regFilter, setRegFilter] = useState('all')
  const [regQ, setRegQ]           = useState('')
  const [bulkConfirm, setBulkConfirm]   = useState(false)  // modal ยืนยันลบทั้งหมด (over90)
  const [bulkBusy, setBulkBusy]         = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [selRack, setSelRack]     = useState(null)
  const [detail, setDetail]       = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null)

  // customer tab
  const [custQ, setCustQ]         = useState('')
  const [customers, setCustomers] = useState([])
  const [custSearching, setCustSearching] = useState(false)
  const [selCust, setSelCust]     = useState(null)
  const custTimerRef              = useRef(null)
  const custLoadedRef             = useRef(false)

  // search tab
  const [searchQ, setSearchQ] = useState('')

  // sync tab — new customers pending Loyverse write-back + same-phone duplicate warnings
  const [review, setReview] = useState([])
  const [syncingId, setSyncingId] = useState('')

  // global error toast
  const [toast, setToast]   = useState('')
  const toastTimer          = useRef(null)
  const notify = useCallback((msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const loadDetail = useCallback(async (rackId) => {
    if (!rackId) return
    setDetailLoading(true)
    try {
      const d = await getBillStatus(rackId) || {}
      // enrich with customer name + phone (bill data only has customer_id)
      const custId = d?.bill?.customer_id || d?.bill?.Customer_ID || d?.bill?.customer
      if (custId) {
        try {
          const res  = await customerLookup(custId)
          const list = (res.customers ?? res ?? []).map(mapCustomer)
          const match = list.find(c => c.id === custId) || list[0]
          if (match) d.customer = match
        } catch { /* keep bill without enrichment */ }
      }
      setDetail(d)
    }
    catch { setDetail(null); notify('โหลดรายละเอียดบิลไม่สำเร็จ') }
    finally { setDetailLoading(false) }
  }, [notify])

  const loadBills = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true)
    try {
      const data = await getOpenBills()
      const list = (data.bills ?? data ?? []).map(mapBill)
      setBills(list)
      if (list.length) {
        setSelRack(prev => {
          const keep = prev && list.some(b => b.rack === prev)
          if (!keep) loadDetail(list[0].rack)
          return keep ? prev : list[0].rack
        })
      }
    } catch { notify('โหลดรายการบิลไม่สำเร็จ') }
    finally { if (spinner) setLoading(false) }
  }, [loadDetail, notify])

  // initial data fetch on mount; setLoading inside async loadBills is intentional
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadBills() }, [loadBills])

  // Real-time sync via POLLING (SSE removed — see docs/phase6-frontend-cutover.md). Refresh the bill list
  // every 5s while the tab is visible so POS-receipt status changes appear; skipping hidden tabs keeps us
  // well under the Cloudflare Workers free-tier daily request budget.
  // "ลูกค้าใหม่" review feed (new customers pending Loyverse write-back + same-phone duplicates).
  const loadReview = useCallback(async () => {
    try { setReview(await getReview()) } catch { /* keep previous list on a transient error */ }
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadReview() }, [loadReview])

  const handleSync = useCallback(async (customerId) => {
    setSyncingId(customerId)
    try {
      await syncCustomer(customerId)
      notify('บันทึก Customer ID เข้า Loyverse สำเร็จ')
      await loadReview()
    } catch (e) {
      notify(e?.message === 'unauthorized' ? 'เซสชันหมดอายุ' : (e?.message || 'sync ไม่สำเร็จ'))
    } finally { setSyncingId('') }
  }, [loadReview, notify])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') { loadBills(false); loadReview() }
    }, 5000)
    return () => clearInterval(timer)
  }, [loadBills, loadReview])

  // load customers (call with '' to load all, or q to filter)
  const loadCustomers = useCallback(async (q = '') => {
    if (custTimerRef.current) clearTimeout(custTimerRef.current)
    const delay = q.trim() ? 350 : 0
    custTimerRef.current = setTimeout(async () => {
      setCustSearching(true)
      try {
        const data = await customerLookup(q)
        const list = (data.customers ?? data ?? []).map(mapCustomer)
        setCustomers(list)
        if (list.length && !selCust) setSelCust(list[0].id)
      } catch { setCustomers([]); notify('โหลดรายชื่อลูกค้าไม่สำเร็จ') }
      finally { setCustSearching(false) }
    }, delay)
  }, [selCust, notify])

  // auto-load customers when switching to customer tab
  const handleNav = (key) => {
    if (key === 'register' && nav === 'receive' && receiveRackId) {
      loadDetail(receiveRackId)
    }
    setNav(key)
    if (key === 'customers' && !custLoadedRef.current) {
      custLoadedRef.current = true
      loadCustomers('')
    }
  }

  // กรองในเครื่องทันที — แค่เก็บคำค้น ไม่ยิง backend (ดู custShown). โหลดลิสต์เต็มทำตอนเข้าแท็บ/กดรีเฟรช
  const handleCustSearch = (q) => setCustQ(q)

  const selectBill = (rackId) => {
    setSelRack(rackId)
    loadDetail(rackId)
  }

  const doAction = async (rackId, newStatus) => {
    setActionLoading(true)
    // B3: ปิดบิล (ซักเสร็จ) ต้องไม่ทำให้บิลหายจากรายการ — ตาม lifecycle เฉพาะ "รับแล้ว"
    // เท่านั้นที่หลุดจาก active list. อัปเดตสถานะใน state แบบ optimistic แทนการ re-fetch
    // ที่ทับ bills ทั้ง array ด้วยลิสต์จาก server (ซึ่ง backend อาจ filter บิลที่ปิดออกไปแล้ว).
    const newKey = toStatusKey(newStatus)
    setBills(prev => prev.map(b => b.rack === rackId ? { ...b, status: newKey } : b))
    setDetail(prev => (prev && prev.bill)
      ? { ...prev, bill: { ...prev.bill, status: newStatus } }
      : prev)
    setRegFilter(newKey)
    setRegQ('')
    try {
      const res = await updateStatus(rackId, newStatus)
      // UPD-3: backend ตอบ { status:'error' } (HTTP 200) เมื่อหา rack ไม่เจอ — ถือว่าล้มเหลว
      if (res && res.status === 'error') throw new Error(res.error || 'update failed')
      await loadDetail(rackId)
    } catch {
      notify('อัปเดตสถานะไม่สำเร็จ กรุณาลองใหม่')
      await loadBills(false) // rollback ให้ตรงกับ server เมื่อ call ล้มเหลว
    } finally { setActionLoading(false) }
  }

  const openModal = (prefillCustId = '') => setModal({ prefillCustId })

  const handleEditSaved = () => {
    setEditing(false)
    loadBills(false)
    if (selRack) loadDetail(selRack)
  }

  const handleDoneSaved = () => {
    // status ถูก flip เป็น 'เสร็จสิ้น' ใน DoneModal แล้ว — ที่นี่แค่ optimistic + refresh ครั้งเดียว
    setDoning(false)
    if (selRack) setBills(prev => prev.map(b => b.rack === selRack ? { ...b, status: 'done' } : b))
    setRegFilter('done')
    setRegQ('')
    loadBills(false)
    if (selRack) loadDetail(selRack)
  }

  const doDelete = async (rackId) => {
    setActionLoading(true)
    try {
      const res = await deleteBill(rackId)
      if (res && res.status === 'error') throw new Error(res.error || 'delete failed')
      setEditing(false)
      setDeleteTarget(null)
      setBills(prev => prev.filter(b => b.rack !== rackId))
      setSelRack(null)
      setDetail(null)
      notify('ลบบิลแล้ว')
    } catch {
      notify('ลบบิลไม่สำเร็จ กรุณาลองใหม่')
    } finally { setActionLoading(false) }
  }

  // ลบบิลที่กรองได้ทั้งหมด (over90) ทีละใบแบบ sequential — reuse Delete Bill เดิม (อ่าน row สด ลบผิดแถวไม่ได้)
  const bulkDeleteOver90 = async () => {
    const targets = filteredBills.map(b => b.rack)
    setBulkConfirm(false)
    setBulkBusy(true)
    setBulkProgress({ done: 0, total: targets.length })
    let ok = 0
    const failed = []
    for (const rack of targets) {
      try {
        const res = await deleteBill(rack)
        if (res && res.status === 'error') throw new Error(res.error || 'delete failed')
        setBills(prev => prev.filter(b => b.rack !== rack))
        if (selRack === rack) { setSelRack(null); setDetail(null) }
        ok++
      } catch {
        failed.push(rack)
      }
      setBulkProgress({ done: ok + failed.length, total: targets.length })
    }
    setBulkBusy(false)
    notify(failed.length
      ? `ลบสำเร็จ ${ok}/${targets.length} — ไม่สำเร็จ ${failed.length} รายการ`
      : `ลบ ${ok} รายการสำเร็จ`)
  }

  const handleBillCreated = (newBill) => {
    setModal(null)
    setNav('register')
    loadBills(false)
    if (newBill?.rack_id) {
      setSelRack(newBill.rack_id)
      loadDetail(newBill.rack_id)
    }
  }

  const RAIL = [
    { key: 'customers', icon: 'user',    label: 'ลูกค้า',  sheet: 'customers.info' },
    { key: 'register',  icon: 'receipt', label: 'ทะเบียน', sheet: 'Master register' },
    { key: 'receive',   icon: 'camera',  label: 'รับผ้า',  sheet: 'Work_Recieve' },
    { key: 'status',    icon: 'search',  label: 'ค้นหา',   sheet: 'ค้นหา' },
    { key: 'sync',      icon: 'refresh', label: 'ลูกค้าใหม่', sheet: 'ลูกค้าใหม่ / รอ sync เข้า Loyverse' },
  ]

  // React Compiler memoize ให้อัตโนมัติ — ไม่ต้อง useMemo เอง
  const filteredBills = bills.filter(b => {
    if (regFilter === 'over90') {
      if (b.status !== 'received') return false
      const days = daysSinceFinal(b.final_date)
      if (days === null || days <= 90) return false
    } else if (regFilter !== 'all' && b.status !== regFilter) {
      return false
    }
    const q = regQ.trim().toLowerCase()
    if (!q) return true
    const tokens = q.split(/\s+/).filter(Boolean)
    const statusLabel = b.status === 'open' ? 'รอดำเนินการ รอ' : b.status === 'done' ? 'ซักเสร็จ เสร็จ' : 'รับผ้าแล้ว รับ'
    const fields = [b.rack, b.name, b.customer, b.opened, b.done_date, b.final_date, statusLabel]
      .map(s => (s || '').toLowerCase()).filter(Boolean)
    return tokens.every(token => fields.some(f => f.includes(token)))
  })
  // แท็บลูกค้า: กรองลิสต์เต็มในเครื่อง (ไม่ยิง backend ต่อตัวอักษร) — logic เดียวกับ customer-lookup: id/ชื่อ/เบอร์ includes
  // useDeferredValue: ช่องพิมพ์อัปเดตทันที (custQ) แต่การกรอง+เรนเดอร์ลิสต์ทำแบบ deferred → พิมพ์/ลบเร็วๆ ไม่กระตุก
  const deferredCustQ = useDeferredValue(custQ)
  const custShown = useMemo(() => {
    const ql = deferredCustQ.trim().toLowerCase()
    if (!ql) return customers
    return customers.filter(c =>
      (c.id || '').toLowerCase().includes(ql) ||
      (c.name || '').toLowerCase().includes(ql) ||
      (c.tel || '').toLowerCase().includes(ql))
  }, [customers, deferredCustQ])
  // จำนวนบิลต่อลูกค้า — คิดครั้งเดียวต่อการเปลี่ยน bills (กัน O(ลูกค้า×บิล) ต่อทุกการพิมพ์)
  const billCountByCustomer = useMemo(() => {
    const m = new Map()
    for (const b of bills) m.set(b.customer, (m.get(b.customer) || 0) + 1)
    return m
  }, [bills])
  const selBill = bills.find(b => b.rack === selRack) || null
  const me = currentUser()

  // สำรองข้อมูล: ดึง snapshot ทั้ง DB (decrypt หลัง auth) → สร้าง .xlsx text-typed (ไม่เพี้ยน) → save dialog
  // (เลือกที่เก็บในเครื่อง หรือโฟลเดอร์ที่ sync กับ Google Drive). ดู src/lib/exportXlsx.js + backend /api/export/backup.
  async function handleExport() {
    if (exporting) return
    try {
      setExporting(true)
      const payload = await exportBackup()
      const { filename } = await saveBackupXlsx(payload)
      const m = payload?.meta || {}
      alert(`สำรองข้อมูลแล้ว: ${filename}\nลูกค้า ${m.customers} · บิล ${m.bills} · ตำแหน่ง ${m.bill_positions}`)
    } catch (e) {
      if (e?.name !== 'AbortError') alert('สำรองข้อมูลไม่สำเร็จ: ' + (e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  // กู้ข้อมูลจากไฟล์ backup (.xlsx) — โหมด "insert-missing" ปลอดภัย: เพิ่มเฉพาะแถวที่หาย ไม่ทับ/ไม่ revert ของเดิม.
  // อ่านไฟล์ → ขอ preview (ยังไม่เขียน) → ให้ยืนยันจำนวน → ค่อยเขียนจริง. ดู src/lib/importXlsx.js + backend /api/import.
  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset ให้เลือกไฟล์เดิมซ้ำได้
    if (!file) return
    try {
      setImporting(true)
      const sheets = await parseBackupXlsx(file)
      const p = (await importPreview(sheets)).preview || {}
      const cNew = p.customers?.new ?? 0, bNew = p.bills?.new ?? 0, posNew = p.bill_positions?.new ?? 0
      if (cNew === 0 && bNew === 0) { alert('ไม่มีข้อมูลใหม่ที่ต้องเพิ่ม — ทุกอย่างในไฟล์มีอยู่ในระบบแล้ว'); return }
      const msg = 'กู้ข้อมูล (โหมดปลอดภัย: เพิ่มเฉพาะที่หาย ไม่ทับของเดิม)\n\n'
        + `• ลูกค้าใหม่ที่จะเพิ่ม: ${cNew}  (ข้ามที่มีอยู่แล้ว ${p.customers?.existing ?? 0})\n`
        + `• บิลใหม่ที่จะเพิ่ม: ${bNew}  (ข้ามที่มีอยู่แล้ว ${p.bills?.existing ?? 0})\n`
        + `• ตำแหน่งราวใหม่: ${posNew}\n`
        + (p.bills?.orphan ? `\n⚠️ บิล ${p.bills.orphan} ใบไม่พบลูกค้าในระบบ → จะเพิ่มแบบไม่มีเจ้าของ\n` : '')
        + '\nยืนยันเพิ่มข้อมูลเหล่านี้?'
      if (!window.confirm(msg)) return
      const r = (await importApply(sheets)).inserted || {}
      alert(`กู้ข้อมูลสำเร็จ ✓\nเพิ่มลูกค้า ${r.customers?.new ?? 0} · บิล ${r.bills?.new ?? 0} · ตำแหน่ง ${r.bill_positions?.new ?? 0}`)
      loadBills(true); if (nav === 'customers') loadCustomers('')
    } catch (err) {
      alert('กู้ข้อมูลไม่สำเร็จ: ' + (err?.message || err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--surface-app)', fontFamily: 'var(--font-sans)', overflow: 'hidden' }}>

      {/* top bar */}
      <header style={{ height: 64, flexShrink: 0, background: 'var(--surface-inverse)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '0 var(--space-5)' }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          No<span style={{ color: 'var(--brand-200)' }}>.</span>Rack
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{RAIL.find(r => r.key === nav)?.sheet || ''}</div>
        {nav === 'register' && (
          <NRButton size="sm" variant="primary" iconLeft={<Icon name="plus" size={16} color="#fff" />} onClick={() => openModal('')}>
            เปิดบิลใหม่
          </NRButton>
        )}
        <div style={{ flex: 1 }} />
        {nav === 'register' && (
          <div style={{ position: 'relative', width: 280 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }}>
              <Icon name="search" size={16} />
            </span>
            {regQ && (
              <button onClick={() => setRegQ('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', display: 'flex', padding: 2 }}>
                <Icon name="x" size={14} />
              </button>
            )}
            <input value={regQ} onChange={e => setRegQ(e.target.value)} placeholder="ค้นหา รหัสบิล / ชื่อลูกค้า"
              style={{ width: '100%', height: 38, boxSizing: 'border-box', paddingLeft: 32, paddingRight: regQ ? 28 : 12,
                border: '1.5px solid rgba(255,255,255,0.25)', borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-sans)', fontSize: 13,
                background: 'rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }} />
          </div>
        )}
        {nav === 'customers' && (
          <div style={{ position: 'relative', width: 280 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }}>
              <Icon name="search" size={16} />
            </span>
            {custQ && (
              <button onClick={() => handleCustSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', display: 'flex', padding: 2 }}>
                <Icon name="x" size={14} />
              </button>
            )}
            <input value={custQ} onChange={e => handleCustSearch(e.target.value)} placeholder="ค้นหา ชื่อ / รหัส / เบอร์"
              style={{ width: '100%', height: 38, boxSizing: 'border-box', paddingLeft: 32, paddingRight: custQ ? 28 : 12,
                border: '1.5px solid rgba(255,255,255,0.25)', borderRadius: 'var(--radius-md)',
                fontFamily: 'var(--font-sans)', fontSize: 13,
                background: 'rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }} />
          </div>
        )}
        <BackendSwitch />
        <Clock />
        <button onClick={() => { loadBills(true); if (nav === 'customers') loadCustomers(''); if (nav === 'sync') loadReview() }} title="รีเฟรช" style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-md)', padding: 8, display: 'flex', cursor: 'pointer' }}>
          <Icon name="refresh" size={20} color="#fff" />
        </button>
        <button onClick={handleExport} disabled={exporting} title="สำรองข้อมูล (Export .xlsx)" style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-md)', padding: 8, display: 'flex', cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.6 : 1 }}>
          <Icon name="download" size={20} color="#fff" />
        </button>
        <input ref={importInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleImportFile} />
        <button onClick={() => importInputRef.current?.click()} disabled={importing} title="กู้ข้อมูลจากไฟล์ backup (.xlsx) — เพิ่มเฉพาะที่หาย" style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-md)', padding: 8, display: 'flex', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}>
          <Icon name="upload" size={20} color="#fff" />
        </button>
        {me && (
          <span title={me.username || ''} style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.display_name || me.username || ''}
          </span>
        )}
        <button onClick={() => { if (window.confirm('ออกจากระบบ?')) signOut() }} title="ออกจากระบบ" style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-md)', padding: 8, display: 'flex', cursor: 'pointer' }}>
          <Icon name="logout" size={20} color="#fff" />
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* nav rail */}
        <nav style={{ width: 92, flexShrink: 0, background: 'var(--surface-card)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-4) 0' }}>
          {RAIL.map(it => {
            const on = it.key === nav
            return (
              <button key={it.key} onClick={() => handleNav(it.key)} style={{
                position: 'relative',
                width: 64, height: 60, border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-lg)',
                background: on ? 'var(--brand-tint)' : 'transparent',
                color: on ? 'var(--text-brand)' : 'var(--text-muted)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: on ? 600 : 400,
                transition: 'background var(--dur-fast)',
              }}>
                <Icon name={it.icon} size={24} />
                {it.label}
                {it.key === 'sync' && review.length > 0 && (
                  <span style={{
                    position: 'absolute', top: 6, right: 10, minWidth: 18, height: 18, padding: '0 5px',
                    borderRadius: 9, background: 'var(--danger, #e5484d)', color: '#fff',
                    fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center',
                  }}>{review.length}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* content */}
        {nav === 'register' && (
          <RegisterView
            bills={filteredBills}
            loading={loading}
            filter={regFilter}
            onFilter={setRegFilter}
            onBulkDelete={() => setBulkConfirm(true)}
            selRack={selRack}
            selBill={selBill}
            onSelect={selectBill}
            detail={detail}
            detailLoading={detailLoading}
            actionLoading={actionLoading}
            onAction={doAction}
            onDone={() => setDoning(true)}
            onAddPhoto={(rackId, custId) => { setReceiveRackId(rackId); setReceiveCustId(custId || ''); setNav('receive') }}
            onEdit={() => setEditing(true)}
            onDelete={(rackId) => setDeleteTarget(rackId)}
          />
        )}
        {nav === 'customers' && (
          <CustomerView
            bills={bills}
            billCount={billCountByCustomer}
            q={deferredCustQ}
            customers={custShown}
            searching={custSearching}
            selCust={selCust}
            onSelect={setSelCust}
            onOpenBill={(custId) => openModal(custId)}
            onViewBill={(rackId) => { selectBill(rackId); setNav('register') }}
          />
        )}
        {nav === 'receive' && <ReceiveView key={receiveRackId} prefillRackId={receiveRackId} prefillCustId={receiveCustId} />}
        {nav === 'status' && (
          <SearchView
            bills={bills}
            q={searchQ}
            onQ={setSearchQ}
            onViewBill={(rackId) => { selectBill(rackId); setNav('register') }}
          />
        )}
        {nav === 'sync' && (
          <ReviewView customers={review} syncingId={syncingId} onSync={handleSync} />
        )}
      </div>

      {/* modal overlay */}
      {modal && (
        <OpenBillModal
          prefillCustId={modal.prefillCustId}
          onClose={() => setModal(null)}
          onCreate={handleBillCreated}
        />
      )}

      {doning && selBill && (
        <DoneModal
          bill={selBill}
          detail={detail}
          onClose={() => setDoning(false)}
          onSaved={handleDoneSaved}
        />
      )}

      {editing && selBill && (
        <EditBillModal
          bill={selBill}
          detail={detail}
          onClose={() => setEditing(false)}
          onSaved={handleEditSaved}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          rackId={deleteTarget}
          loading={actionLoading}
          onConfirm={() => doDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {(bulkConfirm || bulkBusy) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 350, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
          <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', width: 'min(440px, 92vw)', boxShadow: 'var(--shadow-lg)' }}>
            {bulkBusy ? (
              <>
                <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 'var(--space-3)' }}>กำลังลบบิล...</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text-brand)' }}>{bulkProgress.done} / {bulkProgress.total}</div>
                <div style={{ marginTop: 'var(--space-3)', height: 8, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total * 100) : 0}%`, background: 'var(--brand-500)', transition: 'width var(--dur-base)' }} />
                </div>
                <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-sub)', color: 'var(--text-muted)' }}>อย่าปิดหน้านี้จนกว่าจะเสร็จ</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>ลบบิลเกิน 90 วันทั้งหมด?</div>
                <div style={{ fontSize: 'var(--fs-sub)', color: 'var(--text-body)', lineHeight: 1.5, marginBottom: 'var(--space-2)' }}>
                  จะลบ <b style={{ color: 'var(--danger)' }}>{filteredBills.length} รายการ</b> ออกจากระบบถาวร (ทั้ง Google Sheet และในเว็บ) — ลบแล้วกู้ไม่ได้
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 'var(--space-5)' }}>⚠️ แนะนำ backup ชีต (Make a copy) ก่อนลบ</div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <button onClick={() => setBulkConfirm(false)} style={{ flex: 1, height: 46, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
                  <button onClick={bulkDeleteOver90} style={{ flex: 1, height: 46, border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--danger)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', fontWeight: 700, cursor: 'pointer' }}>ลบทั้งหมด</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 300,
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', maxWidth: '90vw',
          background: 'var(--red-700)', color: '#fff', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', fontWeight: 600,
          animation: 'norack-fade-up var(--dur-base) var(--ease-out)',
        }}
        onClick={() => setToast('')}>
          <Icon name="x" size={16} color="#fff" /> {toast}
        </div>
      )}
    </div>
  )
}

// ─── register view ────────────────────────────────────────────────────────────

// memo'd row — เลือกบิลแล้ว re-render เฉพาะแถวที่ selected เปลี่ยน ไม่ลามทั้งลิสต์
const BillRow = memo(function BillRow({ b, selected, onSelect }) {
  return (
    <div onClick={() => onSelect(b.rack)} style={{
      display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3)',
      cursor: 'pointer', borderRadius: 'var(--radius-lg)', marginBottom: 6,
      background: selected ? 'var(--brand-tint)' : 'transparent',
      boxShadow: selected ? 'inset 0 0 0 1.5px var(--border-brand)' : 'none',
      transition: 'background var(--dur-fast)',
    }}>
      <Avatar name={b.name && b.name !== '—' ? b.name : b.customer} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-strong)', fontSize: 18 }}>{b.rack}</div>
        <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.customer}{b.name && b.name !== b.customer && b.name !== '—' ? ` · ${b.name}` : ''}
        </div>
        {b.status === 'open' && b.opened && (
          <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-strong)', marginTop: 2 }}>
            รอดำเนินการ {b.opened}
          </div>
        )}
        {b.status === 'done' && (
          <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-strong)', marginTop: 2 }}>
            ซักเสร็จ {b.done_date || b.opened || ''}
          </div>
        )}
        {b.status === 'received' && b.final_date && (
          <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-strong)', marginTop: 2 }}>
            รับผ้าแล้ว {b.final_date}
          </div>
        )}
      </div>
      <StatusBadge status={b.status} size="sm" />
    </div>
  )
})

// "ลูกค้าใหม่" tab — new customers (pending/failed Loyverse write-back) with a ⚠️ same-phone duplicate hint.
// One [Sync] button per row so staff review each duplicate warning before writing customer_code to Loyverse.
function ReviewView({ customers, syncingId, onSync }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-strong)' }}>ลูกค้าใหม่ / รอ sync เข้า Loyverse</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          กด <b>Sync</b> เพื่อบันทึก Customer ID กลับเข้า Loyverse · <span style={{ color: 'var(--danger, #e5484d)' }}>⚠️</span> = เบอร์ซ้ำกับลูกค้าเดิม (ตรวจก่อน sync)
        </div>
      </div>
      {customers.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 15 }}>ไม่มีลูกค้าใหม่รอ sync</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 720 }}>
          {customers.map(c => {
            const dup = c.duplicates && c.duplicates.length > 0
            return (
              <div key={c.customer_id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
                border: `1px solid ${dup ? 'var(--danger, #e5484d)' : 'var(--border-subtle)'}`, background: 'var(--surface-card)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{c.name || '—'}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>
                    {c.phone || '—'} · <span style={{ fontSize: 11 }}>{c.customer_id}</span>
                  </div>
                  {dup && (
                    <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--danger, #e5484d)', fontWeight: 500 }}>
                      ⚠️ เบอร์ซ้ำกับ: {c.duplicates.map(d => `${d.name || '—'} (${String(d.customer_id).slice(-6)})`).join(', ')}
                    </div>
                  )}
                  {c.sync_status === 'failed' && c.sync_error && (
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--danger, #e5484d)' }}>sync ล้มเหลว: {c.sync_error}</div>
                  )}
                </div>
                <NRButton size="sm" variant={dup ? 'outline' : 'primary'} loading={syncingId === c.customer_id}
                  iconLeft={<Icon name="refresh" size={16} />} onClick={() => onSync(c.customer_id)}>
                  Sync
                </NRButton>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RegisterView({ bills, loading, filter, onFilter, onBulkDelete, selRack, selBill, onSelect, detail, detailLoading, actionLoading, onAction, onDone, onAddPhoto, onEdit, onDelete }) {
  const FILTERS = [
    { key: 'all',      label: 'ทั้งหมด' },
    { key: 'open',     label: 'รอ' },
    { key: 'done',     label: 'เสร็จ' },
    { key: 'received', label: 'รับแล้ว' },
    { key: 'over90',   label: 'เกิน 90 วัน' },
  ]

  return (
    <>
      <section style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-card)' }}>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', padding: 3 }}>
            {FILTERS.map(f => {
              const on = f.key === filter
              return (
                <button key={f.key} onClick={() => onFilter(f.key)} style={{
                  flex: 1, height: 34, border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: on ? 'var(--surface-card)' : 'transparent',
                  color: on ? 'var(--text-strong)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: on ? 600 : 400,
                  boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'all var(--dur-fast)',
                }}>{f.label}</button>
              )
            })}
          </div>
        </div>

        {filter === 'over90' && bills.length > 0 && (
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
            <button onClick={onBulkDelete} style={{
              width: '100%', height: 48, border: 'none', borderRadius: 'var(--radius-md)',
              background: 'var(--danger)', color: '#fff', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <Icon name="x" size={18} color="#fff" /> ลบบิลเกิน 90 วันทั้งหมด ({bills.length})
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12)' }}>
              <Spinner />
            </div>
          ) : bills.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>ไม่พบบิล</div>
          ) : bills.map(b => (
            <BillRow key={b.rack} b={b} selected={b.rack === selRack} onSelect={onSelect} />
          ))}
        </div>
      </section>

      <section style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-subtle)', overflowY: 'auto', padding: 'var(--space-5)', background: 'var(--surface-app)' }}>
        {detailLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-12)' }}>
            <Spinner size={32} />
          </div>
        ) : detail?.bill && selBill ? (
          <BillDetailPanel bill={selBill} detailData={detail} actionLoading={actionLoading} onAction={onAction} onDone={onDone} onAddPhoto={() => onAddPhoto(selBill.rack, selBill.customer)} onEdit={onEdit} onDelete={onDelete} />
        ) : !loading && bills.length === 0 ? (
          <EmptyState icon="receipt" text="ยังไม่มีบิล" sub="กดปุ่มเปิดบิลใหม่เพื่อเริ่มต้น" />
        ) : (
          <EmptyState icon="receipt" text="เลือกบิลจากรายการ" />
        )}
      </section>
    </>
  )
}

// ─── bill detail panel ────────────────────────────────────────────────────────

function BillDetailPanel({ bill, detailData, actionLoading, onAction, onDone, onAddPhoto, onEdit, onDelete }) {
  const raw    = detailData.bill || {}
  const cust   = detailData.customer || null
  const photos = (detailData.photos || []).filter(p => p.photo_url)
  const status = toStatusKey(raw.status || bill.status)

  // prefer resolved customer name/phone; fall back to bill data
  const custName = (cust?.name && cust.name !== '—') ? cust.name
    : (bill.name && bill.name !== bill.customer) ? bill.name : bill.customer || '—'
  const phone = (cust?.tel && cust.tel !== '—') ? cust.tel
    : raw.phone_number || raw.Phone_Number || raw.phone || raw.tel || '—'

  const facts = [
    ['รหัสลูกค้า', bill.customer || '—'],
    ['จำนวนถุง',   `${bill.bags} ถุง`],
    ['เปิดบิล',    bill.opened  || '—'],
    ['ซักเสร็จ',   status === 'done' || status === 'received' ? (raw.done_date || '—') : '—'],
    ['รับแล้ว',    status === 'received' ? (raw.final_date || raw.received_date || '—') : '—'],
    ['Receipt',    raw.receipt_number || raw.Receipt_Number || '—'],
  ]

  return (
    <div style={{ animation: 'norack-fade-up var(--dur-base) var(--ease-out)' }}>

      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1, marginBottom: 'var(--space-3)' }}>
            {bill.rack}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Avatar name={custName} size={48} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.3 }}>{custName}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--text-body)', marginTop: 3 }}>{phone}</div>
            </div>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* ── info card ── */}
      <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: 'var(--space-5)', marginBottom: 'var(--space-4)', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
          {facts.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 17, color: 'var(--text-muted)', marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-strong)' }}>{v}</div>
            </div>
          ))}
        </div>

      </div>

      {/* ── photos ── */}
      {photos.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-heading)', fontWeight: 600, color: 'var(--text-strong)' }}>รูปผ้าในบิล</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>{photos.length} รูป</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            {photos.map((p, i) => (
              <PhotoThumb key={i} src={p.photo_url} seq={p.seq ?? i + 1}
                size="100%" style={{ width: '100%', height: 160 }} radius="var(--radius-lg)" />
            ))}
          </div>
        </>
      )}

      {/* ── actions ── */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {status === 'open' && (
          <NRButton size="lg" loading={actionLoading}
            iconLeft={<Icon name="check" size={20} color="#fff" />}
            onClick={onDone}>
            ปิดบิล (ซักเสร็จ)
          </NRButton>
        )}
        {status === 'done' && (
          <NRButton size="lg" loading={actionLoading}
            iconLeft={<Icon name="package" size={20} color="#fff" />}
            onClick={() => onAction(bill.rack, 'รับแล้ว')}>
            ลูกค้ารับผ้า
          </NRButton>
        )}
        {/* ย้อนสถานะ — แก้กรณีเผลอกดผิด (outline สีรอง กันสับสนกับปุ่มเดินหน้า) */}
        {status === 'done' && (
          <NRButton variant="outline" size="lg" loading={actionLoading}
            onClick={() => onAction(bill.rack, 'รอดำเนินการ')}>
            ↩ ย้อนเป็นรอดำเนินการ
          </NRButton>
        )}
        {status === 'received' && (
          <NRButton variant="outline" size="lg" loading={actionLoading}
            onClick={() => onAction(bill.rack, 'เสร็จสิ้น')}>
            ↩ ย้อนเป็นซักเสร็จ
          </NRButton>
        )}
        <NRButton variant="outline" size="lg" iconLeft={<Icon name="receipt" size={20} />} onClick={onEdit}>
          แก้ไขรายละเอียด
        </NRButton>
        <NRButton variant="outline" size="lg"
          iconLeft={<Icon name="camera" size={20} color={photos.length === 0 ? '#f97316' : undefined} />}
          onClick={onAddPhoto}
          style={photos.length === 0 ? { color: '#f97316', borderColor: '#f97316', fontWeight: 700 } : {}}>
          {photos.length === 0 ? 'ยังไม่มีรูป — เพิ่มรูปผ้า' : `เพิ่มรูปผ้า · ${photos.length} รูป`}
        </NRButton>
        <NRButton variant="outline" size="lg" loading={actionLoading}
          iconLeft={<Icon name="x" size={20} color="var(--red-700)" />}
          onClick={() => onDelete(bill.rack)}
          style={{ color: 'var(--red-700)', borderColor: 'var(--red-300)' }}>
          ลบบิล
        </NRButton>
      </div>
    </div>
  )
}

// ─── customer view ────────────────────────────────────────────────────────────

const CustomerView = memo(function CustomerView({ bills, billCount, q, customers, searching, selCust, onSelect, onOpenBill, onViewBill }) {
  const cur = customers.find(c => c.id === selCust) || customers[0] || null
  const custBills = cur ? bills.filter(b => b.customer === cur.id) : []

  // virtualization: ลิสต์ลูกค้ายาวหลายร้อยแถว → เรนเดอร์เฉพาะแถวที่อยู่ในจอ (กันกระตุก)
  const ROW_H = 72
  const scrollRef = useRef(null)
  const [vp, setVp] = useState({ top: 0, h: 0 })
  useEffect(() => { const el = scrollRef.current; if (el) setVp(v => ({ ...v, h: el.clientHeight })) }, [])
  useEffect(() => { const el = scrollRef.current; if (el) { el.scrollTop = 0; setVp(v => ({ ...v, top: 0 })) } }, [q])
  const total = customers.length
  const start = Math.max(0, Math.floor(vp.top / ROW_H) - 6)
  const end = Math.min(total, Math.ceil((vp.top + (vp.h || 600)) / ROW_H) + 6)

  return (
    <>
      <section style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-card)' }}>
        <div ref={scrollRef}
          onScroll={e => setVp({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}
          style={{ flex: 1, overflowY: 'auto' }}>
          {searching ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
              <Spinner />
            </div>
          ) : total === 0 && q.trim() ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>ไม่พบลูกค้า</div>
          ) : (
            <div style={{ height: total * ROW_H, position: 'relative' }}>
              {customers.slice(start, end).map((c, i) => {
                const idx = start + i
                const on = cur && c.id === cur.id
                return (
                  <div key={c.id} onClick={() => onSelect(c.id)}
                    style={{ position: 'absolute', top: idx * ROW_H, left: 0, right: 0, height: ROW_H, boxSizing: 'border-box', padding: '4px var(--space-4)' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: '100%', padding: '0 var(--space-4)',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      background: on ? 'var(--brand-tint)' : 'transparent',
                      boxShadow: on ? 'inset 0 0 0 1.5px var(--brand-300)' : 'none',
                    }}>
                      <Avatar name={c.name} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--text-muted)' }}>{c.id} · {c.tel}</div>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-faint)', flexShrink: 0 }}>
                        {billCount.get(c.id) || 0} บิล
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-subtle)', overflowY: 'auto', padding: 'var(--space-6)', background: 'var(--surface-app)' }}>
        {cur ? (
          <div style={{ animation: 'norack-fade-up var(--dur-base) var(--ease-out)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Avatar name={cur.name} size={48} />
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.2 }}>{cur.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--text-body)', marginTop: 4 }}>{cur.id} · {cur.tel}</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--brand-tint)', border: '1px solid var(--brand-100)', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-4)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-strong)' }}>เปิดบิลสำหรับลูกค้านี้</div>
                <div style={{ fontSize: 14, color: 'var(--text-body)', marginTop: 2 }}>รหัส {cur.id} จะถูกใส่ให้อัตโนมัติ</div>
              </div>
              <NRButton variant="primary" iconLeft={<Icon name="plus" size={18} color="#fff" />} onClick={() => onOpenBill(cur.id)}>
                เปิดบิลใหม่
              </NRButton>
            </div>

            <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: 'var(--space-5)', marginBottom: 'var(--space-4)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                {[
                  ['รหัสลูกค้า', cur.id],
                  ['เบอร์โทร',   cur.tel],
                  ['Create Date', cur.created],
                  ['Up Date', cur.updated],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 17, color: 'var(--text-muted)', marginBottom: 3 }}>{l}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--text-strong)' }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)' }}>บิลในระบบ</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-muted)' }}>{custBills.length} บิล</span>
            </div>
            {custBills.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {custBills.map(b => (
                  <div key={b.rack} onClick={() => onViewBill(b.rack)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', background: 'var(--surface-card)', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: 'var(--text-strong)' }}>{b.rack}</div>
                      <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 2 }}>{b.bags} ถุง{b.status !== 'received' && b.shelf !== '—' ? ` · ชั้น ${b.shelf}` : ''} · {b.opened}</div>
                    </div>
                    <StatusBadge status={b.status} size="sm" />
                    <Icon name="chevron" size={16} color="var(--text-faint)" />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 16 }}>ยังไม่มีบิลในระบบ</div>
            )}
          </div>
        ) : (
          <EmptyState icon="user" text="เลือกลูกค้าจากรายการ" />
        )}
      </section>
    </>
  )
})

// ─── receive view ─────────────────────────────────────────────────────────────

const CLOTH_CATS = ['ชุดทั่วไป', 'ชุดทำงาน', 'ชุดไหม', 'ผ้านวม', 'รีดอัดกลีบ']
const MINIO_BASE = 'https://photos.winterarmy.net/norack/'

function genTempId() {
  return 'TMP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase()
}

function PhotoSlot({ index, photo, tempId, onCapture, onRemove }) {
  const cameraRef = useRef(null)   // input ที่บังคับเปิดกล้อง (capture)
  const fileRef   = useRef(null)   // input เลือกไฟล์จากเครื่อง (ไม่มี capture)
  const filename = 'receive_' + tempId.replace(/[^A-Z0-9]/g, '_') + '_' + String(index + 1).padStart(2, '0') + '.jpg'
  const onPick = e => { const f = e.target.files[0]; if (f) onCapture(index, URL.createObjectURL(f)) }

  const chipBtn = {
    display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px',
    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-card)', color: 'var(--text-brand)',
    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', fontWeight: 600, cursor: 'pointer',
  }
  const halfBtn = {
    flex: 1, padding: '10px', border: 'none', background: 'var(--surface-card)',
    color: 'var(--text-brand)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)',
    fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface-card)' }}>
      <div style={{ height: 160, background: photo ? 'transparent' : 'var(--surface-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {photo
          ? <img src={photo} alt={`รูป ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--text-faint)', padding: 8 }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)' }}>เลือกวิธีเพิ่มรูป</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => cameraRef.current?.click()} style={chipBtn}>
                  <Icon name="camera" size={18} color="var(--brand-600)" /> ถ่ายรูป
                </button>
                <button onClick={() => fileRef.current?.click()} style={chipBtn}>
                  <Icon name="image" size={18} color="var(--brand-600)" /> เลือกไฟล์
                </button>
              </div>
            </div>
        }
        {photo && (
          <button onClick={e => { e.stopPropagation(); onRemove(index) }} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={14} color="#fff" />
          </button>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPick} />
        <input ref={fileRef}   type="file" accept="image/*"                       style={{ display: 'none' }} onChange={onPick} />
      </div>
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {MINIO_BASE + filename}
      </div>
      {photo && (
        <div style={{ display: 'flex', borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={() => cameraRef.current?.click()} style={halfBtn}>
            <Icon name="camera" size={16} color="var(--brand-600)" /> ถ่ายใหม่
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ ...halfBtn, borderLeft: '1px solid var(--border-subtle)' }}>
            <Icon name="image" size={16} color="var(--brand-600)" /> เลือกไฟล์
          </button>
        </div>
      )}
    </div>
  )
}

// blob URL → ย่อ+บีบอัดเป็น JPEG data URL ก่อนอัปโหลด
// รูปกล้องมือถือ/แท็บเล็ต full-res หลาย MB → base64 ใหญ่จนชน payload limit ของ n8n (อัปไม่ผ่าน)
// → ย่อด้านยาวสุดไม่เกิน MAX_EDGE แล้ว encode JPEG คุณภาพ JPEG_Q (เหลือ ~200-400KB ต่อรูป)
const MAX_EDGE = 1600
const JPEG_Q   = 0.72
function blobUrlToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1
        const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1   // ย่อลงเท่านั้น ไม่ขยาย
        const w = Math.max(1, Math.round(img.naturalWidth  * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', JPEG_Q))
      } catch (e) { reject(e) }
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

function ReceiveView({ prefillRackId = '', prefillCustId = '' }) {
  const [tempId]   = useState(genTempId)
  const [custId, setCustId]     = useState(prefillCustId)
  const [rackId, setRackId]     = useState(prefillRackId)
  const [category, setCategory] = useState('')
  const [photos, setPhotos]     = useState([null, null, null, null])
  const [saved, setSaved]       = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [custHit, setCustHit]   = useState(null)
  const [billPicker, setBillPicker] = useState([]) // bills to choose when customer has multiple active
  const custTimer = useRef(null)

  // revoke any remaining blob URLs on unmount (avoid memory leak)
  const photosRef = useRef(photos)
  useEffect(() => { photosRef.current = photos })
  useEffect(() => () => { photosRef.current.forEach(p => p && URL.revokeObjectURL(p)) }, [])

  const capturedCount = photos.filter(Boolean).length
  const valid = capturedCount > 0 && category && !saving

  const searchCust = (q) => {
    setCustId(q)
    setBillPicker([])
    if (custTimer.current) clearTimeout(custTimer.current)
    if (!q.trim()) { setCustHit(null); return }
    custTimer.current = setTimeout(async () => {
      try {
        const data = await customerLookup(q)
        const list = (data.customers ?? data ?? []).map(mapCustomer)
        const hit = list[0] || null
        setCustHit(hit)
        // auto-fill Rack ID from customer's active bills (only when not locked from BillDetailPanel)
        if (hit && !prefillRackId) {
          try {
            const billData = await getOpenBills(hit.id)
            const bills = (billData.bills ?? billData ?? []).map(mapBill)
            if (bills.length === 1) {
              setRackId(bills[0].rack)
              setBillPicker([])
            } else if (bills.length > 1) {
              setBillPicker(bills)
            }
          } catch { /* ไม่ auto-fill ถ้า fetch ล้มเหลว */ }
        }
      } catch { setCustHit(null) }
    }, 400)
  }

  // replace/remove a photo slot, revoking the old blob URL it held
  const setSlot = (idx, url) => {
    const old = photos[idx]
    if (old) URL.revokeObjectURL(old)
    setPhotos(ps => ps.map((x, j) => j === idx ? url : x))
  }

  const handleSave = async () => {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      const captured = photos.filter(Boolean)
      let seq = 1
      for (const url of captured) {
        const dataUrl = await blobUrlToDataUrl(url)
        await uploadPhoto({
          rack_id: rackId.trim(),
          customer_id: custHit?.id || custId.trim(),
          loyverse_uuid: custHit?.loyverse_uuid || '',
          cloth_category: category,
          cloth_type: '',
          seq: seq++,
          note: '',
          photo: dataUrl,
        })
      }
      captured.forEach(url => URL.revokeObjectURL(url))
      setPhotos(ps => ps.map(() => null))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 14px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', background: 'var(--surface-card)', color: 'var(--text-body)', outline: 'none' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-card)', flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--text-strong)' }}>บันทึกภาพการรับผ้า</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>{tempId}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-6)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 4 }}>
              Rack ID {prefillRackId && <span style={{ color: 'var(--brand-600)', fontSize: 11 }}>· ล็อกจากบิล</span>}
            </div>
            <input
              value={rackId}
              onChange={prefillRackId ? () => {} : e => setRackId(e.target.value)}
              readOnly={!!prefillRackId}
              placeholder="RK-260616-MT66"
              style={{ ...fieldStyle, ...(prefillRackId ? { background: '#f3f4f6', color: 'var(--text-muted)', cursor: 'default' } : {}) }}
            />
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 4 }}>
              Customer ID / ชื่อ / เบอร์ {prefillCustId && <span style={{ color: 'var(--brand-600)', fontSize: 11 }}>· ล็อกจากบิล</span>}
            </div>
            <input
              value={custId}
              onChange={prefillCustId ? () => {} : e => searchCust(e.target.value)}
              readOnly={!!prefillCustId}
              placeholder="C-001 หรือพิมพ์ชื่อ"
              style={{ ...fieldStyle, ...(prefillCustId ? { background: '#f3f4f6', color: 'var(--text-muted)', cursor: 'default' } : {}) }}
            />
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 4 }}>ประเภทผ้า <span style={{ color: 'var(--red-500)' }}>*</span></div>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer', color: category ? 'var(--text-body)' : 'var(--text-faint)' }}>
              <option value="">เลือกประเภทผ้า...</option>
              {CLOTH_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {custHit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', marginBottom: billPicker.length > 0 ? 'var(--space-2)' : 'var(--space-4)', background: 'var(--brand-tint)', border: '1px solid var(--brand-100)', borderRadius: 'var(--radius-md)' }}>
            <Avatar name={custHit.name} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{custHit.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-body)' }}>{custHit.id} · {custHit.tel}</div>
            </div>
            <Icon name="check" size={18} color="var(--brand-600)" />
          </div>
        )}
        {billPicker.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: '#fefce8', borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--fs-caption)', color: '#92400e', fontWeight: 600 }}>
              ลูกค้ามี {billPicker.length} บิล active — เลือกบิลที่ต้องการถ่ายรูป
            </div>
            {billPicker.map(b => (
              <div key={b.rack} onClick={() => { setRackId(b.rack); setBillPicker([]) }}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--brand-tint)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-card)'}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>{b.rack}</span>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>{b.opened || '—'} · {b.bags} ถุง</span>
                <StatusBadge status={b.status} style={{ marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text-strong)' }}>
              รูปผ้า <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>{capturedCount}/{photos.length} รูป</span>
            </span>
            <button onClick={() => setPhotos(ps => [...ps, null])} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', cursor: 'pointer' }}>
              <Icon name="plus" size={16} /> เพิ่มช่อง
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
            {photos.map((p, i) => (
              <PhotoSlot key={i} index={i} photo={p} tempId={tempId}
                onCapture={(idx, url) => setSlot(idx, url)}
                onRemove={idx => setSlot(idx, null)} />
            ))}
          </div>
        </div>
        {saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-4)', marginBottom: 'var(--space-4)', background: 'var(--green-50)', border: '1px solid var(--green-500)', borderRadius: 'var(--radius-md)', color: 'var(--green-700)', fontWeight: 600 }}>
            <Icon name="check" size={20} color="var(--green-700)" /> บันทึกสำเร็จ · {category}
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-4)', marginBottom: 'var(--space-4)', background: 'var(--red-50)', border: '1px solid var(--red-500)', borderRadius: 'var(--radius-md)', color: 'var(--red-700)', fontWeight: 600 }}>
            <Icon name="x" size={20} color="var(--red-700)" /> {error}
          </div>
        )}
        <NRButton block size="lg" disabled={!valid} loading={saving} iconLeft={<Icon name="check" size={22} color="#fff" />}
          onClick={handleSave}>
          {saving ? 'กำลังบันทึก...' : `บันทึกการรับผ้า · ${capturedCount} รูป${category ? ' · ' + category : ''}`}
        </NRButton>
      </div>
    </div>
  )
}

// ─── search view + rack map (ผังราว) ────────────────────────────────────────────
// ผังราว derive จาก bills · งานที่ "รับแล้ว" ออกจากผัง (ไม่นับว่าครองพื้นที่)
// multi-position คือ core: 1 บิลอยู่ได้หลายช่อง

// อ่านตำแหน่งของบิล: positions[] (จาก backend ในอนาคต) ไม่งั้น fallback No.Shelf/No.Rack เดี่ยว
function billPositions(b) {
  if (Array.isArray(b.positions) && b.positions.length) {
    return b.positions.map(p => ({
      zone: p.zone ?? p.no_shelf ?? '',
      slot: p.slot ?? p.no_rack ?? null,
      bags: Number(p.bags) || 0,
    }))
  }
  if (b.shelf && b.shelf !== '—') {
    return [{ zone: b.shelf, slot: (b.rack_no && b.rack_no !== '—') ? b.rack_no : null, bags: Number(b.bags) || 0 }]
  }
  return []
}

// position-entries [{ bill, pos }] ที่ยังครองพื้นที่ในโซน zk (1 บิลหลายตำแหน่ง = หลาย entry)
function entriesInZone(bills, zk) {
  const out = []
  for (const b of bills) {
    if (b.status === 'received') continue
    for (const pos of billPositions(b)) if (pos.zone === zk) out.push({ bill: b, pos })
  }
  return out
}
const entriesInSlot = (bills, zk, n) => entriesInZone(bills, zk).filter(e => String(e.pos.slot) === String(n))
const sumEntryBags = (entries) => entries.reduce((s, e) => s + (e.pos.bags || 0), 0)

function zoneTotals(bills, z) {
  const entries = entriesInZone(bills, z.key)
  const base = { works: entries.length, bags: sumEntryBags(entries) }
  if (z.unslotted) return { ...base, slots: 0, used: 0 }
  const used = Array.from({ length: z.count }, (_, i) => z.start + i)
    .filter(n => entriesInSlot(bills, z.key, n).length > 0).length
  return { ...base, slots: z.count, used }
}

function RackMap({ bills, onViewBill }) {
  const [selZone, setSelZone] = useState('all')
  const [selSlot, setSelSlot] = useState(null) // { zone, n }

  const visibleZones = ZONES.filter(z => selZone === 'all' || z.key === selZone)
  const grand = ZONES.reduce((a, z) => {
    const t = zoneTotals(bills, z)
    a.works += t.works; a.bags += t.bags
    return a
  }, { works: 0, bags: 0 })

  return (
    <div>
      {/* summary chips */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--brand-600)', borderRadius: 'var(--radius-md)', color: '#fff' }}>
          <div style={{ fontSize: 11, opacity: 0.85 }}>งานในผังทั้งหมด</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{grand.works} งาน · {grand.bags} ถุง</div>
        </div>
        {ZONES.map(z => {
          const t = zoneTotals(bills, z)
          return (
            <div key={z.key} style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{z.key}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>{t.works} งาน · {t.bags} ถุง</div>
              {!z.unslotted && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>ใช้ {t.used}/{t.slots} ช่อง</div>}
            </div>
          )
        })}
      </div>

      {/* zone filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {[{ key: 'all', label: 'ทั้งหมด' }, ...ZONES.map(z => ({ key: z.key, label: z.key }))].map(f => {
          const on = f.key === selZone
          return (
            <button key={f.key} onClick={() => { setSelZone(f.key); setSelSlot(null) }} style={{
              padding: '7px 14px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', fontWeight: on ? 600 : 400,
              border: '1px solid ' + (on ? 'var(--brand-600)' : 'var(--border-subtle)'),
              background: on ? 'var(--brand-600)' : 'var(--surface-card)', color: on ? '#fff' : 'var(--text-body)',
            }}>{f.label}</button>
          )
        })}
      </div>

      {/* slot grids per zone */}
      {visibleZones.map(z => {
        const t = zoneTotals(bills, z)
        const cols = Math.min(z.unslotted ? 3 : 5, z.unslotted ? 3 : z.count)
        return (
          <section key={z.key} style={{ marginBottom: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text-strong)' }}>{z.key}</span>
              {!z.unslotted && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>{z.unit} {z.start}–{z.start + z.count - 1}</span>}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--fs-sub)', color: 'var(--text-body)' }}>
                <b style={{ color: 'var(--text-brand)' }}>{t.works}</b> งาน · {t.bags} ถุง{!z.unslotted ? ` · ใช้ ${t.used}/${t.slots} ช่อง` : ''}
              </span>
            </div>

            {z.unslotted ? (
              entriesInZone(bills, z.key).length ? (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'var(--space-2)' }}>
                  {entriesInZone(bills, z.key).map(({ bill: b, pos }, i) => (
                    <div key={b.rack + '|' + i} onClick={() => onViewBill(b.rack)} style={{ padding: 'var(--space-3)', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
                      <span style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: b.status === 'open' ? 'var(--status-open-dot)' : 'var(--brand-400)' }} />
                      <div style={{ paddingLeft: 8 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>{b.rack}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text-body)' }}>{pos.bags || b.bags} ถุง</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-faint)', border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sub)' }}>ไม่มีงานวางบนพื้น</div>
              )
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'var(--space-2)' }}>
                {Array.from({ length: z.count }, (_, i) => z.start + i).map(n => {
                  const items = entriesInSlot(bills, z.key, n)
                  const empty = items.length === 0
                  const isSel = selSlot && selSlot.zone === z.key && selSlot.n === n
                  return (
                    <button key={n} onClick={() => setSelSlot(empty ? null : (isSel ? null : { zone: z.key, n }))} style={{
                      padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', cursor: empty ? 'default' : 'pointer', textAlign: 'left',
                      border: '1px solid ' + (isSel ? 'var(--brand-600)' : empty ? 'var(--border-subtle)' : 'var(--border-default)'),
                      background: isSel ? 'var(--brand-tint)' : empty ? 'transparent' : 'var(--surface-card)',
                      opacity: empty ? 0.5 : 1, position: 'relative', overflow: 'hidden',
                    }}>
                      {!empty && <span style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: 'var(--brand-400)' }} />}
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--fs-body)', color: isSel ? 'var(--text-brand)' : 'var(--text-strong)', paddingLeft: empty ? 0 : 6 }}>{z.unit} {n}</div>
                      {empty ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-faint)', paddingLeft: 6 }}>ว่าง</div>
                      ) : (
                        <>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--text-brand)', paddingLeft: 6 }}>{items.length} งาน · {sumEntryBags(items)} ถุง</div>
                          {items.slice(0, 2).map(({ bill: b }, i) => (
                            <div key={b.rack + '|' + i} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)', paddingLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{b.name}</div>
                          ))}
                          {items.length > 2 && <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-faint)', paddingLeft: 6 }}>+{items.length - 2} ราย</div>}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* inline slot detail */}
            {selSlot && selSlot.zone === z.key && (() => {
              const items = entriesInSlot(bills, z.key, selSlot.n)
              if (!items.length) return null
              return (
                <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-4)', background: 'var(--brand-tint)', border: '1px solid var(--brand-200)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-brand)' }}>{z.unit} {selSlot.n} · {items.length} งาน · {sumEntryBags(items)} ถุง</span>
                    <button onClick={() => setSelSlot(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><Icon name="x" size={18} /></button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {items.map(({ bill: b, pos }, i) => (
                      <div key={b.rack + '|' + i} onClick={() => onViewBill(b.rack)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                        <Avatar name={b.name} size={38} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>{b.rack}</span>
                          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginLeft: 8 }}>{b.name}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>{pos.bags || b.bags} ถุง · {b.opened}</span>
                        <StatusBadge status={b.status} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </section>
        )
      })}
    </div>
  )
}

function SearchView({ bills, q, onQ, onViewBill }) {
  const sq = q.trim().toLowerCase()
  const results = sq ? bills.filter(b =>
    b.rack.toLowerCase().includes(sq) ||
    b.name.toLowerCase().includes(sq) ||
    (b.customer || '').toLowerCase().includes(sq)
  ) : []

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-card)', flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 'var(--space-3)' }}>ค้นหา & ผังราว</div>
        <SearchInput value={q} onChange={onQ} placeholder="ค้นหา รหัสบิล / ชื่อลูกค้า / รหัสลูกค้า" />
        {sq && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {results.length > 0 ? results.map(b => (
              <div key={b.rack} onClick={() => onViewBill(b.rack)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', marginBottom: 4, background: 'var(--surface-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                <Avatar name={b.name} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: 'var(--text-strong)' }}>{b.rack}</span>
                    <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-body)' }}>{b.name}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--text-muted)', marginTop: 2 }}>
                    {(() => {
                      // แสดงทุกตำแหน่ง (multi-position) + จำนวนถุงต่อตำแหน่งเมื่อมีหลายที่ — ไม่ยุบเหลือตำแหน่งเดียว
                      const pos = b.status !== 'received' ? billPositions(b) : []
                      const multi = pos.length > 1
                      const posText = pos
                        .map(p => `${p.zone}${p.slot != null ? ` ${p.slot}` : ''}${multi && p.bags ? ` (${p.bags})` : ''}`)
                        .join(' · ')
                      return `${b.bags} ถุง${posText ? ` · ${posText}` : ''} · เปิด ${b.opened}`
                    })()}
                  </div>
                </div>
                <StatusBadge status={b.status} size="sm" />
                <Icon name="chevron" size={16} color="var(--text-faint)" />
              </div>
            )) : (
              <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--fs-sub)' }}>ไม่พบบิลสำหรับ "{q}"</div>
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5) var(--space-6)' }}>
        {bills.length === 0 ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>ยังไม่มีบิลในระบบ</div>
        ) : (
          <RackMap bills={bills} onViewBill={onViewBill} />
        )}
      </div>
    </div>
  )
}

// ─── delete confirm modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ rackId, loading, onConfirm, onCancel }) {
  const [input, setInput] = useState('')
  const match = input.trim() === rackId.trim()
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(22,26,24,0.65)', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-8)', width: 380, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Icon name="x" size={22} color="var(--red-700)" />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-heading)', fontWeight: 'var(--fw-semibold)', color: 'var(--red-700)' }}>ยืนยันลบบิล</span>
        </div>
        <div style={{ background: 'var(--red-50)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', color: 'var(--red-700)' }}>
          การลบ <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{rackId}</span> ออกจาก Master register เป็นการถาวร ย้อนกลับไม่ได้
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sub)', fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>
            พิมพ์ Rack ID เพื่อยืนยัน
          </label>
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={rackId}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body)', padding: '10px 14px',
              border: `1.5px solid ${match ? 'var(--red-500)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-sm)', outline: 'none', width: '100%', boxSizing: 'border-box',
              background: match ? 'var(--red-50)' : 'var(--surface-card)', color: 'var(--text-strong)',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <NRButton variant="outline" size="md" onClick={onCancel} disabled={loading}>ยกเลิก</NRButton>
          <NRButton
            size="md"
            loading={loading}
            disabled={!match || loading}
            onClick={onConfirm}
            style={{ background: match ? 'var(--red-500)' : 'var(--gray-300)', color: '#fff', borderColor: 'transparent' }}
          >
            ยืนยันลบ
          </NRButton>
        </div>
      </div>
    </div>
  )
}
