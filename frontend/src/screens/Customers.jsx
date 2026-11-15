import { useEffect, useState } from 'react'
import { apiRequest, fmtINR, fmtNum } from '../api'
import DataTable from '../components/DataTable'
import { HBarChart } from '../components/Chart'
import { EmptyState, ErrorState, SectionCard, Skeleton } from '../components/ui'

export default function Customers({ session, onSessionExpired }) {
  const [rows, setRows] = useState(null), [summary, setSummary] = useState(null), [error, setError] = useState(null)
  async function load() {
    setError(null)
    const [c, s] = await Promise.all([apiRequest(session.token, '/customers'), apiRequest(session.token, '/analytics/summary')])
    if (c.status === 401 || s.status === 401) { onSessionExpired(); return }
    if (!c.ok || !s.ok) { setError(c.error || s.error); return }
    setRows(Array.isArray(c.data) ? c.data : []); setSummary(s.data)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="page"><header className="page-head"><h1 className="page-title">Customers</h1><button className="btn btn-secondary" onClick={load}>Refresh</button></header>
    {error ? <ErrorState title="Customer data could not be loaded" body={error} onRetry={load}/> : !rows || !summary ? <><Skeleton className="sk-line"/><Skeleton className="sk-line"/></> : <>
      <div className="chart-grid"><SectionCard title="Sales by Region"><HBarChart data={summary.byRegion || []} labelKey="region" valueKey="revenue"/></SectionCard><SectionCard title="Sales by Segment"><HBarChart data={summary.bySegment || []} labelKey="segment" valueKey="revenue"/></SectionCard></div>
      <SectionCard title="All Customers" subtitle={`${fmtNum(rows.length)} customers in this data scope`}>
        <DataTable rows={rows.map((r) => ({...r, key:r.customerId}))} defaultSort={{key:'totalRevenue',direction:'desc'}} pageSize={20} emptyTitle="No customers available" emptyBody="No customer rows are available for this account or active access grant." columns={[
          {key:'customerName',label:'Name',sortable:true},{key:'city',label:'City',sortable:true},{key:'region',label:'Region',sortable:true},{key:'segment',label:'Segment',sortable:true},
          {key:'orders',label:'Orders',numeric:true,sortable:true,render:r=>fmtNum(r.orders)},{key:'totalRevenue',label:'Total spend',numeric:true,sortable:true,render:r=>fmtINR(r.totalRevenue)},{key:'avgOrderValue',label:'Average order value',numeric:true,sortable:true,render:r=>fmtINR(r.avgOrderValue)},
        ]}/>
      </SectionCard>
    </>}
  </div>
}
