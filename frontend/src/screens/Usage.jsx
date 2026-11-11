/* Usage & Cost.
 * Queries run, compute seconds and estimated credits by tenant, role and
 * workload; warehouse credits by day; resource-monitor usage vs cap.
 * Credits are exact from WAREHOUSE_METERING_HISTORY; the dollar figure is
 * an estimate at the configured per-credit price. ACCOUNT_USAGE lags
 * 45 minutes to 3 hours. Staff-only sections: ingestion health and system
 * health.
 */
import { useEffect, useState } from 'react'
import { Activity, Database, Server } from 'lucide-react'
import { apiRequest, fmtNum, fmtUSD } from '../api'
import KpiCard from '../components/KpiCard'
import { BarChart } from '../components/Chart'
import { EmptyState, ErrorState, SectionCard, Skeleton, StatusChip } from '../components/ui'
import DataTable from '../components/DataTable'

export default function Usage({ session, onSessionExpired }) {
  const isStaff = session.role === 'CAPSTONE_SUPPORT'
  const [usage, setUsage] = useState(null)
  const [usageError, setUsageError] = useState(null)
  const [ingestion, setIngestion] = useState(null)
  const [ingestionError, setIngestionError] = useState(null)
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)

  async function loadUsage() {
    setUsageError(null)
    const r = await apiRequest(session.token, '/usage')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setUsageError(r.error); return }
    setUsage(r.data)
  }

  async function loadIngestion() {
    setIngestionError(null)
    const r = await apiRequest(session.token, '/ingestion')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setIngestionError(r.error); return }
    setIngestion(r.data)
  }

  async function loadHealth() {
    setHealthError(null)
    const r = await apiRequest(session.token, '/health')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setHealthError(r.error); return }
    setHealth(r.data)
  }

  useEffect(() => {
    loadUsage()
    if (isStaff) { loadIngestion(); loadHealth() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cost = usage && usage.cost ? usage.cost : null
  const tenants = cost && Array.isArray(cost.tenants) ? cost.tenants : []
  const ownBucket = !isStaff && session.tenant
    ? tenants.find((t) => t.tenant === session.tenant)
    : null
  const rm = usage && usage.resourceMonitor ? usage.resourceMonitor : null
  const daily = usage && Array.isArray(usage.daily) ? usage.daily : []
  const usageRows = usage && Array.isArray(usage.usage) ? usage.usage : []
  const rmPct = rm && rm.capCredits > 0 ? Math.min(100, (rm.usedCredits / rm.capCredits) * 100) : 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Usage &amp; Cost</h1>
        </div>
      </header>

      {usageError ? (
        <ErrorState title="Usage could not be loaded" body={usageError} onRetry={loadUsage} />
      ) : !usage ? (
        <div><Skeleton className="sk-line" /><Skeleton className="sk-line" /></div>
      ) : (
        <>
          <div className="kpi-row">
            <KpiCard
              label="Warehouse credits (7 days)" value={cost ? cost.totalCredits.toFixed(2) : '—'}
              sub="Metered credits for CAPSTONE_WH"
              tooltip="Total credits Snowflake billed for this warehouse in the last 7 days, from WAREHOUSE_METERING_HISTORY."
            />
            <KpiCard
              label="Estimated cost (7 days)" value={cost ? fmtUSD(tenants.reduce((s, t) => s + (t.estimatedCostUsd || 0), 0)) : '—'}
              sub={`At $${cost ? cost.pricePerCreditUsd : '—'} per credit (Standard, Thailand)`}
              tooltip="Credits multiplied by the per-credit price. An estimate — the credit counts are exact, the dollar rate is the list price."
            />
            <KpiCard
              label="Queries (7 days)" value={fmtNum(usageRows.reduce((s, r) => s + (r.queries || 0), 0))}
              sub="All roles and workloads"
              tooltip="Queries run on CAPSTONE_WH in the last 7 days, from QUERY_HISTORY."
            />
            <KpiCard
              label="Resource monitor" value={rm ? `${rm.usedCredits.toFixed(2)} / ${rm.capCredits} credits` : '—'}
              sub="CAPSTONE_RM — 10-credit quota"
              tooltip="The resource monitor caps the warehouse at 10 credits. Used credits are the metered total for the last 7 days."
            />
          </div>

          <div className="chart-grid split-21">
            <SectionCard title="Credits by day" action={<span className="section-meta">Last 7 days</span>}>
              {daily.length === 0 ? (
                <EmptyState title="No metering rows yet" body="Metering history appears after the warehouse has run. ACCOUNT_USAGE can lag a few hours." />
              ) : (
                <BarChart
                  data={daily.map((d) => ({ ...d, date: d.date.slice(5) }))}
                  xKey="date" yKey="credits" color="#276a3f"
                  formatY={(v) => v.toFixed(2)}
                />
              )}
            </SectionCard>
            {rm && (
              <SectionCard title="Resource monitor — CAPSTONE_RM">
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${rmPct}%` }} />
                </div>
                <div className="meter-labels">
                  <span>{rm.usedCredits.toFixed(2)} credits used (7 days)</span>
                  <span>{rm.capCredits} credit cap</span>
                </div>
              </SectionCard>
            )}
          </div>

          <div className="chart-grid">
            <SectionCard title="Cost by workload">
              {(isStaff ? tenants : (ownBucket ? [ownBucket] : [])).length === 0 ? (
                <EmptyState title="No cost data yet" body="No tagged query time in the last 7 days for this scope." />
              ) : (
                <DataTable
                  pageSize={10}
                  columns={[
                    { key: 'tenant', label: 'Workload' },
                    { key: 'queries', label: 'Queries', numeric: true },
                    { key: 'seconds', label: 'Seconds', numeric: true },
                    { key: 'sharePct', label: 'Share', numeric: true, render: (r) => `${r.sharePct}%` },
                    { key: 'credits', label: 'Credits', numeric: true },
                    { key: 'estimatedCostUsd', label: 'Est. cost', numeric: true, render: (r) => fmtUSD(r.estimatedCostUsd) },
                  ]}
                  rows={(isStaff ? tenants : [ownBucket]).map((t) => ({ ...t, key: t.tenant }))}
                />
              )}
              <p className="fine-print">
                SHARED is platform and admin work (tenant=MULTI). UNTAGGED is work without a query tag, such as Snowsight and test runners — shown so the split reconciles to the warehouse total.
              </p>
            </SectionCard>
            <SectionCard title="Usage by role and query tag">
            {usageRows.length === 0 ? (
              <EmptyState title="No queries in the window" body="QUERY_HISTORY has no rows for CAPSTONE_WH in the last 7 days." />
            ) : (
              <DataTable
                pageSize={10}
                columns={[
                  { key: 'roleName', label: 'Role' },
                  { key: 'queryTag', label: 'Query tag' },
                  { key: 'queries', label: 'Queries', numeric: true },
                  { key: 'totalSeconds', label: 'Seconds', numeric: true },
                ]}
                rows={usageRows.map((r, i) => ({ ...r, key: i }))}
              />
            )}
          </SectionCard>
          </div>

          <p className="fine-print">
            Credits from WAREHOUSE_METERING_HISTORY (7 days), split by share of tagged query time. Cost at ${cost ? cost.pricePerCreditUsd : '—'} per credit. ACCOUNT_USAGE lags up to 3 hours, so very recent queries may not appear yet.
          </p>
        </>
      )}

      {isStaff && (
        <>
          <SectionCard
            title="Ingestion health"
            action={<button type="button" className="btn btn-secondary btn-sm" onClick={loadIngestion}>Refresh</button>}
          >
            {ingestionError ? (
              <ErrorState title="Ingestion data could not be loaded" body={ingestionError} onRetry={loadIngestion} />
            ) : !ingestion ? (
              <div><Skeleton className="sk-line" /><Skeleton className="sk-line" /></div>
            ) : (
              <>
                {ingestion.totals && (
                  <div className="ingest-totals">
                    <span><strong>{ingestion.totals.filesLoaded}</strong> files loaded</span>
                    <span><strong>{fmtNum(ingestion.totals.rowsLoaded)}</strong> rows loaded</span>
                    <span><strong>{fmtNum(ingestion.totals.rowsRejected)}</strong> rows rejected</span>
                  </div>
                )}
                <DataTable
                  pageSize={10}
                  columns={[
                    { key: 'fileName', label: 'File' },
                    { key: 'tableName', label: 'Table' },
                    { key: 'rowsLoaded', label: 'Rows loaded', numeric: true },
                    { key: 'rowsRejected', label: 'Rows rejected', numeric: true },
                    { key: 'status', label: 'Status' },
                  ]}
                  rows={(ingestion.files || []).map((f) => ({ ...f, key: f.logId }))}
                />
                {(ingestion.errors || []).length > 0 && (
                  <>
                    <h3 className="subhead">Rejected rows</h3>
                    <DataTable
                      pageSize={10}
                      columns={[
                        { key: 'fileName', label: 'File' },
                        { key: 'rowText', label: 'Row' },
                        { key: 'errorText', label: 'Reason' },
                      ]}
                      rows={(ingestion.errors || []).map((e) => ({ ...e, key: e.errorId }))}
                    />
                  </>
                )}
              </>
            )}
          </SectionCard>

          <SectionCard
            title="System health"
            action={<button type="button" className="btn btn-secondary btn-sm" onClick={loadHealth}>Refresh</button>}
          >
            {healthError ? (
              <ErrorState title="Health check failed" body={healthError} onRetry={loadHealth} />
            ) : !health ? (
              <div><Skeleton className="sk-line" /></div>
            ) : (
              <ul className="health-list">
                <li>
                  <Server size={16} />
                  <span>API</span>
                  <StatusChip tone={health.status === 'UP' ? 'success' : 'danger'}>{health.status}</StatusChip>
                </li>
                <li>
                  <Database size={16} />
                  <span>Snowflake connectivity</span>
                  <StatusChip tone={health.snowflake === 'CONNECTED' ? 'success' : 'danger'}>{health.snowflake}</StatusChip>
                </li>
                <li>
                  <Activity size={16} />
                  <span>Warehouse {health.warehouse && health.warehouse.name}</span>
                  <StatusChip tone={health.warehouse && health.warehouse.state === 'STARTED' ? 'success' : 'neutral'}>
                    {health.warehouse ? `${health.warehouse.state}${health.warehouse.size ? ` · ${health.warehouse.size}` : ''}` : 'UNKNOWN'}
                  </StatusChip>
                </li>
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
