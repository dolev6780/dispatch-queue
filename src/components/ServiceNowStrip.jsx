import { ExternalLink } from 'lucide-react'
import { formatClockHM } from '../services/format'
import { isUrgent, openedTime, snapshotState } from '../services/servicenow'

const headline = (snapshot, state) => {
  const asOf = formatClockHM(snapshot.okAt || snapshot.checkedAt)
  if (state === 'stale') return `Watcher paused — open ServiceNow in this browser · last seen ${asOf}`
  if (state === 'error') return snapshot.error
  if (snapshot.count === 0) return `Nothing unassigned · ${asOf}`
  return `${snapshot.count} unassigned · ${asOf}`
}

/**
 * Unassigned ServiceNow tasks, as seen by the watcher on this PC. Shown only
 * where the watcher runs; every task links back to ServiceNow.
 *
 * `variant="wall"` is the read-only version for the wall display.
 */
export const ServiceNowStrip = ({ snapshot, now, variant = 'band', limit = 6 }) => {
  if (!snapshot) return null
  const state = snapshotState(snapshot, now.getTime())
  const shown = snapshot.tasks.slice(0, limit)
  const more = snapshot.count - shown.length

  if (variant === 'wall') {
    return (
      <section className={`wall-sn is-${state}`} aria-label="ServiceNow">
        <span className="wall-sn-count">
          <strong>{state === 'live' ? snapshot.count : '–'}</strong>
          <span>ServiceNow</span>
        </span>
        {state === 'live' && shown.length > 0 ? (
          <ul className="wall-sn-list">
            {shown.map(task => (
              <li key={task.id || task.number} className={`wall-sn-item ${isUrgent(task.priority) ? 'is-urgent' : ''}`}>
                <span className="wall-sn-num">{task.number}</span>
                <span className="wall-sn-title">{task.title || '(no description)'}</span>
                <span className="wall-sn-time">{openedTime(task.opened)}</span>
              </li>
            ))}
            {more > 0 && <li className="wall-sn-more">+{more} more</li>}
          </ul>
        ) : (
          <span className="wall-sn-note">{headline(snapshot, state)}</span>
        )}
      </section>
    )
  }

  return (
    <section className={`sn-band is-${state}`} aria-label="Unassigned ServiceNow tasks">
      <div className="sn-band-inner">
        <div className="sn-band-head">
          <span className="sn-label">ServiceNow</span>
          <span className="sn-headline">{headline(snapshot, state)}</span>
          {snapshot.groups.length > 0 && <span className="sn-groups">{snapshot.groups.join(', ')}</span>}
          {snapshot.listUrl && (
            <a className="btn btn-sm btn-ghost" href={snapshot.listUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /><span>Open list</span>
            </a>
          )}
        </div>
        {state !== 'stale' && shown.length > 0 && (
          <ul className="sn-cards">
            {shown.map(task => (
              <li key={task.id || task.number}>
                <a className={`sn-card ${isUrgent(task.priority) ? 'is-urgent' : ''}`} href={task.url || undefined}
                  target="_blank" rel="noopener noreferrer" title="Open in ServiceNow">
                  <span className="sn-card-top">
                    <span className="sn-num">{task.number}</span>
                    {task.priority && <span className="sn-priority">{task.priority}</span>}
                    <span className="sn-time">{openedTime(task.opened)}</span>
                  </span>
                  <span className="sn-title">{task.title || '(no description)'}</span>
                </a>
              </li>
            ))}
            {more > 0 && snapshot.listUrl && (
              <li>
                <a className="sn-card is-more" href={snapshot.listUrl} target="_blank" rel="noopener noreferrer">+{more} more</a>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  )
}
