// API adapter → new cloud backend (Hono on CF Workers primary / Deno backup, shared Turso + B2).
// Keeps the SAME function names the UI already imports, but talks REST, carries a Bearer token, converts
// dates (ISO ↔ พ.ศ.), and does the 2-step presigned photo upload. Backend switch + auto-failover CF→Deno.
// See docs/phase6-frontend-cutover.md (backend repo).
import { isoToThai, thaiToIso } from './dates'

const BACKENDS = {
  cf: 'https://norack-api.winterarmy-homeserver.workers.dev',
  deno: 'https://norack-db-oncloud.lordvoldermod1980.deno.net',
}
export const BACKEND_LABELS = { cf: 'Cloudflare (หลัก)', deno: 'Deno (สำรอง)' }

export function getBackend() {
  return localStorage.getItem('norack_backend') || import.meta.env.VITE_API_BACKEND || 'cf'
}
export function setBackend(b) {
  if (BACKENDS[b]) localStorage.setItem('norack_backend', b)
}
const baseUrl = (b) => BACKENDS[b] || BACKENDS.cf

// ── auth (Bearer token in localStorage; old static-token model is gone) ──────────
const getToken = () => localStorage.getItem('norack_token') || ''
export const isAuthed = () => !!getToken()
export function logout() {
  localStorage.removeItem('norack_token')
  localStorage.removeItem('norack_user')
}
export async function login(username, password) {
  const r = await fetch(`${baseUrl(getBackend())}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.token) throw new Error(d.error || `เข้าสู่ระบบไม่สำเร็จ (${r.status})`)
  localStorage.setItem('norack_token', d.token)
  if (d.user) localStorage.setItem('norack_user', JSON.stringify(d.user))
  return d.user
}
export function currentUser() {
  try { return JSON.parse(localStorage.getItem('norack_user') || 'null') } catch { return null }
}

// ── core request (Bearer + auto-failover to the other runtime on a NETWORK error only) ──
async function apiCall(method, path, body) {
  const token = getToken()
  const order = getBackend() === 'deno' ? ['deno', 'cf'] : ['cf', 'deno']
  let netErr
  for (const b of order) {
    let r
    try {
      r = await fetch(`${baseUrl(b)}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      netErr = e
      continue // network/CORS/host down → try the other backend
    }
    if (r.status === 401) {
      logout()
      window.dispatchEvent(new Event('norack-unauth'))
      throw new Error('unauthorized')
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `HTTP ${r.status}`)
    }
    return r.json().catch(() => ({}))
  }
  throw netErr || new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ทั้งสองที่')
}
const apiGet = (p) => apiCall('GET', p)
const apiPost = (p, b) => apiCall('POST', p, b)

// ── transforms ───────────────────────────────────────────────────────────────
// bill: ISO dates → พ.ศ. so the UI (which shows/inputs พ.ศ.) keeps working unchanged.
const billToThai = (b) => ({
  ...b,
  open_date: isoToThai(b.open_date),
  done_date: isoToThai(b.done_date),
  final_date: isoToThai(b.final_date),
})
// customer: API returns `tel`; the UI's mapCustomer reads `phone` → add the alias.
const custAlias = (c) => ({ ...c, phone: c.tel })

// ── SSE removed (polling replaces it). Kept exported so old imports don't break. ──
export const SSE_URL = ''

// ── customers ─────────────────────────────────────────────────────────────────
// Phone-ish query → exact blind-index lookup. Anything else (name / id substring) → filter a cached full
// list client-side (the backend intentionally has no server-side name search; names live encrypted).
let _custCache = null
async function allCustomers() {
  if (_custCache) return _custCache
  const all = []
  for (let offset = 0; ; offset += 500) {
    const d = await apiGet(`/api/customers?limit=500&offset=${offset}`)
    const batch = d.customers || []
    all.push(...batch)
    if (batch.length < 500) break
  }
  _custCache = all
  return all
}
export function clearCustomerCache() { _custCache = null }

export async function customerLookup(q) {
  const s = String(q ?? '').trim()
  const digits = s.replace(/\D/g, '')
  let customers
  if (digits.length >= 6 && /^[0-9\s-]+$/.test(s)) {
    customers = (await apiGet(`/api/customers?tel=${encodeURIComponent(s)}`)).customers || []
  } else if (/^\d{13}[0-9a-f]{5}$/.test(s)) {
    const d = await apiGet(`/api/customers/${encodeURIComponent(s)}`)
    customers = d.customer ? [d.customer] : []
  } else {
    const all = await allCustomers()
    const ql = s.toLowerCase()
    customers = ql
      ? all.filter((c) => (c.customer_id || '').toLowerCase().includes(ql) || (c.name || '').toLowerCase().includes(ql) || (c.tel || '').includes(s))
      : all
  }
  return { status: 'ok', customers: customers.map(custAlias) }
}

// ── bills ─────────────────────────────────────────────────────────────────────
export async function getOpenBills(customerId) {
  const q = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''
  const d = await apiGet(`/api/bills${q}`)
  return { status: 'ok', bills: (d.bills || []).map(billToThai) }
}

export async function getBillStatus(rackId) {
  const d = await apiCall('GET', `/api/bills/${encodeURIComponent(rackId)}`).catch(() => null)
  if (!d || d.error || !d.bill) return null
  return {
    status: 'ok',
    bill: { ...billToThai(d.bill), positions: d.positions || [] },
    positions: d.positions || [],
    photos: (d.photos || []).map((p) => ({ ...p, photo_url: p.url })),
  }
}

export async function openBill(body) {
  return apiPost('/api/bills', {
    customer_id: body.customer_id,
    loyverse_uuid: body.loyverse_uuid,
    receipt_number: body.receipt_number,
    no_rack: body.no_rack,
    no_shelf: body.no_shelf,
    total_bags: body.total_bags,
    open_date: thaiToIso(body.open_date),
    positions: body.positions,
  })
}

export async function updateBill(body) {
  const { rack_id, ...rest } = body
  const patch = { ...rest }
  for (const k of ['open_date', 'done_date', 'final_date']) if (k in patch) patch[k] = thaiToIso(patch[k])
  return apiPost(`/api/bills/${encodeURIComponent(rack_id)}`, patch)
}

export const updateStatus = (rackId, status) => apiPost(`/api/bills/${encodeURIComponent(rackId)}/status`, { status })
export const deleteBill = (rackId) => apiCall('DELETE', `/api/bills/${encodeURIComponent(rackId)}`)

// ── photos (2-step presigned: record metadata → PUT bytes straight to B2) ────────
export async function uploadPhoto(body) {
  const dataUrl = body.photo || ''
  const mime = (dataUrl.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg'
  const ext = /png/i.test(mime) ? 'png' : 'jpg'
  const meta = await apiPost('/api/photos', {
    rack_id: body.rack_id,
    customer_id: body.customer_id,
    loyverse_uuid: body.loyverse_uuid,
    cloth_category: body.cloth_category,
    cloth_type: body.cloth_type,
    seq: body.seq,
    ext,
  })
  if (meta?.upload_url) {
    const blob = await (await fetch(dataUrl)).blob()
    const put = await fetch(meta.upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': mime } })
    if (!put.ok) throw new Error(`อัปโหลดรูปไม่สำเร็จ (${put.status})`)
  }
  return meta
}
