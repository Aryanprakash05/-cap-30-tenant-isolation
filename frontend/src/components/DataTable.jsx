/* Paginated data table.
 * columns: [{ key, label, numeric?, render?(row) }]
 * Always shows the range ("Showing 1–10 of 42") and an empty state.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState } from './ui'

export default function DataTable({ columns, rows, pageSize = 10, emptyTitle = 'No rows', emptyBody = '' }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const start = safePage * pageSize
  const slice = rows.slice(start, start + pageSize)
  if (!rows.length) return <EmptyState title={emptyTitle} body={emptyBody} />
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'num' : ''}>{c.label}</th>
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
          Showing {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
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
