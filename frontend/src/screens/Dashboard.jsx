/* Tenant Dashboard — the Figma reference composition.
 * KPI cards in a 2×2 grid beside a tall revenue chart, then two rows of
 * paired cards (channel/category, top customers/top products), then orders.
 * Business language only: no role names, no view names, no SQL internals —
 * those live on Security & Evidence.
 */
import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { apiRequest, fmtINR, fmtNum } from '../api'
import { HBarChart, MonthlyComboChart } from '../components/Chart'
import OrdersExplorer from '../components/OrdersExplorer'
import GradientWaves from '../components/GradientWaves'
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
  const chartColor = meta.accent === 'steam' ? '#667858' : '#a16f32'
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

  return (
    <div className="page">
      <header className="page-head workspace-head">
        <div className="page-head-left">
          <span className={`principal-avatar avatar-${meta.accent} avatar-lg`}>{meta.initials}</span>
          <div><div className="eyebrow">TENANT ANALYTICS <span>·</span> FY 2025</div><h1 className="page-title">{meta.name}</h1></div>
        </div>
        <button type="button" className="evidence-chip-btn review-evidence-btn" onClick={onOpenEvidence}>
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
        <>
          <section className={`dashboard-hero hero-${meta.accent}`}>
            <GradientWaves
              className="hero-wave-canvas"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              horizonColor="#a8b494"
              waveColor="#526b4e"
              crestColor="#e7f0e8"
              speed={0.18}
              amplitude={1.2}
              waveScale={0.48}
              swell={18}
              turbulence={8}
              tilt={56}
              brightness={0.72}
              opacity={0.24}
              grain={0}
              quality="low"
              mouseInteraction={false}
              swellOnClick={false}
              dpr={1}
            />
            <div className="hero-total"><span className="hero-kicker">TOTAL REVENUE <i/> FY 2025</span><div className="hero-money">{fmtINR(kpis.totalRevenue)}</div><div className="hero-caption">Sales across {fmtNum(kpis.totalOrders)} orders</div></div>
            <div className="hero-chart"><div className="hero-chart-head"><span>Sales over time</span><span>Monthly · INR</span></div>
              {summaryError ? <div className="hero-chart-error">{summaryError}<button type="button" onClick={loadSummary}>Retry</button></div> : !summary ? <div className="hero-chart-loading"><span/><span/><span/><span/><span/><span/><span/><span/></div> : <MonthlyComboChart data={monthly} color={chartColor}/>}
            </div>
          </section>
          <section className="metric-strip" aria-label="Business metrics">
            <div className="metric-item"><span>ORDERS</span><strong>{fmtNum(kpis.totalOrders)}</strong><small>Placed in 2025</small></div>
            <div className="metric-item"><span>CUSTOMERS</span><strong>{fmtNum(kpis.totalCustomers)}</strong><small>In this data scope</small></div>
            <div className="metric-item"><span>AVERAGE ORDER</span><strong>{fmtINR(kpis.avgOrderValue)}</strong><small>Sales per order</small></div>
            {summary?.discount && <div className="metric-item"><span>AVERAGE DISCOUNT</span><strong>{Number(summary.discount.avgDiscountPct).toFixed(2)}%</strong><small>{fmtINR(summary.discount.discountAmount)} total discount</small></div>}
          </section>
        </>
      )}

      {!kpisError && summaryError && (
        <Banner tone="warning" title="Charts are unavailable right now">
          {summaryError} — the figures and orders above still work. Retry after the backend is restarted.
        </Banner>
      )}

      {summary && (
        <>
          <div className="chart-grid dashboard-analysis-grid">
            <SectionCard title="Channel Mix">
              <HBarChart
                data={summary.byChannel || []} labelKey="channel" valueKey="revenue"
                color={chartColor}
              />
            </SectionCard>
            <SectionCard title="Sales by Category">
              <HBarChart
                data={summary.byCategory || []} labelKey="category" valueKey="revenue"
              />
            </SectionCard>
          </div>

          <SectionCard title="Sales by Region" className="region-panel">
            <HBarChart data={summary.byRegion || []} labelKey="region" valueKey="revenue" color={chartColor} />
          </SectionCard>

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
