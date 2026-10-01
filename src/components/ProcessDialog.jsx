import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, Plus, Sparkles, X } from 'lucide-react'
import { Dialog } from './Dialog'
import { JOB_TYPES } from '../services/jobs'
import {
  MAX_NOTES_LENGTH, MAX_STEP_LENGTH, MAX_STEPS, MAX_TITLE_LENGTH,
  cleanSteps, linkedTypes, moveStep, validateProcess
} from '../services/processes'

// Rows carry a stable key, so inserting a step mounts a new input (which
// takes focus) instead of shifting text between existing ones.
let lastRowKey = 0
const row = (text) => ({ key: ++lastRowKey, text })

/**
 * Write or edit a work process: a title, the job type it is a checklist for,
 * the steps in order, and optional notes. Enter in a step adds the next one.
 */
export const ProcessDialog = ({ process, processes, onSave, onClose, onDraft }) => {
  const [title, setTitle] = useState(process?.title || '')
  const [jobType, setJobType] = useState(process?.jobType || '')
  const [rows, setRows] = useState(() => (process?.steps?.length ? process.steps : ['']).map(row))
  const [notes, setNotes] = useState(process?.notes || '')
  const [focusKey, setFocusKey] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const taken = linkedTypes(processes, process?.id)

  const steps = rows.map(r => r.text)
  const [drafting, setDrafting] = useState(false)

  // Gemini suggests the steps from the title (and improves any already
  // written); the admin edits them before saving.
  const draftWithAi = async () => {
    if (!title.trim()) { setError('Give the process a title first — the draft is written from it.'); return }
    setError('')
    setDrafting(true)
    try {
      const draft = await onDraft({ title, jobType, steps: cleanSteps(steps) })
      setRows(draft.steps.map(row))
      if (draft.notes && !notes.trim()) setNotes(draft.notes)
    } catch (err) {
      setError(err?.message || 'The draft did not come through.')
    } finally {
      setDrafting(false)
    }
  }
  const setStep = (index, text) => setRows(list => list.map((r, i) => (i === index ? { ...r, text } : r)))
  const insertAfter = (index) => {
    if (rows.length >= MAX_STEPS) return
    const fresh = row('')
    setRows(list => [...list.slice(0, index + 1), fresh, ...list.slice(index + 1)])
    setFocusKey(fresh.key)
  }
  const removeStep = (index) => setRows(list => (list.length > 1 ? list.filter((_, i) => i !== index) : [row('')]))

  const submit = async (event) => {
    event.preventDefault()
    const values = { title, jobType, steps: cleanSteps(steps), notes }
    const problem = validateProcess(values)
    if (problem) { setError(problem); return }
    setError('')
    setBusy(true)
    try {
      await onSave(values)
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save the process.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={process ? 'Edit process' : 'New process'}
      subtitle="Jobs already logged keep the steps they were logged with."
      onClose={onClose}
      onSubmit={submit}
      wide
      labelId="process-dialog-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? 'Saving…' : process ? 'Save' : 'Create process'}</button>
        </>
      )}
    >
      <div className="field-pair">
        <label className="field">
          <span className="field-label">Title</span>
          <input className="input" value={title} maxLength={MAX_TITLE_LENGTH} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. SSD upgrade" autoFocus={!process} />
        </label>
        <label className="field">
          <span className="field-label">Checklist for</span>
          <select className="input" value={jobType} onChange={e => setJobType(e.target.value)}>
            <option value="">No job type</option>
            {JOB_TYPES.map(type => (
              <option key={type.id} value={type.id} disabled={taken.has(type.id)}>
                {type.label}{taken.has(type.id) ? ' (has a process)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field">
        <span className="field-label">
          Steps
          {onDraft && (
            <button type="button" className="btn btn-sm btn-ghost field-action" onClick={draftWithAi} disabled={drafting}
              title={cleanSteps(steps).length ? 'Improve these steps with AI' : 'Draft the steps with AI from the title'}>
              <Sparkles size={14} /><span>{drafting ? 'Drafting…' : cleanSteps(steps).length ? 'Improve with AI' : 'Draft with AI'}</span>
            </button>
          )}
          <span className="field-count">{cleanSteps(steps).length}/{MAX_STEPS}</span>
        </span>
        <ol className="step-editor">
          {rows.map(({ key, text }, index) => (
            <li key={key} className="step-edit">
              <span className="step-edit-num">{index + 1}</span>
              <input
                className="input"
                value={text}
                maxLength={MAX_STEP_LENGTH}
                placeholder={index === 0 ? 'e.g. Back up the user data' : 'Next step'}
                aria-label={`Step ${index + 1}`}
                autoFocus={focusKey === key}
                onChange={e => setStep(index, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertAfter(index) } }}
              />
              <span className="step-edit-ctrl">
                <button type="button" className="icon-btn is-sm" onClick={() => setRows(list => moveStep(list, index, -1))}
                  disabled={index === 0} aria-label={`Move step ${index + 1} up`}><ChevronUp size={16} /></button>
                <button type="button" className="icon-btn is-sm" onClick={() => setRows(list => moveStep(list, index, 1))}
                  disabled={index === rows.length - 1} aria-label={`Move step ${index + 1} down`}><ChevronDown size={16} /></button>
                <button type="button" className="icon-btn is-sm" onClick={() => removeStep(index)}
                  aria-label={`Remove step ${index + 1}`}><X size={16} /></button>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-sm btn-outline step-add" onClick={() => insertAfter(rows.length - 1)}
          disabled={rows.length >= MAX_STEPS}>
          <Plus size={14} /><span>Add step</span>
        </button>
      </div>

      <label className="field">
        <span className="field-label">Notes <span className="field-optional">optional</span></span>
        <textarea className="input" rows={3} value={notes} maxLength={MAX_NOTES_LENGTH} onChange={e => setNotes(e.target.value)}
          placeholder="Tools, contacts, links — anything that helps." />
      </label>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
