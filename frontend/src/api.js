/* DataVault API client.
 *
 * The session token lives in memory only (React state in App.jsx). It is
 * never written to localStorage, sessionStorage, the DOM, or a log. Every
 * request carries it as an Authorization: Bearer header. There is no
 * X-Role header: the server derives the caller's role and tenant from the
 * token, so the browser can never choose a different tenant.
 */

const API = '/api'

export async function apiRequest(token, path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return {
      ok: false, status: 0, data: null, queryId: null,
      error: 'Could not reach the API. Check the backend is running on port 8080 and retry.',
    }
  }
  const queryId = res.headers.get('X-Snowflake-Query-Id')
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const message = (data && (data.error || data.detail)) || `Request failed (HTTP ${res.status})`
    return { ok: false, status: res.status, data, queryId, error: message }
  }
  return { ok: true, status: res.status, data, queryId, error: null }
}

export function apiLogin(username, password) {
  return apiRequest(null, '/auth/login', { method: 'POST', body: { username, password } })
}

export function apiLogout(token) {
  return apiRequest(token, '/auth/logout', { method: 'POST', body: {} })
}

/* INR with Indian digit grouping, e.g. ₹6,56,950.40 */
export function fmtINR(val) {
  const n = Number(val || 0)
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtINR0(val) {
  const n = Number(val || 0)
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export function fmtNum(val) {
  return Number(val || 0).toLocaleString('en-IN')
}

export function fmtUSD(val) {
  const n = Number(val || 0)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* Short, human timestamp, e.g. 11 Nov 2026, 14:32 */
export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* "Jan 2025" from a YYYY-MM month key */
export function fmtMonth(ym) {
  if (!ym || ym.length < 7) return ym || '—'
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}
