/* Sign-in uses organization-provisioned credentials. The server determines
 * the caller's role and tenant from the authenticated session. */
import { useState } from 'react'
import {
  Database, Eye, EyeOff, FileText, FlaskConical, KeyRound, Shield,
  ShieldCheck,
} from 'lucide-react'
import { apiLogin } from '../api'

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
      aria-label="Diagram: two separate tenant vaults on one shared Snowflake warehouse, with a barrier between them.">
      <rect x="8" y="8" width="544" height="234" rx="18" className="diagram-plate" />
      {/* shared warehouse base */}
      <rect x="20" y="196" width="520" height="40" rx="10" className="diagram-base" />
      <text x="280" y="221" textAnchor="middle" className="diagram-base-text">
        One shared Snowflake warehouse
      </text>
      {/* connectors from each vault down to the base */}
      <line x1="140" y1="168" x2="140" y2="196" className="diagram-link" />
      <line x1="420" y1="168" x2="420" y2="196" className="diagram-link" />
      {/* Steam vault */}
      <g>
        <rect x="40" y="48" width="200" height="120" rx="14" className="diagram-vault diagram-vault-steam" />
        <circle cx="140" cy="88" r="22" className="diagram-vault-disc diagram-vault-disc-steam" />
        <text x="140" y="96" textAnchor="middle" className="diagram-vault-initials">A</text>
        <text x="140" y="136" textAnchor="middle" className="diagram-vault-name">Tenant A</text>
        <text x="140" y="155" textAnchor="middle" className="diagram-vault-id">Isolated customer data</text>
      </g>
      {/* EA vault */}
      <g>
        <rect x="320" y="48" width="200" height="120" rx="14" className="diagram-vault diagram-vault-ea" />
        <circle cx="420" cy="88" r="22" className="diagram-vault-disc diagram-vault-disc-ea" />
        <text x="420" y="96" textAnchor="middle" className="diagram-vault-initials">B</text>
        <text x="420" y="136" textAnchor="middle" className="diagram-vault-name">Tenant B</text>
        <text x="420" y="155" textAnchor="middle" className="diagram-vault-id">Isolated customer data</text>
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

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
            {busy ? 'Signing in…' : (<><KeyRound size={15} /> Sign in</>)}
          </button>

          <p className="login-foot">
            <Shield size={13} /> Isolation is enforced by Snowflake secure views and roles — see Security &amp; Evidence after signing in.
          </p>
        </form>
      </div>
    </div>
  )
}
