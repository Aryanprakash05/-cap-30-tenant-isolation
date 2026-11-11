/* Security & Evidence — the evaluation screen.
 * Who the database thinks you are, the server-side isolation test suite,
 * a "Try to break it" panel that shows Expected vs Actual only AFTER the
 * call, the request runner, recorded direct-SQL proof, and the exact SQL a
 * reviewer can paste into a worksheet to repeat the proof.
 * Nothing here claims security the backend does not enforce: every
 * statement links to a test result or a query ID on this screen.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, FlaskConical, Play, ShieldAlert, XCircle } from 'lucide-react'
import { apiRequest, fmtTime } from '../api'
import { CopyButton, ErrorState, SectionCard, StatusChip } from '../components/ui'

const OTHER_TENANT = { STEAM: 'EA', EA: 'STEAM' }
const TENANT_NAME = { STEAM: 'Steam Valve Corporation', EA: 'Electronic Arts' }

const RUNNER_ENDPOINTS = [
  { value: '/api/kpis', label: '/api/kpis', sql: (t) => `SELECT * FROM ANALYTICS.V_KPIS WHERE TENANT_ID = '${t}';` },
  { value: '/api/orders', label: '/api/orders', sql: (t) => `SELECT * FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = '${t}' ORDER BY ORDER_DATE DESC LIMIT 100;` },
  { value: '/api/analytics/summary', label: '/api/analytics/summary', sql: (t) => `SELECT * FROM ANALYTICS.V_KPIS WHERE TENANT_ID = '${t}';  -- summary is built from V_ORDER_LINE + V_ORDERS + V_PRODUCT` },
]

const REPEATABLE_SQL = [
  {
    title: 'Tenant A — own data, then the denial',
    sql: `-- Sign in to Snowsight as TENANT_A_USER\nUSE ROLE TENANT_A_ANALYST;\nUSE SECONDARY ROLES NONE;\nSELECT * FROM ANALYTICS.V_KPIS;\n-- Expect: 1 row, STEAM, 200 orders, 20 customers, 656,950.40\nSELECT COUNT(*) FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'EA';\n-- Expect: 0\nSELECT COUNT(*) FROM TENANT_DATA.CUSTOMER;\n-- Expect: denied — "Schema 'CAPSTONE_DB.TENANT_DATA' does not exist or not authorized"`,
  },
  {
    title: 'Tenant B — the mirror image',
    sql: `-- Sign in to Snowsight as TENANT_B_USER\nUSE ROLE TENANT_B_ANALYST;\nUSE SECONDARY ROLES NONE;\nSELECT * FROM ANALYTICS.V_KPIS;\n-- Expect: 1 row, EA, 200 orders, 20 customers, 854,522.10\nSELECT COUNT(*) FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'STEAM';\n-- Expect: 0\nSELECT COUNT(*) FROM TENANT_DATA.CUSTOMER;\n-- Expect: denied`,
  },
  {
    title: 'Support — locked without a grant, open with one',
    sql: `-- Sign in to Snowsight as SUPPORT_USER\nUSE ROLE CAPSTONE_SUPPORT;\nUSE SECONDARY ROLES NONE;\nSELECT COUNT(*) FROM ANALYTICS.V_CUSTOMER;\n-- Expect: 0 (no active grant — fail-closed)\nCALL TENANT_DATA.SP_SUPPORT_GRANT('Investigating ticket #INC-8921 for STEAM', 'STEAM', 30);\nSELECT COUNT(*) FROM ANALYTICS.V_CUSTOMER;\n-- Expect: 20 (STEAM only)\nSELECT * FROM ANALYTICS.V_SUPPORT_CUSTOMER;\n-- Expect: 20 rows, customer names masked as "A*** [REDACTED PII]"`,
  },
]

export default function Evidence({ session, lastRun, onRunComplete, onSessionExpired }) {
  const isSupport = session.role === 'CAPSTONE_SUPPORT'
  const ownTenant = session.tenant
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [grantTenants, setGrantTenants] = useState(null)

  // Support's active grants, so the runner's expected result is honest.
  useEffect(() => {
    if (!isSupport) return
    let cancelled = false
    apiRequest(session.token, '/support/status').then((r) => {
      if (cancelled || !r.ok || !Array.isArray(r.data)) return
      setGrantTenants(r.data.filter((g) => g.isActive).map((g) => g.grantedTenant))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function inScope(tenant) {
    if (isSupport) {
      if (!grantTenants) return null // unknown yet
      return grantTenants.includes('ALL') || grantTenants.includes(tenant)
    }
    return tenant === ownTenant
  }

  async function runSuite() {
    setRunning(true)
    setRunError(null)
    const t0 = Date.now()
    const r = await apiRequest(session.token, '/evidence/run', { method: 'POST', body: {} })
    setRunning(false)
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setRunError(`${r.error} (after ${Math.round((Date.now() - t0) / 1000)}s)`); return }
    onRunComplete(r.data)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Security &amp; Evidence</h1>
          <p className="page-subtitle">
            Isolation is enforced in Snowflake, not in this UI. Every claim below links to a test result or a query ID.
          </p>
        </div>
      </header>

      <div className="evidence-grid">
        <SectionCard title="Who am I to the database">
          <dl className="whoami">
            <div><dt>Signed in as</dt><dd className="mono">{session.username}</dd></div>
            <div><dt>Snowflake role</dt><dd className="mono">{session.role}</dd></div>
            <div><dt>Data scope</dt><dd>{isSupport ? 'Platform Support — no tenant data without an active grant' : `${TENANT_NAME[ownTenant]} (${ownTenant}) only`}</dd></div>
            <div><dt>Enforcement</dt><dd>Secure views + role-to-tenant map, checked on every query</dd></div>
          </dl>
        </SectionCard>

        <SectionCard
          title="Isolation tests"
          action={(
            <button type="button" className="btn btn-primary" onClick={runSuite} disabled={running}>
              <FlaskConical size={15} /> {running ? 'Running…' : 'Run isolation tests'}
            </button>
          )}
        >
          {runError && <ErrorState title="The test run failed" body={runError} onRetry={runSuite} />}
          {running && (
            <div className="run-progress">
              <span className="spinner" aria-hidden="true" />
              Running 10 checks against Snowflake as TENANT_A_USER, TENANT_B_USER and SUPPORT_USER…
            </div>
          )}
          {!running && !lastRun && !runError && (
            <p className="muted-line">No test run yet this session. Run the suite for fresh, query-level evidence — the recorded proof below is from the last verified run.</p>
          )}
          {!running && lastRun && !runError && (
            <p className="muted-line">
              {lastRun.summary.failed > 0
                ? `${lastRun.summary.failed} of ${lastRun.summary.total} checks failed`
                : `${lastRun.summary.passed} of ${lastRun.summary.total} checks passed`}
              {' '}· Ran {fmtTime(lastRun.runAt)}{lastRun.summary.skipped > 0 ? ` · ${lastRun.summary.skipped} skipped` : ''}. Full results below.
            </p>
          )}
        </SectionCard>
      </div>

      {lastRun && (
        <SectionCard title="Test results">
          <EvidenceResults run={lastRun} />
        </SectionCard>
      )}

      <TryToBreakIt session={session} inScope={inScope} onSessionExpired={onSessionExpired} />

      <RequestRunner session={session} inScope={inScope} onSessionExpired={onSessionExpired} />

      <SectionCard title="Recorded direct-SQL proof">
        <p className="muted-line" style={{ marginBottom: 12 }}>From sql/04_isolation_proof.sql, run in Snowsight on 11 Nov 2026. Recorded evidence — not a live call.</p>
        <div className="proof-rows">
          <div className="proof-row">
            <StatusChip tone="success">PASS</StatusChip>
            <div>
              <div className="proof-name">Base-table read denied as TENANT_A_USER</div>
              <div className="mono proof-sql">SELECT COUNT(*) FROM TENANT_DATA.CUSTOMER;</div>
              <div className="proof-actual">“Schema ‘CAPSTONE_DB.TENANT_DATA’ does not exist or not authorized.”</div>
            </div>
          </div>
          <div className="proof-row">
            <StatusChip tone="success">PASS</StatusChip>
            <div>
              <div className="proof-name">Cross-tenant read returns 0 rows as TENANT_A_USER</div>
              <div className="mono proof-sql">SELECT COUNT(*) FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'EA';</div>
              <div className="proof-actual">0 rows. The same check as TENANT_B_USER against STEAM also returned 0.</div>
            </div>
          </div>
          <div className="proof-row">
            <StatusChip tone="success">PASS</StatusChip>
            <div>
              <div className="proof-name">Support sees 0 rows before a grant, 20 masked rows after one</div>
              <div className="mono proof-sql">CALL TENANT_DATA.SP_SUPPORT_GRANT('Investigating order discrepancy ticket #INC-8921 for STEAM tenant', 'STEAM', 30);</div>
              <div className="proof-actual">Before: 0 rows. After: STEAM 20, EA 0; names masked as “A*** [REDACTED PII]”. Logged as SUPPORT_ACCESS_LOG row 101.</div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Repeat the proof yourself">
        {REPEATABLE_SQL.map((b) => (
          <div key={b.title} className="sql-block">
            <div className="sql-block-head">
              <span className="sql-block-title">{b.title}</span>
              <CopyButton text={b.sql} label="Copy SQL" />
            </div>
            <pre className="sql-pre">{b.sql}</pre>
          </div>
        ))}
      </SectionCard>
    </div>
  )
}

function EvidenceResults({ run }) {
  const s = run.summary || {}
  return (
    <div>
      <div className="run-summary">
        <StatusChip tone={s.failed > 0 ? 'danger' : 'success'}>
          {s.failed > 0 ? `${s.failed} of ${s.total} failed` : `${s.passed} of ${s.total} passed`}
        </StatusChip>
        <span className="run-meta">Ran {fmtTime(run.runAt)}{s.skipped > 0 ? ` · ${s.skipped} skipped` : ''}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table evidence-table">
          <thead>
            <tr><th>Test</th><th>Expected</th><th>Actual</th><th>Result</th><th className="num">Rows</th><th>HTTP</th><th>Query ID</th><th>Time</th></tr>
          </thead>
          <tbody>
            {(run.tests || []).map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="muted">{t.expected}</td>
                <td>{t.actual}</td>
                <td>
                  {t.pass === true && <StatusChip tone="success">PASS</StatusChip>}
                  {t.pass === false && <StatusChip tone="danger">FAIL</StatusChip>}
                  {t.pass === null && <StatusChip tone="neutral">SKIPPED</StatusChip>}
                </td>
                <td className="num tabular">{t.rowCount ?? '—'}</td>
                <td className="num tabular">{t.httpStatus ?? '—'}</td>
                <td>
                  {t.queryId
                    ? <span className="mono qid" title={t.queryId}>{t.queryId.slice(0, 8)}… <CopyButton text={t.queryId} label="" className="copy-inline" /></span>
                    : <span className="muted">—</span>}
                </td>
                <td className="muted">{fmtTime(t.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine-print">
        Query IDs are Snowflake statement IDs — paste one into QUERY_HISTORY to see the exact SQL the database ran.
        A denied test has no Snowflake query: the database refused the statement before running it.
      </p>
    </div>
  )
}

/* The hero moment: attempt to read the other tenant's data and show the real
 * result. Expected vs Actual appear only AFTER the call, with PASS/FAIL. */
