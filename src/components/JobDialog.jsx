import { useState } from 'react'
import { AlertCircle, ListChecks, Send } from 'lucide-react'
import { Dialog } from './Dialog'
import { JOB_TYPES, MAX_NOTE_LENGTH, validateNewJob } from '../services/jobs'
import { processForType } from '../services/processes'
import { firstNameOf } from '../services/format'

/**
 * Log a new job and assign it to a worker at this site.
 *
 * The worker on duty right now is preselected — that is who normally takes
 * the next job — but any worker at the site today can be chosen. If the type
 * has a work process, the job carries its steps as a checklist.
 */
export const JobDialog = ({ workers, onDutyId, processes = [], onSubmit, onClose }) => {
  const [type, setType] = useState('')
  const [assigneeId, setAssigneeId] = useState(onDutyId || workers[0]?.id || '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const process = processForType(processes, type)
  const assignee = workers.find(worker => worker.id === assigneeId)

  const submit = async (event) => {
    event.preventDefault()
    const problem = validateNewJob({ type, assigneeId, note })
    if (problem) { setError(problem); return }
    setBusy(true)
    const ok = await onSubmit({ type, assigneeId, note, process })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      title="Log a job"
      subtitle="The worker is alerted, and the job stays on every screen here until it is done."
      onClose={onClose}
      onSubmit={submit}
      labelId="job-dialog-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || workers.length === 0}>
            <Send size={15} /><span>{busy ? 'Assigning…' : 'Assign job'}</span>
          </button>
        </>
      )}
    >
      <div className="field">
        <span className="field-label">Type</span>
        <div className="type-grid">
          {JOB_TYPES.map(option => (
            <button
              key={option.id}
              type="button"
              className={`type-opt ${type === option.id ? 'is-selected' : ''}`}
              style={{ '--job-color': option.color }}
              onClick={() => { setType(option.id); setError('') }}
              aria-pressed={type === option.id}
            >
              <span className="type-dot" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {process && (
        <p className="notice is-blue">
          <ListChecks size={16} />
          <span>
            <strong>{process.title}</strong> — {process.steps.length} {process.steps.length === 1 ? 'step' : 'steps'}.{' '}
            {assignee ? firstNameOf(assignee.name) : 'The worker'} ticks them off before the job can be closed.
          </span>
        </p>
      )}

      <label className="field">
        <span className="field-label">Assign to</span>
        {workers.length === 0 ? (
          <span className="field-hint">Nobody is working at this site today.</span>
        ) : (
          <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {workers.map(worker => (
              <option key={worker.id} value={worker.id}>
                {worker.name}{worker.id === onDutyId ? '  (on duty)' : ''}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="field">
        <span className="field-label">
          Note <span className="field-optional">optional</span>
          <span className="field-count">{note.length}/{MAX_NOTE_LENGTH}</span>
        </span>
        <textarea
          className="input"
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Printer offline, floor 2"
          rows={3}
        />
      </label>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
