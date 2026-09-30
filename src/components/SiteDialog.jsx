import { useState } from 'react'
import { AlertCircle, Trash2 } from 'lucide-react'
import { Dialog } from './Dialog'

/**
 * Create a site, or rename or delete one (global admins).
 *
 * A site has a short name — its code, such as "L12" — and a description, such
 * as "Main lab". Together they read "L12 · Main lab" across the app.
 */
export const SiteDialog = ({ site, canDelete, deleteBlockedReason, onSave, onDelete, onClose }) => {
  const isNew = !site
  const [name, setName] = useState(site?.name || '')
  const [location, setLocation] = useState(site?.location || '')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (work) => {
    setError('')
    setBusy(true)
    try {
      await work()
      onClose()
    } catch (err) {
      setError(err?.message || 'That did not work.')
      setBusy(false)
    }
  }

  const submit = (event) => {
    event.preventDefault()
    if (!name.trim()) { setError('Give the site a name.'); return }
    run(() => onSave({ name: name.trim(), location: location.trim() }))
  }

  return (
    <Dialog
      title={isNew ? 'New site' : `Edit ${site.name}`}
      subtitle={isNew ? 'Sites are fully separate: their own workers, queue and jobs.' : undefined}
      onClose={onClose}
      onSubmit={submit}
      labelId="site-dialog-title"
      footer={(
        <>
          {!isNew && (confirming ? (
            <span className="dialog-foot-start confirm-text">
              <span>Delete {site.name} for good?</span>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(onDelete)}>Delete</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="btn btn-ghost is-danger dialog-foot-start" disabled={!canDelete}
              title={canDelete ? `Delete ${site.name}` : deleteBlockedReason} onClick={() => setConfirming(true)}>
              <Trash2 size={15} /><span>Delete site</span>
            </button>
          ))}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{isNew ? 'Create site' : 'Save'}</button>
        </>
      )}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. L12" autoFocus />
      </label>
      <label className="field">
        <span className="field-label">Description <span className="field-optional">optional</span></span>
        <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Main lab" />
      </label>
      {!isNew && !canDelete && deleteBlockedReason && <p className="field-hint">{deleteBlockedReason}</p>}
      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