function TryToBreakIt({ session, inScope, onSessionExpired }) {
  const isSupport = session.role === 'CAPSTONE_SUPPORT'
  const target = isSupport ? 'STEAM' : OTHER_TENANT[session.tenant]
  const [attempt, setAttempt] = useState(null)
  const [busy, setBusy] = useState(false)

  const sql = `SELECT * FROM ANALYTICS.V_KPIS WHERE TENANT_ID = '${target}';`

  async function runAttempt(which) {
    setBusy(true)
    setAttempt(null)
    const t0 = Date.now()
    const path = which === 'kpis' ? `/api/kpis?tenant=${target}` : `/api/orders?tenant=${target}`
    const r = await apiRequest(session.token, path)
    const ms = Date.now() - t0
    setBusy(false)
    if (r.status === 401) { onSessionExpired(); return }
    const expected = 403
    const pass = r.status === 403
    setAttempt({
      which, ms, status: r.status, queryId: r.queryId,
      expected, pass,
      actual: r.ok
        ? `Returned ${r.status} with data — isolation broken`
        : `HTTP ${r.status}: ${r.error}`,
    })
  }

  return (
    <SectionCard title="Try to break it">
      <div className="breakit">
        <div className="breakit-sql">
          <div className="breakit-label">
            Signed in as {isSupport ? 'support with no grant in scope' : TENANT_NAME[session.tenant]} — reading {TENANT_NAME[target]} ({target}) data:
          </div>
          <pre className="sql-pre">{sql}</pre>
          <div className="breakit-note">
            The API refuses the request before Snowflake runs a query.
          </div>
        </div>
        <div className="breakit-actions">
          <button type="button" className="btn btn-danger-outline" onClick={() => runAttempt('kpis')} disabled={busy}>
            <ShieldAlert size={15} /> {busy ? 'Attempting…' : `Read ${target} KPIs`}
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={() => runAttempt('orders')} disabled={busy}>
            <ShieldAlert size={15} /> {busy ? 'Attempting…' : `Read ${target} orders`}
          </button>
        </div>
        {attempt && (
          <div>
            <div className="verdict-line">
              {attempt.pass
                ? <CheckCircle2 size={16} className="ok" />
                : <XCircle size={16} className="bad" />}
              <span>
                <strong>{attempt.pass ? 'PASS — denied as expected' : 'FAIL — not denied'}</strong>
                {' '}· HTTP {attempt.status} · {attempt.ms} ms{attempt.queryId ? ` · Query ${attempt.queryId.slice(0, 8)}…` : ' · No Snowflake query was issued'}
              </span>
            </div>
            <dl className="attempt-rows">
              <div><dt>Expected</dt><dd>HTTP 403 — this role may not read {target}</dd></div>
              <div><dt>Actual</dt><dd>{attempt.actual}</dd></div>
            </dl>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function RequestRunner({ session, inScope, onSessionExpired }) {
  const isSupport = session.role === 'CAPSTONE_SUPPORT'
  const tenants = isSupport ? ['STEAM', 'EA'] : [session.tenant, OTHER_TENANT[session.tenant]]
  const [endpoint, setEndpoint] = useState(RUNNER_ENDPOINTS[0].value)
  const [tenant, setTenant] = useState(tenants[0])
  const [tab, setTab] = useState('response')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])

  async function execute() {
    setBusy(true)
    const t0 = Date.now()
    const r = await apiRequest(session.token, `${endpoint}?tenant=${tenant}`)
    const ms = Date.now() - t0
    setBusy(false)
    if (r.status === 401) { onSessionExpired(); return }
    const scope = inScope(tenant)
    const expected = scope === null ? 'unknown (grant state loading)' : scope ? 200 : 403
    const pass = typeof expected === 'number' ? r.status === expected : null
    const entry = {
      endpoint, tenant, status: r.status, ms, queryId: r.queryId,
      expected, pass, time: new Date().toISOString(),
      body: r.data, error: r.error,
    }
    setResult(entry)
    setLog((l) => [entry, ...l].slice(0, 20))
  }

  const ep = RUNNER_ENDPOINTS.find((e) => e.value === endpoint)
  const curl = `curl -H "Authorization: Bearer <session-token>" \\\n  "http://localhost:8080${endpoint}?tenant=${tenant}"`

  return (
    <SectionCard title="Request runner">
      <div className="runner-form">
        <label className="form-field">
          <span>Endpoint</span>
          <select value={endpoint} onChange={(e) => setEndpoint(e.target.value)}>
            {RUNNER_ENDPOINTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>Target tenant</span>
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((t) => <option key={t} value={t}>{t} — {TENANT_NAME[t]}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={execute} disabled={busy}>
          <Play size={15} /> {busy ? 'Running…' : 'Execute'}
        </button>
      </div>

      {result && (
        <div className="runner-result">
          <div className="runner-verdict">
            <StatusChip tone={result.pass === true ? 'success' : result.pass === false ? 'danger' : 'neutral'}>
              {result.pass === true ? 'PASS' : result.pass === false ? 'FAIL' : 'NO EXPECTATION'}
            </StatusChip>
            <span className="runner-meta">
              Expected HTTP {result.expected} · Actual HTTP {result.status} · {result.ms} ms
              {result.queryId ? ` · Snowflake query ${result.queryId.slice(0, 8)}…` : ' · No Snowflake query was issued'}
            </span>
          </div>
          <div className="tabs" role="tablist">
            {['response', 'curl', 'sql'].map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t}
                className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}>
                {t === 'response' ? 'Response' : t === 'curl' ? 'cURL' : 'SQL'}
              </button>
            ))}
          </div>
          {tab === 'response' && (
            <pre className="sql-pre">{JSON.stringify(result.body ?? { error: result.error }, null, 2)}</pre>
          )}
          {tab === 'curl' && (
            <div>
              <pre className="sql-pre">{curl}</pre>
              <p className="fine-print">The token is shown truncated: the real request sends the full session token. No role is sent — the server derives it from the token.</p>
            </div>
          )}
          {tab === 'sql' && (
            <div>
              <pre className="sql-pre">{ep.sql(tenant)}</pre>
              <p className="fine-print">The SQL the API runs for this call, as the caller’s Snowflake role. A reviewer can run it in a worksheet to get the same result.</p>
            </div>
          )}
        </div>
      )}

      {log.length > 0 && (
        <div className="request-log">
          <div className="request-log-title">Request log</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Time</th><th>Endpoint</th><th>Tenant</th><th>Expected</th><th>Actual</th><th>Result</th><th>ms</th><th>Query ID</th></tr></thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={i}>
                    <td className="muted">{fmtTime(l.time)}</td>
                    <td className="mono">{l.endpoint}</td>
                    <td>{l.tenant}</td>
                    <td className="tabular">{l.expected}</td>
                    <td className="tabular">{l.status}</td>
                    <td>{l.pass === true ? <StatusChip tone="success">PASS</StatusChip> : l.pass === false ? <StatusChip tone="danger">FAIL</StatusChip> : <StatusChip tone="neutral">—</StatusChip>}</td>
                    <td className="num tabular">{l.ms}</td>
                    <td>{l.queryId ? <span className="mono qid" title={l.queryId}>{l.queryId.slice(0, 8)}…</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {log.length === 0 && (
        <p className="fine-print">No requests yet. Execute a call to see its response, its cURL form, and the SQL behind it.</p>
      )}
    </SectionCard>
  )
}
