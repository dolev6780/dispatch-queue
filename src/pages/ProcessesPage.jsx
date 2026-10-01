import { useState } from 'react'
import { AlertCircle, BookOpen, Check, ChevronLeft, ListChecks, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Eyebrow, JobChip } from '../components/ui'
import { ProcessDialog } from '../components/ProcessDialog'
import { deleteProcess, saveProcess } from '../services/db'
import { JOB_TYPES, jobTypeOf } from '../services/jobs'
import { formatShortDate, siteLabel } from '../services/format'

/**
 * One process, in full: what it is linked to, the steps, the notes.
 *
 * The steps can be ticked to follow the process on screen, without logging a
 * job. Those ticks stay on this screen only — they are not saved, and they
 * start over when the process is changed or another one is opened.
 */
const ProcessDetail = ({ process, canEdit, onEdit, onDelete, onBack }) => {
  const [confirming, setConfirming] = useState(false)
  const [ticked, setTicked] = useState(() => new Set())
  const updated = formatShortDate(process.updatedAt)
  const steps = process.steps || []
  const doneCount = steps.filter((_, index) => ticked.has(index)).length
  const allDone = steps.length > 0 && doneCount === steps.length
  const toggle = (index) => setTicked(current => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  return (
    <section className="card proc-detail">
      {onBack && (
        <button className="btn btn-sm btn-ghost proc-back" onClick={onBack}>
          <ChevronLeft size={16} /><span>All processes</span>
        </button>
      )}
      <div className="proc-detail-head">
        <div className="proc-detail-title">
          <h2>{process.title}</h2>
          {process.jobType ? (
            <span className="proc-link">
              <JobChip type={process.jobType} />
              <span>Checklist on every {jobTypeOf(process.jobType).label} job</span>
            </span>
          ) : (
            <span className="proc-link is-none">Not linked to a job type</span>
          )}
        </div>
        {canEdit && (
          <div className="proc-detail-actions">
            <button className="btn btn-sm btn-outline" onClick={onEdit}><Pencil size={14} /><span>Edit</span></button>
            {confirming ? (
              <span className="confirm">
                <button className="icon-btn is-sm" onClick={() => setConfirming(false)} aria-label="Keep it"><X size={15} /></button>
                <button className="icon-btn is-sm is-danger" onClick={() => { setConfirming(false); onDelete() }}
                  aria-label={`Delete ${process.title}`}><Check size={15} /></button>
              </span>
            ) : (
              <button className="icon-btn is-sm is-danger-soft" onClick={() => setConfirming(true)}
                title="Delete process" aria-label={`Delete ${process.title}`}><Trash2 size={15} /></button>
            )}
          </div>
        )}
      </div>

      <div className="proc-run">
        <div className="proc-run-head">
          <span className="proc-run-count mono">{doneCount}/{steps.length} steps</span>
          {doneCount > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setTicked(new Set())}>
              <RotateCcw size={14} /><span>Clear ticks</span>
            </button>
          )}
        </div>
        <div className="checklist-progress" aria-hidden="true">
          <div className="checklist-progress-bar" style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
        </div>
        <ol className="checklist">
          {steps.map((step, index) => {
            const done = ticked.has(index)
            return (
              <li key={index}>
                <label className={`check-row ${done ? 'is-done' : ''}`}>
                  <input type="checkbox" checked={done} onChange={() => toggle(index)} />
                  <span className="check-box" aria-hidden="true"><Check size={14} /></span>
                  <span className="check-num mono">{index + 1}</span>
                  <span className="check-text">{step}</span>
                </label>
              </li>
            )
          })}
        </ol>
        {allDone && (
          <p className="notice is-green" role="status"><Check size={16} /><span>All steps done.</span></p>
        )}
        <p className="field-hint">Ticks here are for following along on this screen and are not saved.</p>
      </div>

      {process.notes && (
        <div className="proc-notes">
          <Eyebrow>Notes</Eyebrow>
          <p>{process.notes}</p>
        </div>
      )}

      {updated && <p className="proc-updated">Last changed {updated}</p>}
    </section>
  )
}

/**
 * Work processes: the site's step-by-step guides. Everyone working here reads
 * them; the site's administrators write them. A process linked to a job type
 * becomes the checklist on every new job of that type.
 */
export const ProcessesPage = ({ site, processes, loaded, error, canEdit, uid, isNarrow, onDraft }) => {
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | process
  const [actionError, setActionError] = useState('')

  // On a phone the list and the detail are separate screens.
  const selected = processes.find(p => p.id === selectedId) || (isNarrow ? null : processes[0]) || null

  const save = async (values) => {
    const id = await saveProcess(site.id, editing === 'new' ? null : editing.id, values, uid)
    setSelectedId(id)
  }
  const remove = async (process) => {
    setActionError('')
    try {
      await deleteProcess(site.id, process.id)
      setSelectedId(null)
    } catch (err) {
      setActionError(err?.message || 'Could not delete the process.')
    }
  }

  const linkedCount = new Set(processes.map(p => p.jobType).filter(Boolean)).size

  const list = (
    <section className="card proc-list" aria-label="Processes">
      {processes.length === 0 ? (
        <div className="proc-empty">
          <BookOpen size={22} />
          <p>
            {!loaded ? 'Loading…'
              : canEdit ? 'No work processes yet. Write the first one — for example, the steps of an SSD upgrade.'
                : 'No work processes yet. Your site admin writes them.'}
          </p>
        </div>
      ) : (
        <ul className="proc-items">
          {processes.map(process => (
            <li key={process.id}>
              <button className={`proc-item ${selected?.id === process.id ? 'is-active' : ''}`}
                onClick={() => setSelectedId(process.id)} aria-current={selected?.id === process.id ? 'true' : undefined}>
                <span className="proc-item-title">{process.title}</span>
                <span className="proc-item-meta">
                  {process.jobType ? <JobChip type={process.jobType} /> : <span className="proc-item-free">General</span>}
                  <span className="mono"><ListChecks size={13} /> {(process.steps || []).length}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  const detail = selected && (
    <ProcessDetail
      key={`${selected.id}:${(selected.steps || []).join('\n')}`}
      process={selected}
      canEdit={canEdit}
      onEdit={() => setEditing(selected)}
      onDelete={() => remove(selected)}
      onBack={isNarrow ? () => setSelectedId(null) : undefined}
    />
  )

  return (
    <div className="page proc-page">
      {!(isNarrow && detail) && (
        <header className="page-head">
          <div className="page-head-text">
            <Eyebrow>Work processes · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
            <h1 className="display">Processes</h1>
            <p className="page-meta">
              {processes.length} {processes.length === 1 ? 'process' : 'processes'} · {linkedCount} of {JOB_TYPES.length} job types have a checklist
            </p>
          </div>
          {canEdit && (
            <div className="page-head-actions">
              <button className="btn btn-dark" onClick={() => setEditing('new')}>
                <Plus size={16} /><span>New process</span>
              </button>
            </div>
          )}
        </header>
      )}

      {(error || actionError) && (
        <p className="alert" role="alert"><AlertCircle size={16} /><span>{actionError || error}</span></p>
      )}

      {isNarrow || processes.length === 0 ? (detail || list) : (
        <div className="proc-grid">
          {list}
          {detail || (
            <section className="card proc-detail is-empty">
              <p className="card-empty">Pick a process to read its steps.</p>
            </section>
          )}
        </div>
      )}

      {editing && (
        <ProcessDialog
          process={editing === 'new' ? null : editing}
          processes={processes}
          onSave={save}
          onClose={() => setEditing(null)}
          onDraft={onDraft}
        />
      )}
    </div>
  )
}
