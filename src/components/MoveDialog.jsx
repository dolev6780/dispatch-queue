import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Dialog } from './Dialog'
import { toDateKey } from '../services/dailyReset'
import { endOfLastDay } from '../services/roles'
import { formatShortDate, siteLabel } from '../services/format'

/**
 * Move a worker to another site — for a while, or for good.
 *
 * Temporary: they work at the other site through the last day chosen and are
 * home again at midnight after it, with no write needed. Permanent: they
 * belong to the other site from now on.
 */
export const MoveDialog = ({ worker, homeSiteId, sites, now, dropsSiteAdmin, onMove, onClose }) => {
  const destinations = sites.filter(site => site.id !== homeSiteId)
  const today = toDateKey(now)
  const [target, setTarget] = useState(destinations[0]?.id || '')
  const [mode, setMode] = useState('temporary')
  const [lastDay, setLastDay] = useState(today)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!target) { setError('Choose a site.'); return }
    if (mode === 'temporary' && (!lastDay || lastDay < today)) { setError('The last day cannot be in the past.'); return }
    setError('')
    setBusy(true)
    try {
      await onMove(mode === 'temporary'
        ? { mode, target, endsAt: endOfLastDay(lastDay) }
        : { mode, target })
      onClose()
    } catch (err) {
      setError(err?.message || 'The move did not go through.')
      setBusy(false)
    }
  }

  const targetName = destinations.find(site => site.id === target)?.name || 'the other site'

  return (
    <Dialog
      title={`Move ${worker.name}`}
      subtitle="Temporary moves end by themselves. Permanent moves hand the worker to the other site."
      onClose={onClose}
      onSubmit={destinations.length ? submit : undefined}
      labelId="move-dialog-title"
      footer={destinations.length ? (
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>
            {busy ? 'Moving…' : mode === 'temporary' ? 'Move temporarily' : 'Move permanently'}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      )}
    >
      {destinations.length === 0 ? (
        <p className="field-hint">There is no other site to move {worker.name} to yet.</p>
      ) : (
        <>
          <label className="field">
            <span className="field-label">To</span>
            <select className="input" value={target} onChange={e => setTarget(e.target.value)}>
              {destinations.map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}
            </select>
          </label>

          <div className="segmented" role="radiogroup" aria-label="Kind of move">
            <button type="button" role="radio" aria-checked={mode === 'temporary'}
              className={mode === 'temporary' ? 'is-active' : ''} onClick={() => setMode('temporary')}>
              Temporary
            </button>
            <button type="button" role="radio" aria-checked={mode === 'permanent'}
              className={mode === 'permanent' ? 'is-active' : ''} onClick={() => setMode('permanent')}>
              Permanent
            </button>
          </div>

          {mode === 'temporary' ? (
            <label className="field">
              <span className="field-label">Last day there</span>
              <input className="input" type="date" min={today} value={lastDay} onChange={e => setLastDay(e.target.value)} />
              <span className="field-hint">
                At {targetName} until {formatShortDate(lastDay) || '…'}, back here automatically the day after.
              </span>
            </label>
          ) : (
            <p className="notice is-amber">
              {worker.name} will belong to {targetName} from now on and will no longer appear here.
              {dropsSiteAdmin ? ' Their site-admin rights do not carry over.' : ''}
            </p>
          )}

          {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
        </>
      )}
    </Dialog>
  )
}
