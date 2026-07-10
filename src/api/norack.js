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
// Manual logout from the UI: clear the token and drop back to the login screen (AuthGate listens for this).
export function signOut() {
  logout()
  window.dispatchEvent(new Event('norack-unauth'))
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
// Permission helpers (UX gating only — the backend enforces for real via requirePerm). admin → all perms.
// perms come from login/refresh (/me) and are stored in norack_user; they refresh on each token slide.
export function can(perm) { const u = currentUser(); return u?.role === 'admin' || (Array.isArray(u?.perms) && u.perms.includes(perm)) }
export const isAdmin = () => currentUser()?.role === 'admin'
// Sliding session: swap the stored token for a fresh 7-day one. Called on app load / tab-visible / every
// few hours (AuthGate) so a daily-used tablet never has to log in again. If the session was revoked
// (token_version bumped / disabled) the backend returns 401 → apiCall clears the token and fires
// `norack-unauth`, dropping the user to the login screen. Never throws (best-effort keep-alive).
export async function refreshToken() {
  try {
    const d = await apiPost('/api/auth/refresh')
    if (d?.token) localStorage.setItem('norack_token', d.token)
    if (d?.user) localStorage.setItem('norack_user', JSON.stringify(d.user)) // pick up any role/perm change
    return true
  } catch { return false }
}

// ── core request (Bearer + auto-failover to the other runtime) ───────────────────
// GET is idempotent → fail over on a network error, a timeout, OR a 5xx. Writes (POST/DELETE) fail over on a
// NETWORK error only: a 5xx (or a timeout) might mean the write already applied to the shared Turso, so
// retrying the other runtime could double-apply. On the request that finally succeeds we announce the
// effective backend (`norack-backend-active`) so the header can reveal a silent failover.
const REQUEST_TIMEOUT_MS = 10000
const announceBackend = (b) => window.dispatchEvent(new CustomEvent('norack-backend-active', { detail: b }))

async function apiCall(method, path, body) {
  const token = getToken()
  const order = getBackend() === 'deno' ? ['deno', 'cf'] : ['cf', 'deno']
  const isWrite = method !== 'GET' && method !== 'HEAD'
  let lastErr
  for (let i = 0; i < order.length; i++) {
    const b = order[i]
    const hasFallback = i < order.length - 1
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
    let r
    try {
      r = await fetch(`${baseUrl(b)}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      const isTimeout = e?.name === 'AbortError'
      // GET → fail over on any transport failure. Write → only on a genuine network error (not a timeout,
      // which is ambiguous about whether the server applied it).
      if (hasFallback && (!isWrite || !isTimeout)) continue
      throw new Error(isTimeout ? 'เซิร์ฟเวอร์ตอบช้าเกินไป' : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ทั้งสองที่', { cause: e })
    }
    clearTimeout(timer)
    if (r.status === 401) {
      logout()
      window.dispatchEvent(new Event('norack-unauth'))
      throw new Error('unauthorized')
    }
    // 5xx: fail over ONLY for idempotent GETs (a write might already be applied on the shared DB).
    if (r.status >= 500 && !isWrite && hasFallback) {
      lastErr = new Error(`HTTP ${r.status}`)
      continue
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `HTTP ${r.status}`)
    }
    announceBackend(b)
    return r.json().catch(() => ({}))
  }
  throw lastErr || new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ทั้งสองที่')
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
// TTL so customers created/renamed OUTSIDE this device (POS→webhook, another tablet) show up in search
// within a minute — without it the cache only cleared on this device's own add/delete, i.e. never all day.
const CUST_CACHE_TTL_MS = 60_000
let _custCache = null
let _custCacheAt = 0
async function allCustomers() {
  if (_custCache && Date.now() - _custCacheAt < CUST_CACHE_TTL_MS) return _custCache
  const all = []
  for (let offset = 0; ; offset += 500) {
    const d = await apiGet(`/api/customers?limit=500&offset=${offset}`)
    const batch = d.customers || []
    all.push(...batch)
    if (batch.length < 500) break
  }
  _custCache = all
  _custCacheAt = Date.now()
  return all
}
export function clearCustomerCache() { _custCache = null; _custCacheAt = 0 }

// A Customer_ID is 13 digits + 5 hex chars. Roughly 1 in 10 of them (9.3% of our 3,091 customers) happen
// to have an all-numeric hex part, i.e. an 18-digit id — so the id test MUST come before the phone test,
// or those customers get looked up by phone blind-index, never match, and no bill can be opened for them.
const CUST_ID_RE = /^\d{13}[0-9a-f]{5}$/
const MAX_TEL_DIGITS = 12 // Thai numbers are 9–10; anything longer is an id, not a phone

export async function customerLookup(q) {
  const s = String(q ?? '').trim()
  const digits = s.replace(/\D/g, '')
  let customers
  if (CUST_ID_RE.test(s)) {
    const d = await apiGet(`/api/customers/${encodeURIComponent(s)}`)
    customers = d.customer ? [d.customer] : []
  } else if (digits.length >= 6 && digits.length <= MAX_TEL_DIGITS && /^[0-9\s-]+$/.test(s)) {
    customers = (await apiGet(`/api/customers?tel=${encodeURIComponent(s)}`)).customers || []
  } else {
    const all = await allCustomers()
    const ql = s.toLowerCase()
    customers = ql
      ? all.filter((c) => (c.customer_id || '').toLowerCase().includes(ql) || (c.name || '').toLowerCase().includes(ql) || (c.tel || '').includes(s))
      : all
  }
  return { status: 'ok', customers: customers.map(custAlias) }
}

// ── customer sync (Loyverse write-back) — the "ลูกค้าใหม่" review tab ─────────────
// New (pending/failed) customers, each with same-phone duplicates[] so staff can spot a re-added customer.
export async function getReview() {
  const d = await apiGet('/api/customers/review')
  return (d.customers || []).map((c) => ({ ...custAlias(c), duplicates: c.duplicates || [] }))
}
// Push this customer's NO.Rack id into Loyverse customer_code (semi-auto write-back).
export const syncCustomer = (customerId) => apiPost(`/api/customers/${encodeURIComponent(customerId)}/sync-loyverse`)

// Staff MANUAL add — smart create/adopt in Loyverse + generate id (fallback for customers the POS→webhook
// path missed, e.g. created during the cutover gap). Backend returns { ok, mode:'created'|'adopted', customer }
// on success, or { duplicate:[{customer_id,name}] } when the phone already matches a tracked customer —
// retry with force=true to override. Clears the client customer cache so the new one is searchable at once.
export async function createCustomer(name, tel, force = false) {
  const r = await apiPost('/api/customers', { name, tel, force })
  if (r && r.ok) clearCustomerCache()
  return r
}
// Delete a customer from NO.Rack (Turso) only — does NOT touch Loyverse. Backend 409s if the customer has
// bills. Requires the 'delete_customer' permission (backend-enforced). Clears the client cache on success.
export async function deleteCustomer(customerId) {
  const r = await apiCall('DELETE', `/api/customers/${encodeURIComponent(customerId)}`)
  if (r && r.ok) clearCustomerCache()
  return r
}

// ── admin: staff permission management (gear ⚙️ popup — admin only, backend requireAdmin) ──────────
export const getStaffList = () => apiGet('/api/admin/staff')
export const setStaffPerms = (username, perms) => apiPost(`/api/admin/staff/${encodeURIComponent(username)}/perms`, { perms })

// ── admin: LINE assistant webhook DR switch (admin only) — flips the GLOBAL LINE webhook CF↔Deno via the
// backend (which pre-flight health-tests the target and 409s 'target_unhealthy' unless force). Unlike the
// per-browser web BackendSwitch, this is one global setting for the whole bot. Works during a CF outage:
// the POST fails over CF→Deno (network error), so Deno flips the webhook to Deno.
export const getLineWebhook = () => apiGet('/api/admin/line-webhook')
export const setLineWebhook = (target, force = false) => apiPost('/api/admin/line-webhook', { target, force })

// ── system status ("ระบบ" badge) ───────────────────────────────────────────────
// Cheap by design: the backend answers from a cache the watcher cron refreshes, never by calling Loyverse.
// Every staff member may read it — knowing the system is healthy is not an admin privilege.
export const getSystemStatus = () => apiGet('/api/system/status')
export const getErrorCatalog = () => apiGet('/api/system/catalog')
export const getSystemErrors = () => apiGet('/api/system/errors') // admin
export const resolveSystemError = (id) => apiPost(`/api/system/errors/${id}/resolve`, {}) // admin
export const healWebhook = () => apiPost('/api/system/webhook/heal', {}) // admin

/** Report a crash. Never throws and never blocks — a broken error reporter must not break the app. */
export function reportClientError({ message, route, code }) {
  try {
    return apiPost('/api/system/client-errors', { message: String(message ?? '').slice(0, 500), route, code }).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}

// ── backup export (Phase 10c) — full DB snapshot for the "สำรองข้อมูล" button ────
// Returns { meta, sheets: { customers, bills, bill_positions } }, every cell a string (fidelity-safe).
export const exportBackup = () => apiGet('/api/export/backup')

// ── restore/import (Phase 10b) — INSERT-MISSING only (never overwrites live data) ─
// preview → returns { preview: {...counts} } without writing; apply → inserts the missing rows.
export const importPreview = (sheets) => apiPost('/api/import', { dryRun: true, sheets })
export const importApply = (sheets) => apiPost('/api/import', { dryRun: false, sheets })

// ── bills ─────────────────────────────────────────────────────────────────────
export async function getOpenBills(customerId) {
  // limit=1000 so the rack plan loads every bill (backend default is only 200 → would silently drop bills).
  const q = customerId ? `?customer_id=${encodeURIComponent(customerId)}&limit=1000` : '?limit=1000'
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
