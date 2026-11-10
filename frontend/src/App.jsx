/**
 * DataVault — Multi-Tenant Analytics Platform
 * App.jsx — Main application component
 *
 * Architecture:
 *  - Login page  : shown when no role is selected
 *  - Dashboard   : navbar + sidebar + main content area
 *
 * All existing API logic is preserved intact.
 */

import { useEffect, useState } from 'react'
import './index.css'

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
const API = '/api'

const TENANTS = [
  {
    role:        'TENANT_A_ANALYST',
    tenant:      'STEAM',
    name:        'Steam Valve Corporation',
    initials:    'SV',
    avatarClass: 'steam',
    username:    'steam_analyst',
    password:    'SteamVault@2024',
  },
  {
    role:        'TENANT_B_ANALYST',
    tenant:      'EA',
    name:        'Electronic Arts',
    initials:    'EA',
    avatarClass: 'ea',
    username:    'ea_analyst',
    password:    'EAVault@2024',
  },
]

/* ─────────────────────────────────────────────
   Inline SVG Icons
───────────────────────────────────────────── */
const Icons = {
  Lock: ({ size = 24, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  ArrowRight: ({ size = 14, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  ChevronRight: ({ size = 14, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  LogOut: ({ size = 15, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  LayoutDashboard: ({ size = 16, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  ShoppingCart: ({ size = 16, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  ),
  Shield: ({ size = 16, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  DollarSign: ({ size = 18, color = '#4f46e5' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Package: ({ size = 18, color = '#10b981' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  Users: ({ size = 18, color = '#f59e0b' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  TrendingUp: ({ size = 18, color = '#0ea5e9' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  AlertTriangle: ({ size = 18, color = '#ef4444' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  XCircle: ({ size = 18, color = '#ef4444' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  Snowflake: ({ size = 14, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22"/>
      <path d="M17 7l-5-5-5 5"/><path d="M17 17l-5 5-5-5"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M7 7l-5 5 5 5"/><path d="M17 7l5 5-5 5"/>
    </svg>
  ),
  Eye: ({ size = 15, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  EyeOff: ({ size = 15, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ),
  DataVaultLogo: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
}

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function fmtCurrency(val) {
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function channelClass(channel) {
  if (!channel) return 'default'
  const c = channel.toLowerCase()
  if (c.includes('online')) return 'online'
  if (c.includes('steam'))  return 'steam'
  if (c.includes('retail')) return 'retail'
  return 'default'
}

/* ─────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────── */

/** Full-screen loading spinner */
function Spinner({ label = 'Loading data…' }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <span className="spinner-label">{label}</span>
    </div>
  )
}

/** Styled alert/banner */
function Alert({ type = 'alert-danger', icon, title, children }) {
  return (
    <div className={`alert ${type}`} role="alert">
      {icon && <span className="alert-icon">{icon}</span>}
      <div>
        {title && <span className="alert-title">{title}</span>}
        {children}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Login Page
───────────────────────────────────────────── */
function LoginPage({ onLogin }) {
  // Which tenant's sign-in form is expanded (null = none)
  const [activeTenant, setActiveTenant] = useState(null)
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [authError,    setAuthError]    = useState('')
  const [busy,         setBusy]         = useState(false)

  function selectTenant(t) {
    setActiveTenant(t)
    setUsername('')
    setPassword('')
    setShowPass(false)
    setAuthError('')
  }

  function handleBack() {
    setActiveTenant(null)
    setAuthError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setAuthError('')
    setBusy(true)

    // Simulate a brief auth check (purely frontend — credentials matched locally)
    await new Promise(r => setTimeout(r, 600))

    if (username === activeTenant.username && password === activeTenant.password) {
      onLogin(activeTenant.role)
    } else {
      setAuthError('Invalid username or password. Check the sample credentials below.')
    }
    setBusy(false)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <Icons.DataVaultLogo size={28} />
          </div>
          <h1 className="login-title">DataVault</h1>
          <p className="login-subtitle">Multi-Tenant Analytics Platform</p>
          {!activeTenant && (
            <>
              <p className="login-prompt">Select your organization to continue</p>
              <div className="login-demo-notice">
                <span className="demo-pill">DEMO IDENTITY</span>
                <span>Client-side identity simulation mapping to Snowflake RBAC role header (<code>X-Role</code>).</span>
              </div>
            </>
          )}
        </div>

        {/* ── Step 1: Tenant picker ── */}
        {!activeTenant && (
          <>
            <div className="tenant-grid">
              {TENANTS.map(t => (
                <button
                  key={t.role}
                  className="tenant-card"
                  onClick={() => selectTenant(t)}
                  aria-label={`Sign in as ${t.name}`}
                >
                  <div className={`tenant-avatar ${t.avatarClass}`}>{t.initials}</div>
                  <div className="tenant-info">
                    <div className="tenant-company">{t.name}</div>
                    <div className="tenant-badges">
                      <span className="badge badge-tenant">{t.tenant}</span>
                      <span className="badge badge-role">{t.role}</span>
                    </div>
                  </div>
                  <div className="sign-in-btn">
                    Sign in <Icons.ArrowRight size={13} />
                  </div>
                </button>
              ))}
            </div>

            {/* Sample credentials hint */}
            <div className="creds-hint">
              <Icons.Lock size={12} color="rgba(255,255,255,.4)" />
              <span>Sample credentials available on each sign-in screen</span>
            </div>
          </>
        )}

        {/* ── Step 2: Credential form ── */}
        {activeTenant && (
          <div className="cred-form-wrap">
            {/* Back link */}
            <button className="back-link" onClick={handleBack}>
              ← Back to organizations
            </button>

            {/* Tenant identity strip */}
            <div className="cred-tenant-strip">
              <div className={`tenant-avatar ${activeTenant.avatarClass}`} style={{ width: 40, height: 40, fontSize: 14 }}>
                {activeTenant.initials}
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{activeTenant.name}</div>
                <div className="tenant-badges" style={{ marginTop: 4 }}>
                  <span className="badge badge-tenant">{activeTenant.tenant}</span>
                  <span className="badge badge-role">{activeTenant.role}</span>
                </div>
              </div>
            </div>

            {/* Demo authentication notice */}
            <div className="demo-auth-banner">
              <strong>Demo Authentication:</strong> The Spring Boot API enforces isolation via the <code>X-Role</code> header & Snowflake Secure Views — passwords are not verified by the backend.
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="cred-form" noValidate>
              {/* Username */}
              <div className="form-group">
                <label className="form-label" htmlFor="dv-username">Username</label>
                <input
                  id="dv-username"
                  type="text"
                  className="form-input"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              {/* Password */}
              <div className="form-group">
                <label className="form-label" htmlFor="dv-password">Password</label>
                <div className="password-wrap">
                  <input
                    id="dv-password"
                    type={showPass ? 'text' : 'password'}
                    className="form-input"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="eye-btn"
                    onClick={() => setShowPass(s => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass
                      ? <Icons.EyeOff size={15} color="rgba(255,255,255,.5)" />
                      : <Icons.Eye    size={15} color="rgba(255,255,255,.5)" />
                    }
                  </button>
                </div>
              </div>

              {/* Error */}
              {authError && (
                <div className="form-error">
                  <Icons.AlertTriangle size={14} color="#fca5a5" />
                  {authError}
                </div>
              )}

              {/* Submit */}
              <button type="submit" className="submit-btn" disabled={busy}>
                {busy
                  ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.2)' }} /> Signing in…</>
                  : <>Sign in <Icons.ArrowRight size={13} /></>
                }
              </button>
            </form>

            {/* Sample credentials box */}
            <div className="sample-creds-box">
              <div className="sample-creds-title">
                <Icons.Lock size={12} color="rgba(255,255,255,.5)" />
                Sample Demo Credentials
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>
                Maps client session to Snowflake role: <code style={{ color: '#93c5fd' }}>{activeTenant.role}</code>
              </div>
              <div className="sample-creds-row">
                <span className="sample-creds-label">Username</span>
                <code className="sample-creds-value"
                  onClick={() => setUsername(activeTenant.username)}
                  title="Click to fill"
                >
                  {activeTenant.username}
                </code>
              </div>
              <div className="sample-creds-row">
                <span className="sample-creds-label">Password</span>
                <code className="sample-creds-value"
                  onClick={() => setPassword(activeTenant.password)}
                  title="Click to fill"
                >
                  {activeTenant.password}
                </code>
              </div>
              <div className="sample-creds-tip">Click any value to auto-fill • Maps to <code>X-Role: {activeTenant.role}</code></div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="login-footer">
          <Icons.Shield size={12} color="rgba(255,255,255,.35)" />
          <span>Snowflake Secure Views + RBAC</span>
          <span className="login-footer-dot" />
          <Icons.Lock size={12} color="rgba(255,255,255,.35)" />
          <span>Demo Identity Maps to X-Role Header</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   KPI Card
───────────────────────────────────────────── */
function KpiCard({ label, value, icon, iconClass, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-header">
        <span className="kpi-label">{label}</span>
        <div className={`kpi-icon ${iconClass}`}>{icon}</div>
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Orders Table
───────────────────────────────────────────── */
function OrdersTable({ orders, selectedOrder, onRowClick, loadingOrderId }) {
  if (orders.length === 0) {
    return (
      <div className="table-wrapper">
        <div className="empty-state">
          <Icons.ShoppingCart size={40} color="#94a3b8" />
          <p>No orders found for this tenant.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Customer ID</th>
            <th>Date</th>
            <th>Channel</th>
            <th style={{ width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => {
            const isExpanded = selectedOrder && selectedOrder.orderId === o.orderId
            return (
              <>
                <tr
                  key={o.orderId}
                  className={isExpanded ? 'expanded' : ''}
                  onClick={() => onRowClick(o.orderId)}
                >
                  <td><span className="order-id">{o.orderId}</span></td>
                  <td className="monospace">{o.customerId}</td>
                  <td>{o.orderDate}</td>
                  <td>
                    <span className={`channel-badge ${channelClass(o.salesChannel)}`}>
                      {o.salesChannel || '—'}
                    </span>
                  </td>
                  <td>
                    {loadingOrderId === o.orderId
                      ? <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      : <span className="expand-icon"><Icons.ChevronRight size={12} /></span>
                    }
                  </td>
                </tr>

                {/* Inline expanded detail */}
                {isExpanded && selectedOrder.lines && (
                  <tr key={`${o.orderId}-detail`} className="order-detail-row">
                    <td colSpan={5}>
                      <div className="order-detail-panel">
                        <div className="order-detail-inner">
                          <div className="order-detail-title">
                            <Icons.Package size={15} color="#4f46e5" />
                            Line Items — Order <span style={{ color: '#4f46e5' }}>{selectedOrder.orderId}</span>
                          </div>
                          <table className="lines-table">
                            <thead>
                              <tr>
                                <th>Line #</th>
                                <th>Product ID</th>
                                <th>Qty</th>
                                <th>Unit Price</th>
                                <th>Discount %</th>
                                <th>Revenue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedOrder.lines.map(l => (
                                <tr key={l.orderLineId}>
                                  <td className="monospace">{l.orderLineId}</td>
                                  <td className="monospace">{l.productId}</td>
                                  <td>{l.quantity}</td>
                                  <td>{fmtCurrency(l.unitPrice)}</td>
                                  <td>{l.discountPct}%</td>
                                  <td style={{ fontWeight: 600 }}>{fmtCurrency(l.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Audit Log Page
───────────────────────────────────────────── */
function AuditLogPage({ current, other, role, auditLog, onRunQuery }) {
  const [targetTenant, setTargetTenant] = useState(other.tenant)
  const [endpoint,     setEndpoint]     = useState('/api/kpis')
  const [busy,         setBusy]         = useState(false)
  const [lastResult,   setLastResult]   = useState(null)

  async function handleRunQuery() {
    setBusy(true)
    const result = await onRunQuery(targetTenant, endpoint)
    setLastResult(result)
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Access Scope card ── */}
      <div className="audit-scope-card">
        <div className="audit-scope-title">
          <Icons.Shield size={15} color="#4f46e5" />
          Active Session Scope
        </div>
        <div className="audit-scope-grid">
          <div className="audit-scope-item">
            <span className="audit-scope-label">Authenticated Role</span>
            <code className="audit-scope-value">{role}</code>
          </div>
          <div className="audit-scope-item">
            <span className="audit-scope-label">Permitted Tenant</span>
            <code className="audit-scope-value">{current.tenant}</code>
          </div>
          <div className="audit-scope-item">
            <span className="audit-scope-label">Organisation</span>
            <span className="audit-scope-value" style={{ fontFamily: 'inherit', fontWeight: 500 }}>{current.name}</span>
          </div>
          <div className="audit-scope-item">
            <span className="audit-scope-label">Isolation Control</span>
            <span className="audit-scope-value" style={{ fontFamily: 'inherit', color: '#10b981', fontWeight: 600 }}>
              Secure Views + RBAC ✓
            </span>
          </div>
        </div>
      </div>

      {/* ── Query runner ── */}
      <div className="audit-query-card">
        <div className="audit-query-header">
          <div>
            <div className="audit-query-title">API Request Runner</div>
            <div className="audit-query-desc">
              Execute a request against any tenant endpoint. Requests outside your permitted scope will be rejected by the server.
            </div>
          </div>
        </div>

        <div className="audit-query-row">
          {/* Method pill */}
          <span className="audit-method-pill">GET</span>

          {/* Endpoint selector */}
          <select
            className="audit-select"
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
          >
            <option value="/api/kpis">/api/kpis</option>
            <option value="/api/orders">/api/orders</option>
          </select>

          {/* Tenant selector */}
          <span className="audit-query-sep">?tenant=</span>
          <select
            className="audit-select"
            value={targetTenant}
            onChange={e => setTargetTenant(e.target.value)}
          >
            {TENANTS.map(t => (
              <option key={t.tenant} value={t.tenant}>
                {t.tenant} — {t.name}
              </option>
            ))}
          </select>

          {/* Run button */}
          <button
            className="audit-run-btn"
            onClick={handleRunQuery}
            disabled={busy}
          >
            {busy
              ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.25)' }} />
              : <Icons.ArrowRight size={14} color="#fff" />
            }
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>

        {/* X-Role header indicator */}
        <div className="audit-header-preview">
          <span className="audit-header-label">Request header:</span>
          <code>X-Role: {role}</code>
          {targetTenant !== current.tenant && (
            <span className="audit-mismatch-pill">⚠ tenant mismatch — expect 403</span>
          )}
        </div>

        {/* Live response box */}
        {lastResult && (
          <div className={`audit-response-box ${lastResult.status === 200 ? 'success' : lastResult.status === 403 ? 'forbidden' : 'error'}`}>
            <div className="audit-response-title">
              {lastResult.status === 200 && <Icons.Package size={15} color="#166534" />}
              {lastResult.status === 403 && <Icons.Shield size={15} color="#991b1b" />}
              {lastResult.status !== 200 && lastResult.status !== 403 && <Icons.AlertTriangle size={15} color="#92400e" />}
              <span>
                {lastResult.status === 200 && `200 OK — Request Authorized (${lastResult.latencyMs}ms)`}
                {lastResult.status === 403 && `403 Forbidden — Blocked by Tenant Isolation Policy (${lastResult.latencyMs}ms)`}
                {lastResult.status === 0 && `Network Error — Could not reach backend`}
                {lastResult.status > 0 && lastResult.status !== 200 && lastResult.status !== 403 && `HTTP ${lastResult.status} (${lastResult.latencyMs}ms)`}
              </span>
            </div>
            {lastResult.data && (
              <pre className="audit-response-json">
                {typeof lastResult.data === 'string' ? lastResult.data : JSON.stringify(lastResult.data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Audit log table ── */}
      <div>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <span className="section-title">Access Log</span>
          <span className="section-count">{auditLog.length} event{auditLog.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="table-wrapper">
          {auditLog.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 24px' }}>
              <Icons.Shield size={36} color="#94a3b8" />
              <p>No requests yet. Use the runner above to generate access events.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Endpoint</th>
                  <th>Tenant</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {[...auditLog].reverse().map((entry, i) => (
                  <tr key={i}>
                    <td className="monospace" style={{ color: '#64748b', fontSize: 12 }}>{entry.time}</td>
                    <td className="monospace" style={{ fontSize: 12 }}>{entry.endpoint}</td>
                    <td>
                      <span className={`channel-badge ${entry.tenant === current.tenant ? 'online' : 'retail'}`}>
                        {entry.tenant}
                      </span>
                    </td>
                    <td className="monospace" style={{ fontSize: 12 }}>{entry.role}</td>
                    <td>
                      {entry.status === 200 && (
                        <span className="audit-status-badge ok">200 OK</span>
                      )}
                      {entry.status === 403 && (
                        <span className="audit-status-badge forbidden" title="Tenant isolation policy rejected this request">403 Forbidden</span>
                      )}
                      {entry.status !== 200 && entry.status !== 403 && entry.status > 0 && (
                        <span className="audit-status-badge other">{entry.status}</span>
                      )}
                      {entry.status === 0 && (
                        <span className="audit-status-badge network-err" title="Backend unreachable — connection refused or CORS error">Network Error</span>
                      )}
                    </td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>{entry.latencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Status legend */}
        <div className="audit-legend">
          <span className="audit-legend-label">Legend:</span>
          <span className="audit-status-badge ok"          style={{ fontSize: 11 }}>200 OK</span>
          <span className="audit-legend-desc">Request succeeded</span>
          <span className="audit-legend-sep" />
          <span className="audit-status-badge forbidden"   style={{ fontSize: 11 }}>403 Forbidden</span>
          <span className="audit-legend-desc">Blocked by tenant isolation policy</span>
          <span className="audit-legend-sep" />
          <span className="audit-status-badge network-err" style={{ fontSize: 11 }}>Network Error</span>
          <span className="audit-legend-desc">Backend unreachable — start the Spring Boot server on :8080</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Dashboard
───────────────────────────────────────────── */
function Dashboard({ role, onLogout }) {
  const [kpis,          setKpis]          = useState(null)
  const [orders,        setOrders]        = useState([])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [loadingOrderId,setLoadingOrderId]= useState(null)
  const [error,         setError]         = useState(null)
  const [activeTab,     setActiveTab]     = useState('dashboard')
  // Audit log: array of { time, endpoint, tenant, role, status, latencyMs }
  const [auditLog,      setAuditLog]      = useState([])

  const current = TENANTS.find(t => t.role === role)
  const other   = TENANTS.find(t => t.role !== role)

  /** Append an entry to the audit log */
  function logRequest(endpoint, tenant, status, latencyMs) {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setAuditLog(prev => [...prev, { time, endpoint, tenant, role, status, latencyMs }])
  }

  /* Load KPIs + orders on mount / role change */
  useEffect(() => {
    if (!role) return
    async function load() {
      setLoading(true)
      setError(null)
      setSelectedOrder(null)
      try {
        const headers = { 'X-Role': role }
        const t0 = Date.now()
        const [kpisRes, ordersRes] = await Promise.all([
          fetch(`${API}/kpis?tenant=${current.tenant}`,   { headers }),
          fetch(`${API}/orders?tenant=${current.tenant}`, { headers }),
        ])
        const ms = Date.now() - t0
        logRequest('/api/kpis',   current.tenant, kpisRes.status,   Math.round(ms * .6))
        logRequest('/api/orders', current.tenant, ordersRes.status, Math.round(ms * .4))
        if (!kpisRes.ok)   throw new Error(`Failed to load KPIs (HTTP ${kpisRes.status})`)
        if (!ordersRes.ok) throw new Error(`Failed to load orders (HTTP ${ordersRes.status})`)
        setKpis(await kpisRes.json())
        setOrders(await ordersRes.json())
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [role])

  /** Fetch individual order detail (with line items) */
  async function loadOrder(orderId) {
    if (selectedOrder && selectedOrder.orderId === orderId) {
      setSelectedOrder(null)
      return
    }
    setLoadingOrderId(orderId)
    const t0 = Date.now()
    try {
      const res = await fetch(`${API}/orders/${orderId}?tenant=${current.tenant}`, {
        headers: { 'X-Role': role },
      })
      logRequest(`/api/orders/${orderId}`, current.tenant, res.status, Date.now() - t0)
      if (!res.ok) throw new Error(`Failed to load order ${orderId} (HTTP ${res.status})`)
      setSelectedOrder(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingOrderId(null)
    }
  }

  /**
   * Run a query from the Audit Log page runner.
   * Uses the caller's chosen tenant + endpoint (may cross tenant boundaries).
   */
  async function runAuditQuery(targetTenant, endpoint) {
    // Prevent duplicate /api/api if endpoint already starts with /api
    const path = endpoint.startsWith('/api') ? endpoint : `${API}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
    const url = `${path}?tenant=${targetTenant}`
    const t0  = Date.now()
    try {
      const res = await fetch(url, { headers: { 'X-Role': role } })
      const ms = Date.now() - t0
      logRequest(endpoint, targetTenant, res.status, ms)
      let data = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      return { status: res.status, ok: res.ok, data, latencyMs: ms }
    } catch (err) {
      const ms = Date.now() - t0
      logRequest(endpoint, targetTenant, 0, ms)
      return { status: 0, ok: false, data: { error: err.message || 'Network error' }, latencyMs: ms }
    }
  }

  /* ── Sidebar items ── */
  const NAV = [
    { id: 'dashboard', label: 'Dashboard',  Icon: Icons.LayoutDashboard },
    { id: 'orders',    label: 'Orders',      Icon: Icons.ShoppingCart   },
    { id: 'audit',     label: 'Audit Log',   Icon: Icons.Shield         },
  ]

  return (
    <div className="dashboard">
      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="navbar-brand-icon">
            <Icons.DataVaultLogo size={18} />
          </div>
          <span className="navbar-brand-name">DataVault</span>
        </div>

        <div className="navbar-breadcrumb">
          <span>Tenants</span>
          <span className="navbar-breadcrumb-sep"><Icons.ChevronRight size={12} /></span>
          <span className="navbar-breadcrumb-current">{current.name}</span>
        </div>

        <div className="navbar-right">
          <span className={`navbar-avatar ${current.avatarClass}`}>{current.initials}</span>
          <span className="navbar-role-badge">{role}</span>
          <button className="navbar-signout" onClick={onLogout} aria-label="Sign out">
            <Icons.LogOut size={14} />
            Sign Out
          </button>
        </div>
      </nav>

      <div className="main-wrapper">
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-label">Navigation</div>
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sidebar-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={16} color={activeTab === id ? '#4f46e5' : '#64748b'} />
              {label}
              {/* Show live count badge on audit tab */}
              {id === 'audit' && auditLog.length > 0 && (
                <span className="sidebar-count">{auditLog.length}</span>
              )}
            </button>
          ))}
        </aside>

        {/* ── Main Content ── */}
        <main className="main-content">
          {error && (
            <Alert
              type="alert-error"
              icon={<Icons.XCircle size={18} color="#ef4444" />}
              title="Something went wrong"
            >
              {error}
            </Alert>
          )}

          {loading && <Spinner label={`Loading ${current.name} data…`} />}

          {!loading && (
            <>
              {/* Welcome banner — only on dashboard/orders */}
              {activeTab !== 'audit' && (
                <div className="welcome-banner">
                  <div className="welcome-text">
                    <h2>Welcome back, {current.name}</h2>
                    <p>Here's an overview of your analytics data.</p>
                  </div>
                  <div>
                    <span className="welcome-badge">
                      <span className={`tenant-avatar ${current.avatarClass}`}
                        style={{ width: 24, height: 24, fontSize: 10, display: 'inline-flex',
                                 alignItems: 'center', justifyContent: 'center',
                                 borderRadius: '50%', fontWeight: 700, color: '#fff' }}>
                        {current.initials}
                      </span>
                      {current.tenant}
                    </span>
                  </div>
                </div>
              )}

              {/* ── DASHBOARD TAB ── */}
              {activeTab === 'dashboard' && kpis && (
                <div className="kpi-grid">
                  <KpiCard label="Total Revenue"    value={fmtCurrency(kpis.totalRevenue)}                             icon={<Icons.DollarSign size={18} color="#4f46e5" />} iconClass="indigo" sub="Across all channels" />
                  <KpiCard label="Total Orders"     value={Number(kpis.totalOrders).toLocaleString('en-IN')}           icon={<Icons.Package    size={18} color="#10b981" />} iconClass="green"  sub="Completed orders"  />
                  <KpiCard label="Total Customers"  value={Number(kpis.totalCustomers).toLocaleString('en-IN')}        icon={<Icons.Users      size={18} color="#f59e0b" />} iconClass="amber"  sub="Unique customers"  />
                  <KpiCard label="Avg Order Value"  value={fmtCurrency(kpis.avgOrderValue)}                            icon={<Icons.TrendingUp size={18} color="#0ea5e9" />} iconClass="sky"    sub="Per transaction"   />
                </div>
              )}

              {/* ── ORDERS TABLE (dashboard + orders tab) ── */}
              {(activeTab === 'orders' || activeTab === 'dashboard') && (
                <>
                  <div className="section-header">
                    <span className="section-title">Orders</span>
                    <span className="section-count">{orders.length} records</span>
                  </div>
                  <OrdersTable
                    orders={orders}
                    selectedOrder={selectedOrder}
                    onRowClick={loadOrder}
                    loadingOrderId={loadingOrderId}
                  />
                </>
              )}

              {/* ── AUDIT LOG TAB ── */}
              {activeTab === 'audit' && (
                <AuditLogPage
                  current={current}
                  other={other}
                  role={role}
                  auditLog={auditLog}
                  onRunQuery={runAuditQuery}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Root App
───────────────────────────────────────────── */
export default function App() {
  const [role, setRole] = useState(null)

  function handleLogin(selectedRole) {
    setRole(selectedRole)
  }

  function handleLogout() {
    setRole(null)
  }

  if (!role) {
    return <LoginPage onLogin={handleLogin} />
  }

  return <Dashboard role={role} onLogout={handleLogout} />
}
