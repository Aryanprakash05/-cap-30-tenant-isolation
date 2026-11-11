/* Sign-in screen.
 * Left: the product story — a tenant-boundary diagram (two sealed vaults on
 * one shared warehouse) and three plain-language value points. The decorative
 * orb is gone: it said nothing about the product.
 * Right: a plain sign-in form. The company is chosen with a segmented
 * control (Steam / EA) that fills both fields, so there is no pick-a-card
 * menu. Staff sign-in is a quiet link under the form, never a peer tile:
 * it opens a staff notice with a way back. Demo accounts are one quiet
 * footer line, not a panel. Passwords are filled, never shown as text.
 * Real deployments use SSO.
 */
import { useState } from 'react'
import {
  Database, Eye, EyeOff, FileText, FlaskConical,
  KeyRound, Shield, ShieldCheck, UserCog,
} from 'lucide-react'
import { apiLogin } from '../api'

/* Demo-only credentials. They exist so an evaluator can sign in with one
 * click; they are not real authentication and are never rendered as text.
 * The same values are the demo identities in the backend's AuthService. */
const PRINCIPALS = [
  {
    key: 'steam', role: 'TENANT_A_ANALYST', tenant: 'STEAM',
    name: 'Steam Valve Corporation', short: 'Steam', initials: 'SV',
    accent: 'steam', username: 'steam_analyst', password: 'SteamVault@2024',
    blurb: 'Valves and flow-control equipment',
  },
  {
    key: 'ea', role: 'TENANT_B_ANALYST', tenant: 'EA',
    name: 'Electronic Arts', short: 'EA', initials: 'EA',
    accent: 'ea', username: 'ea_analyst', password: 'EAVault@2024',
    blurb: 'Games and interactive entertainment',
  },
  {
    key: 'support', role: 'CAPSTONE_SUPPORT', tenant: 'ALL',
    name: 'Platform Support', short: 'Support', initials: 'SU',
    accent: 'support', username: 'support_user', password: 'SupportVault@2024',
    blurb: 'DataVault staff — time-limited, audited access',
  },
]

const VALUE_POINTS = [
  {
    icon: ShieldCheck, title: 'Your data stays yours',
    body: 'Each customer sees only its own sales. The other tenant’s rows are not hidden — they are unreachable.',
  },
  {
    icon: FileText, title: 'Every access is logged',
    body: 'Support access needs a ticket reason and an expiry, and every grant is written to an audit log.',
  },
  {
    icon: FlaskConical, title: 'Verified by direct database tests',
    body: 'Isolation is proven with SQL that bypasses this screen, not just promised by it.',
  },
]

/* Two sealed vaults on one shared warehouse, with a barrier between them. */
function BoundaryDiagram() {
  return (
    <svg viewBox="0 0 560 250" className="boundary-diagram" role="img"
      aria-label="Diagram: two separate customer vaults, Steam Valve Corporation and Electronic Arts, on one shared Snowflake warehouse, with a barrier between them.">
      {/* shared warehouse base */}
      <rect x="20" y="196" width="520" height="40" rx="10" className="diagram-base" />
      <text x="280" y="221" textAnchor="middle" className="diagram-base-text">
        One shared Snowflake warehouse — CAPSTONE_WH
      </text>
      {/* connectors from each vault down to the base */}
      <line x1="140" y1="168" x2="140" y2="196" className="diagram-link" />
      <line x1="420" y1="168" x2="420" y2="196" className="diagram-link" />
      {/* Steam vault */}
      <g>
        <rect x="40" y="48" width="200" height="120" rx="14" className="diagram-vault diagram-vault-steam" />
        <circle cx="140" cy="88" r="22" className="diagram-vault-disc diagram-vault-disc-steam" />
        <text x="140" y="96" textAnchor="middle" className="diagram-vault-initials">SV</text>
        <text x="140" y="136" textAnchor="middle" className="diagram-vault-name">Steam Valve Corporation</text>
        <text x="140" y="155" textAnchor="middle" className="diagram-vault-id">STEAM · 20 customers · 200 orders</text>
      </g>
      {/* EA vault */}
      <g>
        <rect x="320" y="48" width="200" height="120" rx="14" className="diagram-vault diagram-vault-ea" />
        <circle cx="420" cy="88" r="22" className="diagram-vault-disc diagram-vault-disc-ea" />
        <text x="420" y="96" textAnchor="middle" className="diagram-vault-initials">EA</text>
        <text x="420" y="136" textAnchor="middle" className="diagram-vault-name">Electronic Arts</text>
        <text x="420" y="155" textAnchor="middle" className="diagram-vault-id">EA · 20 customers · 200 orders</text>
      </g>
      {/* barrier wall between the vaults */}
      <g>
        <rect x="262" y="28" width="36" height="160" rx="8" className="diagram-wall" />
        <circle cx="280" cy="72" r="14" className="diagram-wall-disc" />
        <text x="280" y="77" textAnchor="middle" className="diagram-wall-lock">✕</text>
        <text x="280" y="118" textAnchor="middle" className="diagram-wall-text">NO</text>
        <text x="280" y="134" textAnchor="middle" className="diagram-wall-text">CROSS</text>
        <text x="280" y="150" textAnchor="middle" className="diagram-wall-text">READS</text>
      </g>
    </svg>
  )
}

