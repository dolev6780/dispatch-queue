import { jobTypeOf } from '../services/jobs'

/** The NBLAB mark: a queue of three bars on the signal colour. */
export const Logo = ({ size = 28 }) => (
  <svg className="logo" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
    <rect width="28" height="28" rx="6" fill="var(--accent)" />
    <rect x="7" y="7.5" width="14" height="3" rx="1.5" fill="#fff" />
    <rect x="7" y="12.5" width="10" height="3" rx="1.5" fill="#fff" opacity="0.8" />
    <rect x="7" y="17.5" width="6" height="3" rx="1.5" fill="#fff" opacity="0.6" />
  </svg>
)

const STATUS = {
  completed: { label: 'Finished', className: 'is-finished' },
  serving: { label: 'Serving', className: 'is-serving' },
  'up-next': { label: 'Up next', className: 'is-next' },
  scheduled: { label: 'Later', className: 'is-later' }
}

/** A queue row's state: finished, serving, up next, later. */
export const StatusBadge = ({ status }) => {
  const info = STATUS[status]
  if (!info) return null
  return <span className={`badge ${info.className}`}>{info.label}</span>
}

/** A job's type, in its colour. */
export const JobChip = ({ type }) => {
  const info = jobTypeOf(type)
  return <span className="job-chip" style={{ '--job-color': info.color }}>{info.label}</span>
}

/** An on/off switch. */
export const Switch = ({ on, onChange, label }) => (
  <button type="button" className={`switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} aria-label={label}
    onClick={() => onChange(!on)}>
    <span className="switch-knob" />
  </button>
)

/** Small uppercase label, used above headings and figures. */
export const Eyebrow = ({ children, tone, className = '' }) => (
  <span className={`eyebrow ${tone ? `is-${tone}` : ''} ${className}`}>{children}</span>
)
