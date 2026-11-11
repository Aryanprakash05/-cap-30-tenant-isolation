/* Shared UI primitives for DataVault.
 * One visual language everywhere: same chips, banners, empty/error states,
 * skeletons, drawer and countdown, so every screen feels like one product.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, Copy, Info, RefreshCw, X, XCircle,
} from 'lucide-react'

/* Small status pill. Tones: success, warning, danger, info, neutral, purple. */
export function StatusChip({ tone = 'neutral', children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

/* Coloured callout band with an icon. Tones match StatusChip. */
export function Banner({ tone = 'info', title, children, onClose }) {
  const Icon = tone === 'success' ? CheckCircle2
    : tone === 'danger' ? XCircle
    : tone === 'warning' ? AlertTriangle : Info
  return (
    <div className={`banner banner-${tone}`} role="status">
      <Icon size={18} className="banner-icon" />
      <div className="banner-body">
        {title && <div className="banner-title">{title}</div>}
        <div className="banner-text">{children}</div>
      </div>
      {onClose && (
        <button type="button" className="banner-close" onClick={onClose} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/* Centered empty state for tables and panels. */
export function EmptyState({ title, body, action }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {action}
    </div>
  )
}

/* Error state with a retry button. `onRetry` is optional. */
export function ErrorState({ title = 'Something went wrong', body, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={20} className="error-icon" />
      <div className="error-title">{title}</div>
      {body && <div className="error-body">{body}</div>}
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  )
}

/* Grey shimmer block while data loads. */
export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function SkeletonKpis() {
  return (
    <div className="kpi-grid-figma">
      {[0, 1, 2, 3].map((i) => (
        <div className="card kpi-card" key={i}>
          <Skeleton className="sk-label" />
          <Skeleton className="sk-value" />
          <Skeleton className="sk-sub" />
        </div>
      ))}
    </div>
  )
}

/* Ranked list in the Figma leaderboard style: avatar, bold name, grey
 * sub-line, large rank number on the right. No rank-movement triangles —
 * the data has no movement to show. */
export function Leaderboard({ rows }) {
  if (!rows.length) return <EmptyState title="No rows" body="Nothing to rank yet." />
  return (
    <div className="leaderboard">
      {rows.map((r, i) => (
        <div className="leader-row" key={r.key || i}>
          <span className="leader-avatar">{r.initials}</span>
          <div className="leader-meta">
            <div className="leader-name">{r.name}</div>
            {r.sub && <div className="leader-sub">{r.sub}</div>}
          </div>
          <span className="leader-rank tabular">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

/* Slide-over drawer from the right, with a backdrop. */
export function Drawer({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  )
}

/* Live per-second countdown to an expiry timestamp. Calls `onExpire` once
 * when the deadline passes. */
export function Countdown({ expiry, onExpire }) {
  const [, setTick] = useState(0)
  const expiredRef = useRef(false)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const end = new Date(expiry).getTime()
  const ms = end - Date.now()
  useEffect(() => {
    if (!Number.isNaN(end) && ms <= 0 && !expiredRef.current) {
      expiredRef.current = true
      if (onExpire) onExpire()
    }
  }, [ms, end, onExpire])
  if (Number.isNaN(end)) return <span className="mono">—</span>
  if (ms <= 0) return <span className="countdown-expired">Expired</span>
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return (
    <span className="countdown mono">
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`} remaining
    </span>
  )
}

/* Card with a title row. Used for every panel on every screen. */
export function SectionCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`card section-card ${className}`}>
      {(title || action) && (
        <div className="section-head">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {subtitle && <p className="section-subtitle">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/* One-click copy button with feedback. */
export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e) {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'copied' : ''} ${className}`}
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? <><Check size={12} /><span>Copied</span></> : <><Copy size={12} /><span>{label}</span></>}
    </button>
  )
}