export default function SignIn({ onLogin }) {
  const [selected, setSelected] = useState(PRINCIPALS[0])
  const [username, setUsername] = useState(PRINCIPALS[0].username)
  const [password, setPassword] = useState(PRINCIPALS[0].password)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isStaff = selected.key === 'support'

  /* Choosing a company fills both fields, password included and masked —
   * that is the one-click demo sign-in. Passwords are never rendered. */
  function pick(p) {
    setSelected(p)
    setUsername(p.username)
    setPassword(p.password)
    setError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setBusy(true)
    const r = await apiLogin(username.trim(), password)
    setBusy(false)
    if (!r.ok) {
      setError(r.status === 401
        ? 'Those credentials were not recognised. Check the username and password and try again.'
        : r.error)
      return
    }
    onLogin(r.data)
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="login-brand">
          <span className="brand-mark"><Database size={20} /></span>
          <span className="brand-name">DataVault</span>
          <span className="brand-tag">Enterprise</span>
        </div>
        <h1 className="login-headline">One warehouse.<br />Zero cross-tenant reads.</h1>
        <p className="login-sub">
          DataVault serves several customer companies from a single Snowflake
          warehouse. Each customer sees only its own sales data — enforced
          inside the database, not by this screen.
        </p>
        <BoundaryDiagram />
        <ul className="value-points">
          {VALUE_POINTS.map((v) => (
            <li key={v.title}>
              <v.icon size={18} className="value-icon" />
              <div>
                <div className="value-title">{v.title}</div>
                <div className="value-body">{v.body}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="login-form-wrap">
        <form className="card login-card" onSubmit={submit}>
          <h2 className="login-title">Sign in to DataVault</h2>
          <p className="login-caption">Your workspace is scoped to your company at sign-in.</p>

          {isStaff ? (
            <>
              <div className="staff-notice">
                <UserCog size={16} className="staff-icon" />
                <div>
                  <div className="staff-name">Staff sign-in — Platform Support</div>
                  <div className="staff-note">Staff access is time-limited and audited. Support is not a customer.</div>
                </div>
              </div>
              <button type="button" className="link-btn" onClick={() => pick(PRINCIPALS[0])}>
                ← Back to tenant sign-in
              </button>
            </>
          ) : (
            <>
              <div className="segmented" role="group" aria-label="Choose your company">
                {PRINCIPALS.filter((p) => p.key !== 'support').map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={selected.key === p.key}
                    onClick={() => pick(p)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <p className="segmented-blurb">{selected.blurb}</p>
            </>
          )}

          <div className="form-field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="username"
            />
          </div>
          <div className="form-field">
            <label htmlFor="login-password">Password</label>
            <div className="password-wrap">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="password"
              />
              <button
                type="button"
                className="icon-btn password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : (<><KeyRound size={15} /> Sign in{isStaff ? ' as staff' : ''}</>)}
          </button>

          {!isStaff && (
            <div className="staff-link-row">
              <button type="button" className="link-btn" onClick={() => pick(PRINCIPALS[2])}>
                <UserCog size={14} /> Platform Support staff? Sign in as staff
              </button>
            </div>
          )}

          <p className="demo-note">
            Demo accounts (evaluation only) — steam_analyst · ea_analyst · support_user.
            Choosing a company fills the password, never shown. Real deployments use SSO.
          </p>

          <p className="login-foot">
            <Shield size={13} /> Isolation is enforced by Snowflake secure views and roles — see Security &amp; Evidence after signing in.
          </p>
        </form>
      </div>
    </div>
  )
}
