import { useEffect, useState } from 'react'
import { apiRequest, fmtINR, fmtNum } from '../api'
import DataTable from '../components/DataTable'
import { HBarChart } from '../components/Chart'
import { ErrorState, SectionCard, Skeleton } from '../components/ui'

export default function Products({ session, onSessionExpired }) {
  const [rows, setRows] = useState(null), [summary, setSummary] = useState(null), [error, setError] = useState(null)
  async function load() {
    setError(null)
    const [p, s] = await Promise.all([apiRequest(session.token, '/products'), apiRequest(session.token, '/analytics/summary')])
    if (p.status === 401 || s.status === 401) { onSessionExpired(); return }
    if (!p.ok || !s.ok) { setError(p.error || s.error); return }
    setRows(Array.isArray(p.data) ? p.data : []); setSummary(s.data)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="page"><header className="page-head"><h1 className="page-title">Products</h1><button className="btn btn-secondary" onClick={load}>Refresh</button></header>
    {error ? <ErrorState title="Product data could not be loaded" body={error} onRetry={load}/> : !rows || !summary ? <><Skeleton className="sk-line"/><Skeleton className="sk-line"/></> : <>
      <div className="chart-grid"><SectionCard title="Sales by Category"><HBarChart data={summary.byCategory || []} labelKey="category" valueKey="revenue"/></SectionCard>
        <SectionCard title="Discount by Product"><div className="product-discounts">{rows.length ? rows.slice().sort((a,b)=>(Number(b.avgDiscountPct)||0)-(Number(a.avgDiscountPct)||0)).map(p=><div className="discount-row" key={p.productId}><span>{p.productName}</span><strong>{Number(p.avgDiscountPct||0).toFixed(2)}%</strong></div>) : <p>No products available.</p>}</div></SectionCard></div>
      <SectionCard title="All Products" subtitle={`${fmtNum(rows.length)} products in this data scope`}>
        <DataTable rows={rows.map(r=>({...r,key:r.productId}))} defaultSort={{key:'revenue',direction:'desc'}} pageSize={20} emptyTitle="No products available" emptyBody="No product rows are available for this account." columns={[
          {key:'productName',label:'Name',sortable:true},{key:'category',label:'Category',sortable:true},{key:'listPrice',label:'List price',numeric:true,sortable:true,render:r=>fmtINR(r.listPrice)},{key:'units',label:'Units sold',numeric:true,sortable:true,render:r=>fmtNum(r.units)},{key:'revenue',label:'Sales',numeric:true,sortable:true,render:r=>fmtINR(r.revenue)},{key:'avgDiscountPct',label:'Average discount',numeric:true,sortable:true,render:r=>`${Number(r.avgDiscountPct||0).toFixed(2)}%`},
        ]}/>
      </SectionCard>
    </>}
  </div>
}
