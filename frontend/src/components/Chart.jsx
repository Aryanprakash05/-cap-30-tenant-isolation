/* Dependency-free SVG charts, in the Figma reference style.
 * BarChart: vertical bars rising from a pale full-height track, like the
 * Activity chart in the reference. HBarChart: ranked progress-bar rows —
 * name above the bar, value on the right, like the Topics lists.
 * Sparkline: thin line for the KPI cards. The y scale always covers the
 * largest value, so no bar can clip at the top.
 */
import { fmtINR0, fmtINR, fmtNum, fmtMonth } from '../api'

const TRACK = '#e7f0e8'

export function MonthlyComboChart({ data, color = '#667858' }) {
  const W = 760, H = 270, L = 64, R = 20, T = 38, B = 42
  if (!data.length) return <div className="chart-empty">No monthly sales recorded.</div>
  const maxRevenue = Math.max(1, ...data.map((d) => Number(d.revenue) || 0))
  const maxOrders = Math.max(1, ...data.map((d) => Number(d.orders) || 0))
  const plotW = W - L - R, plotH = H - T - B, step = plotW / data.length, bw = Math.min(28, step * .52)
  const points = data.map((d, i) => `${L + step * (i + .5)},${T + plotH * (1 - (Number(d.orders) || 0) / maxOrders)}`).join(' ')
  return <div className="chart-wrap"><svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly sales and order count">
    {data.map((d, i) => { const v = Number(d.revenue) || 0, h = plotH * v / maxRevenue, x = L + step * (i + .5) - bw / 2, y = T + plotH - h; return <g key={d.month}>
      <rect x={x} y={T} width={bw} height={plotH} rx="3" fill={TRACK}/><rect x={x} y={y} width={bw} height={h} rx="3" fill={color}/>
      <text x={x + bw/2} y={Math.max(20, y - 5)} textAnchor="middle" transform={`rotate(-38 ${x + bw/2} ${Math.max(20, y - 5)})`} className="chart-tick">{fmtINR(v)}</text>
      <text x={L + step*(i+.5)} y={H-B+18} textAnchor="middle" className="chart-tick">{fmtMonth(String(d.month).slice(0, 7))}</text>
    </g>})}
    <polyline points={points} fill="none" stroke="#57534e" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    {data.map((d,i)=>{const x=L+step*(i+.5),y=T+plotH*(1-(Number(d.orders)||0)/maxOrders); return <g key={`order-${d.month}`}><circle cx={x} cy={y} r="3.5" fill="#57534e"/><text x={x} y={y-8} textAnchor="middle" className="chart-tick">{fmtNum(d.orders)}</text></g>})}
  </svg><div className="chart-legend"><span><i style={{background:color}}/>Sales</span><span><i style={{background:'#57534e'}}/>Orders</span></div></div>
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0]
  const step = max / count
  const mag = 10 ** Math.floor(Math.log10(step))
  const norm = step / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const s = nice * mag
  const steps = Math.max(1, Math.ceil(max / s))
  const ticks = []
  for (let i = 0; i <= steps; i++) ticks.push(i * s)
  return ticks
}

export function BarChart({ data, xKey, yKey, color = '#667858', height = 220, formatY = fmtINR0 }) {
  const W = 640
  const H = height
  const padL = 56
  const padB = 30
  const padT = 12
  const padR = 12
  const max = Math.max(0, ...data.map((d) => Number(d[yKey]) || 0))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const cw = (W - padL - padR) / Math.max(data.length, 1)
  const bw = Math.min(34, cw * 0.55)
  if (!data.length) return <div className="chart-empty">No data for this period.</div>
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {ticks.map((t) => {
          const y = padT + (H - padT - padB) * (1 - t / top)
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="chart-grid" />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="chart-tick">{formatY(t)}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const v = Number(d[yKey]) || 0
          const h = (H - padT - padB) * (v / top)
          const x = padL + i * cw + (cw - bw) / 2
          const y = H - padB - h
          return (
            <g key={i}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} rx={3} fill={TRACK} />
              <rect x={x} y={y} width={bw} height={Math.max(h, 1)} rx={3} fill={color}>
                <title>{`${d[xKey]}: ${formatY(v)}`}</title>
              </rect>
              <text x={x + bw / 2} y={H - padB + 16} textAnchor="middle" className="chart-tick">{d[xKey]}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function HBarChart({ data, labelKey, valueKey, formatValue = fmtINR, color = '#667858', maxRows = 8 }) {
  const rows = data.slice(0, maxRows)
  const max = Math.max(0, ...rows.map((d) => Number(d[valueKey]) || 0))
  if (!rows.length) return <div className="chart-empty">No data for this period.</div>
  return (
    <div className="hbar-list">
      {rows.map((d, i) => {
        const v = Number(d[valueKey]) || 0
        const pct = max > 0 ? (v / max) * 100 : 0
        return (
          <div className="hbar-row" key={i}>
            <div className="hbar-head">
              <span className="hbar-name" title={d[labelKey]}>{d[labelKey]}</span>
              <span className="hbar-value tabular">{formatValue(v)}</span>
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Sparkline({ data, color = '#276a3f', width = 120, height = 28 }) {
  const vals = (data || []).map(Number).filter((n) => !Number.isNaN(n))
  if (vals.length < 2) return null
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const span = max - min || 1
  const px = (i) => (i * width) / (vals.length - 1)
  const py = (v) => 3 + (height - 6) * (1 - (v - min) / span)
  const points = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
