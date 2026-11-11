/* Support Console.
 * Step 1: request access — tenant, ticket reason (10+ characters), duration.
 * Step 2: active-grant banner with a live countdown and "End access now".
 * Step 3: read-only data view of the granted tenant only. Customer names
 * are masked by the database view; customer ID, city, segment and order
 * data are visible. Before any grant the data view is locked, and the
 * screen proves it by calling the data endpoint and showing 0 rows.
 * Access history lists every grant with its computed status.
 */
import { useEffect, useRef, useState } from 'react'
import { KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { apiRequest, fmtTime } from '../api'
import OrdersExplorer from '../components/OrdersExplorer'
import { Banner, Countdown, EmptyState, ErrorState, SectionCard, Skeleton, StatusChip } from '../components/ui'
import DataTable from '../components/DataTable'

const DURATIONS = [15, 30, 60, 120, 480]
const TENANT_NAME = { STEAM: 'Steam Valve Corporation', EA: 'Electronic Arts', ALL: 'Both tenants' }

function statusTone(status) {
  if (status === 'active') return 'success'
  if (status === 'revoked') return 'purple'
  return 'neutral'
}

export default function Support({ session, onSessionExpired }) {
  const [statusRows, setStatusRows] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [customers, setCustomers] = useState(null)
  const [customersError, setCustomersError] = useState(null)
  const [lockProof, setLockProof] = useState(null)

  const [tenant, setTenant] = useState('STEAM')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState(30)
  const [formError, setFormError] = useState(null)
  const [grantMsg, setGrantMsg] = useState(null)
  const [grantBusy, setGrantBusy] = useState(false)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [expiredNotice, setExpiredNotice] = useState(false)
  const manualEndRef = useRef(false)

  const activeGrant = (statusRows || []).find((g) => g.isActive && !g.revokedAt)
  const grantedTenant = activeGrant ? (activeGrant.grantedTenant || activeGrant.tenantId) : null

  /* When the grant expires, the data view locks. The countdown calls
   * loadStatus when it hits zero, and a 30-second poll catches expiry even
   * if the tab was in the background. A manual "End access now" is not an
   * expiry, so it is tracked separately. */
  useEffect(() => {
    if (!activeGrant && customers !== null) {
      if (manualEndRef.current) { manualEndRef.current = false; return }
      setExpiredNotice(true)
      setCustomers(null)
      setLockProof(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGrant])

  useEffect(() => {
    const t = setInterval(() => { loadStatus() }, 30000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadStatus() {
    const r = await apiRequest(session.token, '/support/status')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setStatusError(r.error); return }
    setStatusRows(Array.isArray(r.data) ? r.data : [])
  }

  async function loadHistory() {
    const r = await apiRequest(session.token, '/support/history')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setHistoryError(r.error); return }
    setHistory(Array.isArray(r.data) ? r.data : [])
  }

  async function loadCustomers() {
    setCustomersError(null)
    const r = await apiRequest(session.token, '/support/customers')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setCustomersError(r.error); return }
    setCustomers(Array.isArray(r.data) ? r.data : [])
  }

  useEffect(() => { loadStatus(); loadHistory() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeGrant) loadCustomers() }, [activeGrant ? activeGrant.logId : null]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitGrant(e) {
    e.preventDefault()
    setFormError(null)
    setGrantMsg(null)
    if (!reason || reason.trim().length < 10) {
      setFormError('Give a reason of at least 10 characters — a ticket number and what you need to check. The reason is written to the audit log.')
      return
    }
    setGrantBusy(true)
    const r = await apiRequest(session.token, '/support/grant', {
      method: 'POST', body: { reason: reason.trim(), tenant, durationMinutes: duration },
    })
    setGrantBusy(false)
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setFormError(r.error); return }
    setGrantMsg(r.data && r.data.message ? r.data.message : 'Access granted.')
    setReason('')
    await loadStatus()
    await loadHistory()
  }

  async function revoke() {
    setRevokeBusy(true)
    manualEndRef.current = true
    const r = await apiRequest(session.token, '/support/revoke', { method: 'POST', body: {} })
    setRevokeBusy(false)
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { manualEndRef.current = false; setFormError(r.error); return }
    setGrantMsg(r.data && r.data.message ? r.data.message : 'Access ended.')
    setCustomers(null)
    setLockProof(null)
    setExpiredNotice(false)
    await loadStatus()
    await loadHistory()
  }

  /* Prove the lock: call the data endpoint without a grant and show the
   * real result — 0 rows — with its query ID. */
  async function proveLock() {
    setLockProof({ loading: true })
    const r = await apiRequest(session.token, '/support/customers')
    if (r.status === 401) { onSessionExpired(); return }
    setLockProof({
      loading: false,
      rows: Array.isArray(r.data) ? r.data.length : null,
      queryId: r.queryId,
      error: r.ok ? null : r.error,
    })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Support Console</h1>
        </div>
        <StatusChip tone="purple"><KeyRound size={13} /> Staff mode — CAPSTONE_SUPPORT</StatusChip>
      </header>

      {statusError && <ErrorState title="Grant status could not be loaded" body={statusError} onRetry={loadStatus} />}

      {activeGrant ? (
        <div className="card status-card">
          <span className="status-dot" />
          <span>
            <strong>Active grant — {TENANT_NAME[grantedTenant] || grantedTenant} in scope</strong>
            {' '}· {activeGrant.reason} · Expires {fmtTime(activeGrant.expiry)} · <Countdown expiry={activeGrant.expiry} onExpire={() => loadStatus()} />
          </span>
          <button type="button" className="btn btn-danger btn-sm" onClick={revoke} disabled={revokeBusy}>
            {revokeBusy ? 'Ending…' : 'End access now'}
          </button>
        </div>
      ) : (
        <div className="card status-card">
          <span className="status-dot status-dot-off" />
          <span><strong>No active grant — data locked.</strong> Request access below.</span>
        </div>
      )}

      {expiredNotice && (
        <Banner tone="danger" title="Access expired" onClose={() => setExpiredNotice(false)}>
          The grant reached its expiry time, so the data view locked. Request access again if the ticket still needs it.
        </Banner>
      )}

      {grantMsg && (
        <Banner tone="success" title="Done" onClose={() => setGrantMsg(null)}>{grantMsg}</Banner>
      )}

      <div className="support-grid">
        <SectionCard title="Request access">
          <form onSubmit={submitGrant}>
            <div className="form-field">
              <label htmlFor="grant-tenant">Tenant</label>
              <select id="grant-tenant" value={tenant} onChange={(e) => setTenant(e.target.value)}>
                <option value="STEAM">STEAM — Steam Valve Corporation</option>
                <option value="EA">EA — Electronic Arts</option>
                <option value="ALL">ALL — both tenants (use only when the ticket needs it)</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="grant-reason">Ticket / reason <span className="muted">(minimum 10 characters)</span></label>
              <textarea
                id="grant-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Investigating order discrepancy ticket #INC-8921 for STEAM tenant"
              />
              <div className="field-hint">{reason.trim().length}/10 characters minimum</div>
            </div>
            <div className="form-field">
              <label htmlFor="grant-duration">Duration</label>
              <select id="grant-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <button type="submit" className="btn btn-primary" disabled={grantBusy}>
              {grantBusy ? 'Requesting…' : 'Request access'}
            </button>
          </form>
        </SectionCard>

        <SectionCard title="Data in scope" subtitle="Read-only. Customer names are masked by the database view.">
          {!activeGrant ? (
            <div>
              <EmptyState
                title="No active grant: data locked"
                body="Request access first. Until then, the data endpoints return nothing for this account."
                action={(
                  <button type="button" className="btn btn-secondary" onClick={proveLock} disabled={lockProof && lockProof.loading}>
                    <Lock size={14} /> {lockProof && lockProof.loading ? 'Checking…' : 'Prove the lock'}
                  </button>
                )}
              />
              {lockProof && !lockProof.loading && (
                <div className="lock-proof">
                  {lockProof.error ? (
                    <span className="muted">Check failed: {lockProof.error}</span>
                  ) : (
                    <span>
                      <StatusChip tone="success">LOCKED</StatusChip>
                      {' '}The customers endpoint returned <strong>{lockProof.rows} rows</strong>
                      {lockProof.queryId ? <> · Snowflake query <span className="mono">{lockProof.queryId.slice(0, 8)}…</span></> : ' · no Snowflake query was needed'}.
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : customersError ? (
            <ErrorState title="Customers could not be loaded" body={customersError} onRetry={loadCustomers} />
          ) : customers === null ? (
            <div><Skeleton className="sk-line" /><Skeleton className="sk-line" /></div>
          ) : customers.length === 0 ? (
            <EmptyState title="No customers in scope" body="The grant is active but no customer rows came back. Check the grant tenant and try again." />
          ) : (
            <DataTable
              pageSize={10}
              columns={[
                { key: 'customerId', label: 'Customer ID' },
                { key: 'customerName', label: 'Customer name' },
                { key: 'city', label: 'City' },
                { key: 'region', label: 'Region' },
                { key: 'segment', label: 'Segment' },
              ]}
              rows={customers.map((c) => ({ ...c, key: `${c.tenantId}-${c.customerId}` }))}
            />
          )}
        </SectionCard>
      </div>

      {activeGrant && grantedTenant && grantedTenant !== 'ALL' && (
        <SectionCard title={`Orders for ${TENANT_NAME[grantedTenant]}`}>
          <OrdersExplorer token={session.token} tenant={grantedTenant} onSessionExpired={onSessionExpired} />
        </SectionCard>
      )}
      {activeGrant && grantedTenant === 'ALL' && (
        <Banner tone="info" title="Grant covers both tenants">
          This grant covers STEAM and EA. Pick a tenant in the request form next time when the ticket only needs one — least privilege is the point of the workflow.
        </Banner>
      )}

      <SectionCard title="Access history">
        {historyError ? (
          <ErrorState title="History could not be loaded" body={historyError} onRetry={loadHistory} />
        ) : history === null ? (
          <div><Skeleton className="sk-line" /><Skeleton className="sk-line" /></div>
        ) : history.length === 0 ? (
          <EmptyState title="No grants yet" body="Grants you request will appear here with their reason, time and status." />
        ) : (
          <DataTable
            pageSize={10}
            columns={[
              { key: 'accessedBy', label: 'Who' },
              { key: 'grantedTenant', label: 'Tenant' },
              { key: 'reason', label: 'Reason' },
              { key: 'accessedAt', label: 'Granted', render: (r) => fmtTime(r.accessedAt) },
              { key: 'expiry', label: 'Expires', render: (r) => fmtTime(r.expiry) },
              { key: 'durationMinutes', label: 'Duration', numeric: true, render: (r) => `${r.durationMinutes} min` },
              { key: 'status', label: 'Status', render: (r) => <StatusChip tone={statusTone(r.status)}>{r.status}</StatusChip> },
            ]}
            rows={history.map((h) => ({ ...h, key: h.logId }))}
          />
        )}
      </SectionCard>

      <p className="fine-print">
        <ShieldCheck size={13} /> The grant, the mask and the lock are enforced by the database procedure and the secure views — not by this page. Ending a grant sets its expiry to now, so the views stop returning rows immediately.
      </p>
    </div>
  )
}
