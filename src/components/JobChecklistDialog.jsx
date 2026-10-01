import { Check, Sparkles } from 'lucide-react'
import { Dialog } from './Dialog'
import { JobChip } from './ui'
import { canFinishJob, canTickJob, checklistOf, jobTypeOf } from '../services/jobs'
import { firstNameOf } from '../services/format'

/**
 * A job's work-process checklist. The assignee (or whoever logged it, or an
 * admin) ticks the steps; the job can be marked done once all are ticked.
 * Everyone else at the site can follow along, read-only.
 */
export const JobChecklistDialog = ({ job, uid, isSiteAdmin, onTick, onComplete, onClose, onAskAi }) => {
  const { steps, checks, done, total, complete } = checklistOf(job)
  const tickable = canTickJob(job, uid, isSiteAdmin)
  const finishable = canFinishJob(job, uid, isSiteAdmin)
  const who = job.assigneeId === uid ? 'you' : firstNameOf(job.assigneeName)

  return (
    <Dialog
      title={job.note || jobTypeOf(job.type).label}
      subtitle={<><JobChip type={job.type} /> <span>{job.processTitle} · for {who}</span></>}
      onClose={onClose}
      labelId="checklist-title"
      footer={(
        <>
          <span className="dialog-foot-start checklist-count mono">{done}/{total} steps</span>
          {onAskAi && (
            <button type="button" className="btn btn-ghost" onClick={() => onAskAi(job)}>
              <Sparkles size={15} /><span>Ask AI</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          {finishable || tickable ? (
            <button type="button" className="btn btn-primary" disabled={!finishable}
              title={complete ? 'Mark the job done' : 'Tick every step first'}
              onClick={async () => { if (await onComplete()) onClose() }}>
              <Check size={16} /><span>Mark done</span>
            </button>
          ) : null}
        </>
      )}
    >
      <div className="checklist-progress" aria-hidden="true">
        <div className="checklist-progress-bar" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="checklist">
        {steps.map((step, index) => {
          const ticked = checks[index] === true
          return (
            <li key={index}>
              <label className={`check-row ${ticked ? 'is-done' : ''} ${tickable ? '' : 'is-readonly'}`}>
                <input type="checkbox" checked={ticked} disabled={!tickable} onChange={() => onTick(index)} />
                <span className="check-box" aria-hidden="true"><Check size={14} /></span>
                <span className="check-num mono">{index + 1}</span>
                <span className="check-text">{step}</span>
              </label>
            </li>
          )
        })}
      </ol>
      {!tickable && (
        <p className="field-hint">Only {who}, whoever logged the job, or a site admin can tick the steps.</p>
      )}
    </Dialog>
  )
}
