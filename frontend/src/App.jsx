/**
 * DataVault — Multi-Tenant Analytics Platform
 * App shell: session (in memory only), Figma-style sidebar, tabs, evidence
 * drawer. No top bar — the sidebar carries the brand, the nav, the scope
 * note and the signed-in user, like the reference dashboard.
 *
 * Identity comes only from the server-side session token. The token lives in
 * React state — never localStorage, never the DOM. Every API call sends
 * Authorization: Bearer <token>. The browser never sends a role or, for
 * tenant calls, a tenant ID: the server derives both from the token.
 */
import { useState } from 'react'
import {
  Database, LayoutDashboard, LogOut, ShieldCheck, ShieldAlert, UserCog,
  Wallet, FlaskConical, CircleDot,
} from 'lucide-react'
import SignIn from './screens/SignIn.jsx'
import Dashboard from './screens/Dashboard.jsx'
import Evidence from './screens/Evidence.jsx'
import Support from './screens/Support.jsx'
import Usage from './screens/Usage.jsx'
import { apiLogout, fmtTime } from './api'
import { Drawer, StatusChip } from './components/ui'
import './index.css'

const TENANT_NAME = { STEAM: 'Steam Valve Corporation', EA: 'Electronic Arts', ALL: 'Platform Support' }

function roleLabel(role) {
  if (role === 'CAPSTONE_SUPPORT') return 'Platform Support'
  if (role === 'TENANT_A_ANALYST' || role === 'TENANT_B_ANALYST') return 'Tenant analyst'
  return role
}

function userInitials(username) {
  return (username || '?').split('_').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

export default function App() {
  const [session, setSession] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [lastEvidenceRun, setLastEvidenceRun] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loginNotice, setLoginNotice] = useState(null)
  const [forbidden, setForbidden] = useState(null)

  const isSupport = session && session.role === 'CAPSTONE_SUPPORT'

  function handleLogin(data) {
    setSession({ token: data.token, role: data.role, tenant: data.tenant, username: data.username })
    setTab(data.role === 'CAPSTONE_SUPPORT' ? 'support' : 'dashboard')
    setLoginNotice(null)
    setForbidden(null)
  }

  async function handleLogout() {
    if (session) {
      try { await apiLogout(session.token) } catch { /* best effort */ }
    }
    setSession(null)
    setTab('dashboard')
    setLastEvidenceRun(null)
    setDrawerOpen(false)
  }

  function handleSessionExpired() {
    setSession(null)
    setTab('dashboard')
    setLoginNotice('Your session expired. Please sign in again.')
  }

  function openTab(next) {
    if (next === 'support' && !isSupport) {
      setForbidden('The Support Console is for Platform Support staff. Your account is a tenant account, so this area is not available to it.')
      return
    }
    setForbidden(null)
    setTab(next)
  }

  if (!session) {
    return (
      <div>
        {loginNotice && (
          <div className="login-notice" role="alert">{loginNotice}</div>
        )}
        <SignIn onLogin={handleLogin} />
      </div>
    )
  }

  const tabs = [
    ...(isSupport ? [] : [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }]),
    { id: 'evidence', label: 'Security & Evidence', icon: FlaskConical },
    ...(isSupport ? [{ id: 'support', label: 'Support Console', icon: UserCog }] : []),
    { id: 'usage', label: 'Usage & Cost', icon: Wallet },
  ]

  return (
    <div className="app-shell">
      <div className="shell-body">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-mark"><Database size={18} /></span>
            <span className="brand-name">DataVault</span>
          </div>

          <nav className="sidebar-nav" aria-label="Main">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`nav-item ${tab === t.id ? 'nav-active' : ''}`}
                onClick={() => openTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                <t.icon size={17} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className="scope-card">
              <div className="scope-title"><ShieldCheck size={15} /> Your data scope</div>
              <div className="scope-body">
                {isSupport
                  ? 'Platform Support — no tenant data without an active, time-limited grant.'
                  : `${TENANT_NAME[session.tenant]} only.`}
              </div>
              <button type="button" className="scope-link" onClick={() => openTab('evidence')}>
                See the evidence →
              </button>
            </div>

            <div className="sidebar-foot">
              <ShieldAlert size={13} />
              <span>Isolation is enforced in Snowflake, not by this screen.</span>
            </div>

            <div className="sidebar-user">
              <span className="user-avatar">{userInitials(session.username)}</span>
              <div className="user-meta">
                <span className="user-name mono">{session.username}</span>
                <span className="user-role">{roleLabel(session.role)}</span>
              </div>
              <button type="button" className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          {forbidden ? (
            <div className="forbidden-page" role="alert">
              <ShieldAlert size={28} className="forbidden-icon" />
              <h1 className="forbidden-title">You can’t open this area</h1>
              <p className="forbidden-body">{forbidden}</p>
              <button type="button" className="btn btn-primary" onClick={() => { setForbidden(null); setTab(isSupport ? 'support' : 'dashboard') }}>
                Back to {isSupport ? 'Support Console' : 'Dashboard'}
              </button>
            </div>
          ) : tab === 'dashboard' ? (
            <Dashboard
              session={session}
              lastEvidenceRun={lastEvidenceRun}
              onOpenEvidence={() => setDrawerOpen(true)}
              onSessionExpired={handleSessionExpired}
            />
          ) : tab === 'evidence' ? (
            <Evidence
              session={session}
              lastRun={lastEvidenceRun}
              onRunComplete={setLastEvidenceRun}
              onSessionExpired={handleSessionExpired}
            />
          ) : tab === 'support' ? (
            <Support session={session} onSessionExpired={handleSessionExpired} />
          ) : (
            <Usage session={session} onSessionExpired={handleSessionExpired} />
          )}
        </main>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Isolation evidence">
        {!lastEvidenceRun ? (
          <div>
            <p className="drawer-text">
              No isolation test has run yet in this session. The chip on the Dashboard only claims
              “verified” after a run passes — run the suite on Security &amp; Evidence to produce it.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => { setDrawerOpen(false); setTab('evidence') }}>
              Go to Security &amp; Evidence
            </button>
          </div>
        ) : (
          <div>
            <div className="drawer-summary">
              <StatusChip tone={lastEvidenceRun.summary.failed > 0 ? 'danger' : 'success'}>
                {lastEvidenceRun.summary.failed > 0
                  ? `${lastEvidenceRun.summary.failed} of ${lastEvidenceRun.summary.total} failed`
                  : `${lastEvidenceRun.summary.passed} of ${lastEvidenceRun.summary.total} passed`}
              </StatusChip>
              <span className="drawer-meta">Last run {fmtTime(lastEvidenceRun.runAt)}</span>
            </div>
            <ul className="drawer-tests">
              {(lastEvidenceRun.tests || []).map((t) => (
                <li key={t.id}>
                  {t.pass === true ? <ShieldCheck size={15} className="ok" />
                    : t.pass === false ? <ShieldAlert size={15} className="bad" />
                    : <CircleDot size={15} className="muted" />}
                  <span>{t.name}</span>
                  <span className="drawer-test-result">{t.pass === true ? 'PASS' : t.pass === false ? 'FAIL' : 'SKIPPED'}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-secondary" onClick={() => { setDrawerOpen(false); setTab('evidence') }}>
              Open the full evidence screen
            </button>
          </div>
        )}
      </Drawer>
    </div>
  )
}
