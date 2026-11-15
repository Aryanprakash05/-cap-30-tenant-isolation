/* Paginated data table.
 * columns: [{ key, label, numeric?, render?(row) }]
 * Always shows the range ("Showing 1–10 of 42") and an empty state.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState } from './ui'

export default function DataTable({ columns, rows, pageSize = 10, emptyTitle = 'No rows', emptyBody = '', defaultSort = null }) {
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState(defaultSort)
  const orderedRows = sort ? [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
    return cmp * (sort.direction === 'asc' ? 1 : -1)
  }) : rows
  const pages = Math.max(1, Math.ceil(orderedRows.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const start = safePage * pageSize
  const slice = orderedRows.slice(start, start + pageSize)
  if (!rows.length) return <EmptyState title={emptyTitle} body={emptyBody} />
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
            <th key={c.key} className={c.numeric ? 'num' : ''}>{c.sortable ? <button type="button" className="table-sort" onClick={() => { setSort((s) => s?.key === c.key ? { key: c.key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key: c.key, direction: 'desc' }); setPage(0) }}>{c.label}{sort?.key === c.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button> : c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((row, i) => (
            <tr key={row.key || i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num tabular' : ''}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="table-foot">
        <span className="table-range">
          Showing {start + 1}–{Math.min(start + pageSize, orderedRows.length)} of {orderedRows.length}
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
      )}
    </div>
  )
}
