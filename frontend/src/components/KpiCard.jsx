/* KPI card in the Figma reference style: white card, small grey label
 * above a large bold number, grey sub-line, optional sparkline at the
 * bottom. The definition is the point: a number without its meaning is
 * decoration. Tooltip on hover (CSS) plus a title attribute.
 */
import { Info } from 'lucide-react'
import { Sparkline } from './Chart'

export default function KpiCard({ label, value, sub, tooltip, spark, sparkColor }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label-row">
        <span className="kpi-label">{label}</span>
        {tooltip && (
          <span className="kpi-tip" tabIndex={0} title={tooltip} aria-label={tooltip}>
            <Info size={13} />
            <span className="kpi-tip-text">{tooltip}</span>
          </span>
        )}
      </div>
      <div className="kpi-value tabular">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {spark && spark.length >= 2 && (
        <div className="kpi-spark"><Sparkline data={spark} color={sparkColor} /></div>
      )}
    </div>
  )
}
