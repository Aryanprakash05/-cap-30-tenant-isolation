/* Tenant Dashboard — the Figma reference composition.
 * KPI cards in a 2×2 grid beside a tall revenue chart, then two rows of
 * paired cards (channel/category, top customers/top products), then orders.
 * Business language only: no role names, no view names, no SQL internals —
 * those live on Security & Evidence.
 */
import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { apiRequest, fmtINR, fmtMonth, fmtNum } from '../api'
import KpiCard from '../components/KpiCard'
import { BarChart, HBarChart } from '../components/Chart'
import OrdersExplorer from '../components/OrdersExplorer'
import { Banner, EmptyState, ErrorState, Leaderboard, SectionCard, SkeletonKpis, StatusChip } from '../components/ui'

const TENANT_META = {
  STEAM: { name: 'Steam Valve Corporation', initials: 'SV', accent: 'steam' },
  EA: { name: 'Electronic Arts', initials: 'EA', accent: 'ea' },
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export default function Dashboard({ session, lastEvidenceRun, onOpenEvidence, onSessionExpired }) {
  const meta = TENANT_META[session.tenant] || { name: session.tenant, initials: '?', accent: 'ink' }
  const chartColor = meta.accent === 'steam' ? '#276a3f' : '#d97706'
  const [kpis, setKpis] = useState(null)
  const [kpisError, setKpisError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState(null)

  async function loadKpis() {
    setKpisError(null)
    const r = await apiRequest(session.token, '/kpis')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setKpisError(r.error); return }
    setKpis(r.data)
  }

  async function loadSummary() {
    setSummaryError(null)
    const r = await apiRequest(session.token, '/analytics/summary')
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setSummaryError(r.error); return }
    setSummary(r.data)
  }

  useEffect(() => { loadKpis(); loadSummary() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const evidenceChip = !lastEvidenceRun
    ? <StatusChip tone="neutral">Evidence not run yet</StatusChip>
    : lastEvidenceRun.summary.failed > 0
      ? <StatusChip tone="danger">Evidence: {lastEvidenceRun.summary.failed} check(s) failed</StatusChip>
      : <StatusChip tone="success"><ShieldCheck size={13} /> Data isolation: verified</StatusChip>

  const monthly = summary ? (summary.monthly || []) : []
  const monthlyRevenue = monthly.map((m) => Number(m.revenue) || 0)
  const monthlyOrders = monthly.map((m) => Number(m.orders) || 0)

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-left">
          <span className={`principal-avatar avatar-${meta.accent} avatar-lg`}>{meta.initials}</span>
          <h1 className="page-title">{meta.name}</h1>
        </div>
        <button type="button" className="evidence-chip-btn" onClick={onOpenEvidence}>
          {evidenceChip}
          <span className="evidence-chip-note">
            {lastEvidenceRun
              ? `Last isolation run ${new Date(lastEvidenceRun.runAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`
              : 'Run the isolation tests to verify'}
          </span>
        </button>
      </header>

      {kpisError ? (
        <ErrorState title="Sales figures could not be loaded" body={kpisError} onRetry={loadKpis} />
      ) : !kpis ? (
        <SkeletonKpis />
      ) : (
        <div className="hero-grid">
          <div className="kpi-grid-figma">
            <KpiCard
              label="Total revenue" value={fmtINR(kpis.totalRevenue)} sub={`${fmtNum(kpis.totalOrders)} orders in total`}
              tooltip="All order-line revenue for your company, from the shared warehouse. Other tenants' revenue is never included."
              spark={monthlyRevenue} sparkColor={chartColor}
            />
            <KpiCard
              label="Orders" value={fmtNum(kpis.totalOrders)}
              tooltip="Distinct orders placed by your company's customers."
              spark={monthlyOrders} sparkColor={chartColor}
            />
            <KpiCard
              label="Customers" value={fmtNum(kpis.totalCustomers)}
              tooltip="Customers of your company with at least one order."
            />
            <KpiCard
              label="Average order value" value={fmtINR(kpis.avgOrderValue)}
              tooltip="Total revenue divided by total orders."
            />
          </div>
          <SectionCard title="Revenue" action={<span className="section-meta">2025 · INR</span>}>
            {summaryError ? (
              <Banner tone="warning" title="Chart unavailable right now">{summaryError}</Banner>
            ) : !summary ? (
              <div><SkeletonKpis /></div>
            ) : (
              <BarChart
                data={monthly.map((m) => ({ ...m, month: fmtMonth(m.month).split(' ')[0] }))}
                xKey="month" yKey="revenue" color={chartColor} height={220}
              />
            )}
          </SectionCard>
        </div>
      )}

      {!kpisError && summaryError && (
        <Banner tone="warning" title="Charts are unavailable right now">
          {summaryError} — the figures and orders above still work. Retry after the backend is restarted.
        </Banner>
      )}

      {summary && (
        <>
          <div className="chart-grid">
            <SectionCard title="Revenue by channel">
              <HBarChart
                data={summary.byChannel || []} labelKey="channel" valueKey="revenue"
                color={chartColor}
              />
            </SectionCard>
            <SectionCard title="Revenue by category">
              <HBarChart
                data={summary.byCategory || []} labelKey="category" valueKey="revenue"
              />
            </SectionCard>
          </div>

          <div className="chart-grid">
            <SectionCard title="Top customers" action={<span className="section-meta">By revenue</span>}>
              {(summary.topCustomers || []).length === 0 ? (
                <EmptyState title="No customers yet" body="No customer revenue in the warehouse for this tenant." />
              ) : (
                <Leaderboard
                  rows={(summary.topCustomers || []).map((c) => ({
                    key: c.customerId,
                    initials: initials(c.customerName),
                    name: c.customerName,
                    sub: `${fmtNum(c.orders)} orders · ${fmtINR(c.revenue)}`,
                  }))}
                />
              )}
            </SectionCard>
            <SectionCard title="Top products" action={<span className="section-meta">By revenue</span>}>
              {(summary.topProducts || []).length === 0 ? (
                <EmptyState title="No products yet" body="No product revenue in the warehouse for this tenant." />
              ) : (
                <HBarChart
                  data={summary.topProducts || []} labelKey="productName" valueKey="revenue"
                  formatValue={(v) => fmtINR(v)} maxRows={10}
                />
              )}
            </SectionCard>
          </div>
        </>
      )}

      <SectionCard title="Orders">
        <OrdersExplorer token={session.token} tenant={null} onSessionExpired={onSessionExpired} />
      </SectionCard>
    </div>
  )
}
