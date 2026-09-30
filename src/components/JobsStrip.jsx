import { useState } from 'react'
import { BellRing, Check, ChevronDown, ChevronRight, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { JobChip } from './ui'
import { canDeleteJob, canFinishJob, checklistOf, jobTypeOf, waitingFor } from '../services/jobs'
import { firstNameOf, formatClockHM } from '../services/format'

const JobCard = ({ job, uid, isSiteAdmin, now, onComplete, onDelete, onOpenChecklist }) => {
  const [confirming, setConfirming] = useState(false)
  const mine = job.assigneeId === uid
  const title = job.note || jobTypeOf(job.type).label
  const from = job.createdBy === uid ? 'you' : job.createdByName
  const { done, total, complete } = checklistOf(job)

  return (
    <li className={`job-card ${mine ? 'is-mine' : ''}`} title={`Logged by ${from} · open ${waitingFor(job.createdAt, now)}`}>
      <div className="job-card-body">
        <div className="job-card-line">
          <JobChip type={job.type} />
          <strong className="job-card-title">{title}</strong>
        </div>
        <span className="job-card-meta">
          → {mine ? 'You' : job.assigneeName} · <span className="mono">{formatClockHM(job.createdAt)}</span>
        </span>
      </div>
      <div className="job-card-actions">
        {total > 0 && (
          <button className={`btn btn-sm ${complete ? 'btn-ghost' : 'btn-surface'} steps-btn`} onClick={() => onOpenChecklist(job.id)}
            title={`${job.processTitle} — ${done} of ${total} steps done`}>
            <ListChecks size={14} /><span className="mono">{done}/{total}</span>
          </button>
        )}
        {canFinishJob(job, uid, isSiteAdmin) && (
          <button className="btn btn-sm btn-surface" onClick={() => onComplete(job.id)}>
            <Check size={14} /><span>Done</span>
          </button>
        )}
        {canDeleteJob(job, uid, isSiteAdmin) && (confirming ? (
          <span className="confirm">
            <button className="icon-btn is-sm" onClick={() => setConfirming(false)} title="Keep it" aria-label="Keep it">
              <X size={14} />
            </button>
            <button className="icon-btn is-sm is-danger" onClick={() => { setConfirming(false); onDelete(job.id) }}
              title="Delete job" aria-label="Delete job">
              <Check size={14} />
            </button>
          </span>
        ) : (
          <button className="icon-btn is-sm" onClick={() => setConfirming(true)} title="Delete (logged by mistake)"
            aria-label="Delete job">
            <Trash2 size={14} />
          </button>
        ))}
      </div>
    </li>
  )
}

/**
 * Every open job at the site, across the top of the queue, until it is done.
 *
 * On a phone it folds into one line — the count and the newest job — and
 * opens on tap.
 */
export const JobsStrip = ({
  jobs,
  uid,
  isSiteAdmin,
  now,
  isNarrow,
  onNew,
  onComplete,
  onDelete,
  onOpenChecklist,
  notificationState,
  onEnableNotifications
}) => {
  const [expanded, setExpanded] = useState(false)
  const count = jobs.length
  const countLabel = count === 0 ? 'No open jobs' : `${count} open ${count === 1 ? 'job' : 'jobs'}`

  const alerts = notificationState === 'default' && (
    <button className="btn btn-sm btn-ghost" onClick={onEnableNotifications}
      title="Get a desktop notification when a job is assigned to you">
      <BellRing size={14} /><span>Enable desktop alerts</span>
    </button>
  )

  const list = count > 0 && (
    <ul className="job-cards">
      {jobs.map(job => (
        <JobCard key={job.id} job={job} uid={uid} isSiteAdmin={isSiteAdmin} now={now}
          onComplete={onComplete} onDelete={onDelete} onOpenChecklist={onOpenChecklist} />
      ))}
    </ul>
  )

  if (isNarrow) {
    if (count === 0) return null
    const newest = jobs[0]
    return (
      <section className={`jobs-band is-narrow ${expanded ? 'is-open' : ''}`} aria-label="Open jobs">
        <button className="jobs-fold" onClick={() => setExpanded(open => !open)} aria-expanded={expanded}>
          <span className="jobs-count">{countLabel}</span>
          {!expanded && (
            <span className="jobs-fold-peek">
              · {jobTypeOf(newest.type).label} for {newest.assigneeId === uid ? 'you' : firstNameOf(newest.assigneeName)}
            </span>
          )}
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {expanded && (
          <div className="jobs-band-body">
            {list}
            {alerts}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className={`jobs-band ${count > 0 ? 'has-open' : ''}`} aria-label="Open jobs">
      <div className="jobs-band-inner">
        <div className="jobs-band-head">
          <span className="jobs-count">{countLabel}</span>
          {alerts}
          {onNew && (
            <button className="btn btn-sm btn-ghost" onClick={onNew}>
              <Plus size={14} /><span>Log a job</span>
            </button>
          )}
        </div>
        {list}
      </div>
      {notificationState === 'denied' && (
        <p className="jobs-band-note">
          Desktop alerts are blocked in this browser — allow notifications for this site in the browser settings to get them.
        </p>
      )}
    </section>
  )
}
