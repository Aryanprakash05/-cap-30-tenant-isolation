/* Orders explorer, shared by the tenant Dashboard and the Support Console.
 * Search, channel filter, clickable rows that expand to show order lines,
 * pagination. For analysts `tenant` is null: the API derives the tenant
 * from the session, so the browser never sends a tenant ID. For support
 * `tenant` is the granted tenant, which the server checks against the
 * active grant.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { apiRequest, fmtINR, fmtNum } from '../api'
import { Drawer, EmptyState, ErrorState, Skeleton, StatusChip } from './ui'

const CHANNELS = ['All', 'Online', 'Retail Store', 'Partner']
const PAGE_SIZE = 10

function channelTone(channel) {
  if (channel === 'Online') return 'info'
  if (channel === 'Retail Store') return 'neutral'
  return 'purple'
}

export default function OrdersExplorer({ token, tenant, onSessionExpired }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('All')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [lines, setLines] = useState({})
  const [linesLoading, setLinesLoading] = useState({})
  const [detailError, setDetailError] = useState(null)
  const selectedOrder = orders?.find((o) => o.orderId === expanded)

  const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''

  async function load() {
    setError(null)
    setOrders(null)
    const r = await apiRequest(token, `/orders${query}`)
    if (r.status === 401) { onSessionExpired(); return }
    if (!r.ok) { setError(r.error); return }
    setOrders(Array.isArray(r.data) ? r.data : [])
  }

  useEffect(() => { load() }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleExpand(orderId) {
    if (expanded === orderId) { setExpanded(null); return }
    setExpanded(orderId)
    setDetailError(null)
    if (lines[orderId]) return
    await loadOrderDetails(orderId)
  }

  async function loadOrderDetails(orderId) {
    setDetailError(null)
    setLinesLoading((m) => ({ ...m, [orderId]: true }))
    const r = await apiRequest(token, `/orders/${encodeURIComponent(orderId)}${query}`)
    setLinesLoading((m) => ({ ...m, [orderId]: false }))
    if (r.status === 401) { onSessionExpired(); return }
    if (r.ok && r.data && Array.isArray(r.data.lines)) {
      setLines((m) => ({ ...m, [orderId]: { ...r.data, lines: r.data.lines } }))
    } else if (r.status === 403) setDetailError('This order is outside the data currently available to your account. No warehouse query was issued.')
    else setDetailError(r.error || 'Order details could not be loaded. Retry the order.')
  }

  const filtered = useMemo(() => {
    if (!orders) return []
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (channel !== 'All' && o.salesChannel !== channel) return false
      if (!q) return true
      return String(o.orderId).toLowerCase().includes(q)
        || String(o.customerId).toLowerCase().includes(q)
    })
  }, [orders, search, channel])

  useEffect(() => { setPage(0); setExpanded(null) }, [search, channel])

  if (error) return <ErrorState title="Orders could not be loaded" body={error} onRetry={load} />
  if (orders === null) {
    return (
      <div>
        <Skeleton className="sk-line" /><Skeleton className="sk-line" /><Skeleton className="sk-line" />
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div>
      <div className="explorer-tools">
        <label className="search-box">
          <Search size={15} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order or customer ID"
            aria-label="Search orders"
          />
        </label>
        <div className="pill-group" role="group" aria-label="Filter by channel">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill ${channel === c ? 'pill-active' : ''}`}
              onClick={() => setChannel(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={orders.length === 0 ? 'No orders yet' : 'No orders match'}
          body={orders.length === 0
            ? 'There are no orders for this tenant in the warehouse.'
            : 'Try a different search or channel.'}
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table orders-table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Date</th><th>Channel</th><th aria-label="Expand" /></tr>
            </thead>
            <tbody>
              {slice.map((o) => (
                <OrdersRow
                  key={o.orderId}
                  order={o}
                  expanded={expanded === o.orderId}
                  lines={lines[o.orderId]?.lines || lines[o.orderId]}
                  linesLoading={!!linesLoading[o.orderId]}
                  onToggle={() => toggleExpand(o.orderId)}
                />
              ))}
            </tbody>
          </table>
          <div className="table-foot">
            <span className="table-range">
              Showing {safePage * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE + PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="pager">
              <button type="button" className="icon-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
                <ChevronLeft size={16} />
              </button>
              <span className="pager-label">Page {safePage + 1} of {pages}</span>
              <button type="button" className="icon-btn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      <Drawer open={!!expanded} onClose={() => setExpanded(null)} title={selectedOrder ? `Order ${selectedOrder.orderId}` : 'Order details'}>
        {selectedOrder && <div className="order-drawer-meta"><span>Customer <strong>{selectedOrder.customerId}</strong></span><span>{selectedOrder.orderDate}</span><StatusChip tone="neutral">{selectedOrder.salesChannel}</StatusChip></div>}
        {detailError && <ErrorState title="Order details unavailable" body={detailError} onRetry={() => expanded && loadOrderDetails(expanded)} />}
        {expanded && linesLoading[expanded] && <><Skeleton className="sk-line"/><Skeleton className="sk-line"/></>}
        {expanded && !linesLoading[expanded] && !detailError && !lines[expanded] && <EmptyState title="No line items" body="This order has no line items."/>}
        {expanded && !linesLoading[expanded] && lines[expanded] && <>
          {(lines[expanded].lines || lines[expanded]).length === 0 ? <EmptyState title="No line items" body="This order has no line items."/> : <div className="table-wrap"><table className="data-table lines-table"><thead><tr><th>Product</th><th>Category</th><th className="num">Quantity</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Line sales</th></tr></thead><tbody>
            {(lines[expanded].lines || lines[expanded]).map(l=><tr key={l.orderLineId}><td>{l.productName || l.productId}</td><td>{l.category}</td><td className="num">{fmtNum(l.quantity)}</td><td className="num">{fmtINR(l.unitPrice)}</td><td className="num">{Number(l.discountPct || 0).toFixed(2)}%</td><td className="num">{fmtINR(l.revenue)}</td></tr>)}
          </tbody><tfoot><tr><th colSpan="5">Order total</th><th className="num">{fmtINR((lines[expanded].lines || lines[expanded]).reduce((sum,l)=>sum+(Number(l.revenue)||0),0))}</th></tr></tfoot></table></div>}
        </>}
      </Drawer>
    </div>
  )
}

function OrdersRow({ order, expanded, lines, linesLoading, onToggle }) {
  return (
      <tr className={`order-row ${expanded ? 'order-row-open' : ''}`} onClick={onToggle} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <td className="mono">{order.orderId}</td>
        <td className="mono">{order.customerId}</td>
        <td>{order.orderDate}</td>
        <td><StatusChip tone={channelTone(order.salesChannel)}>{order.salesChannel}</StatusChip></td>
        <td className="expand-cell">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
      </tr>
  )
}
