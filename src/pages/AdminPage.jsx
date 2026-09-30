import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRightLeft, Check, Pencil, Plus, Trash2, Undo2, UserPlus, X } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { MoveDialog } from '../components/MoveDialog'
import { SiteDialog } from '../components/SiteDialog'
import {
  createSite,
  updateSite,
  deleteSite,
  watchSiteUsers,
  watchAllUsers,
  updateUser,
  deleteUserProfile,
  moveTemporarily,
  endTemporaryMove,
  movePermanently,
  watchSiteWorkers
} from '../services/db'
import { createUserAccount } from '../services/authService'
import { validateWwid } from '../services/credentials'
import { FEATURES } from '../services/features'
import { BASE_DAYS_META, DEFAULT_DAY_SCHEDULES } from '../services/schedule'
import { formatShortDate, siteLabel } from '../services/format'
import {
  isGlobalAdmin,
  canManageAccount,
  grantableFlags,
  isTempMoveActive,
  currentSiteOf,
  lastDayOf,
  siteAdminAfterPermanentMove
} from '../services/roles'

/**
 * A text field that edits a remote value without writing on every keystroke.
 * Holds a local draft while focused and saves once, on blur or Enter; Escape
 * reverts. Binding straight to the live value made each keystroke a separate
 * write, moved the caret, and could drop fast keystrokes.
 */
const DraftField = ({ value, onCommit, label, disabled }) => {
  const [draft, setDraft] = useState(null) // null = not editing
  const cancelledRef = useRef(false)

  const commit = () => {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (cancelledRef.current) { cancelledRef.current = false; return }
    if (draft === null || !next || next === (value || '')) return
    onCommit(next)
  }

  return (
    <input
      className="inline-input"
      value={draft ?? (value || '')}
      aria-label={label}
      disabled={disabled}
      onFocus={() => setDraft(value || '')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { cancelledRef.current = true; event.currentTarget.blur() }
      }}
    />
  )
}

const roleOf = (person) => (isGlobalAdmin(person) ? 'global' : person.siteAdmin ? 'site' : 'member')
const ROLE_LABELS = { member: 'Member', site: 'Site admin', global: 'Global admin' }

/**
 * Administration for one site: its workers, where they are today, whether
 * they are in the queue, and moves between sites. Global admins also get the
 * list of sites down the side.
 *
 * Every action is enforced by the Firestore rules; which buttons appear comes
 * from services/roles.js, which mirrors them.
 */
export const AdminPage = ({
  session,
  site,
  sites,
  now,
  onSelectSite,
  daySchedules,
  hoursAvailable,
  onEditHours
}) => {
  const global = isGlobalAdmin(session)
  const flags = grantableFlags(session)
  const siteId = site?.id
  const siteById = new Map(sites.map(entry => [entry.id, entry]))
  const siteName = (id) => siteById.get(id)?.name || 'another site'

  const [residents, setResidents] = useState([])
  const [visitors, setVisitors] = useState([])
  const [everyone, setEveryone] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [moving, setMoving] = useState(null)
  const [siteDialog, setSiteDialog] = useState(null) // null | 'new' | 'edit'
  const [draft, setDraft] = useState({ name: '', wwid: '' })

  // Accounts whose HOME is this site.
  useEffect(() => {
    if (!siteId) return undefined
    return watchSiteUsers(siteId, setResidents, (err) => setError(err.message))
  }, [siteId])

  // People from other sites working here right now. Readable only while you
  // yourself work here (or are global) — a site admin lent elsewhere skips it.
  const canSeeVisitors = global || currentSiteOf(session, now) === siteId
  useEffect(() => {
    if (!siteId || !canSeeVisitors) return undefined
    return watchSiteWorkers(siteId, ({ visitors: list }) => setVisitors(list), () => {})
  }, [siteId, canSeeVisitors])
  const activeVisitors = canSeeVisitors
    ? visitors.filter(v => v.siteId !== siteId && isTempMoveActive(v, now))
    : []

  // Global admins: every account, for the worker counts beside each site.
  useEffect(() => {
    if (!global) return undefined
    return watchAllUsers(setEveryone, () => {})
  }, [global])
  const countAt = (id) => everyone.filter(person => person.siteId === id).length

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const run = async (work) => {
    setError('')
    setBusy(true)
    try {
      await work()
      return true
    } catch (err) {
      setError(err?.message || 'That did not work.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const addWorker = (event) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name) { setError('Enter the worker\'s full name.'); return }
    const problem = validateWwid(draft.wwid)
    if (problem) { setError(problem); return }
    run(async () => {
      await createUserAccount({ wwid: draft.wwid, name, role: '', siteId })
      setDraft({ name: '', wwid: '' })
      setNotice(`${name} can now sign in with their work ID.`)
    })
  }

  const setRole = (worker, role) => run(() => updateUser(worker.uid, {
    siteAdmin: role !== 'member',
    ...(flags.globalAdmin ? { isGlobalAdmin: role === 'global' } : {})
  }))

  // Errors surface inside the move dialog, which stays open to retry.
  const doMove = (worker, { mode, target, endsAt }) => (mode === 'temporary'
    ? moveTemporarily(worker.uid, target, endsAt)
    : movePermanently(worker.uid, target, siteAdminAfterPermanentMove(session, worker)))

  const sorted = [...residents].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const movingWorker = residents.find(worker => worker.uid === moving)
  const isOwnHome = siteId === session.siteId
  const residentCount = global ? countAt(siteId) : residents.length
  const deleteBlockedReason = isOwnHome
    ? 'This is your own home site, so you cannot delete it.'
    : residentCount > 0 ? `Move its ${residentCount} ${residentCount === 1 ? 'worker' : 'workers'} to another site first.` : ''

  const rowFor = (worker, isVisitor) => {
    const manageable = !isVisitor && canManageAccount(session, worker)
    const away = !isVisitor && isTempMoveActive(worker, now)
    const inQueue = worker.active !== false
    const until = formatShortDate(lastDayOf(worker.tempEndsAt))
    const role = roleOf(worker)

    let where = <span className="where">Home · {site.name}</span>
    if (isVisitor) where = <span className="where is-visiting">Visiting from {siteName(worker.siteId)} until {until}</span>
    else if (away) where = <span className="where is-away">At {siteName(worker.tempSiteId)} until {until}</span>

    return (
      <div key={worker.uid} className={`w-row ${isVisitor ? 'is-visitor' : ''}`} role="row">
        <span className="w-name" role="cell">
          {manageable
            ? <DraftField value={worker.name} label={`Name of ${worker.name}`} onCommit={(name) => run(() => updateUser(worker.uid, { name }))} />
            : <span className="w-name-text">{worker.name}</span>}
          {worker.uid === session.uid && <span className="you-tag">You</span>}
        </span>

        <span className="w-role" role="cell">
          {manageable && flags.siteAdmin ? (
            <select className="inline-select" value={role} onChange={(e) => setRole(worker, e.target.value)}
              aria-label={`Role of ${worker.name}`} disabled={busy}>
              <option value="member">Member</option>
              <option value="site">Site admin</option>
              {(flags.globalAdmin || role === 'global') && <option value="global">Global admin</option>}
            </select>
          ) : (
            <span className="w-role-text">{ROLE_LABELS[role]}</span>
          )}
        </span>

        <span className="w-where" role="cell">{where}</span>

        <span className="w-queue" role="cell">
          {away ? <span className="dash">—</span> : manageable ? (
            <button className={`pill-toggle ${inQueue ? 'is-on' : ''}`}
              onClick={() => run(() => updateUser(worker.uid, { active: !inQueue }))}
              title={inQueue ? 'In the queue list — click to hide' : 'Hidden from the queue — click to show'}>
              {inQueue ? 'Yes' : 'Hidden'}
            </button>
          ) : (
            <span className={`pill-toggle is-static ${inQueue ? 'is-on' : ''}`}>{inQueue ? 'Yes' : 'Hidden'}</span>
          )}
        </span>

        <span className="w-actions" role="cell">
          {manageable && (away ? (
            <button className="btn btn-sm btn-outline" onClick={() => run(() => endTemporaryMove(worker.uid))} title="Bring back home now">
              <Undo2 size={14} /><span>End move</span>
            </button>
          ) : (
            <button className="btn btn-sm btn-outline" onClick={() => setMoving(worker.uid)} title="Move to another site">
              <ArrowRightLeft size={14} /><span>Move</span>
            </button>
          ))}
          {manageable && (confirming === worker.uid ? (
            <span className="confirm">
              <button className="icon-btn is-sm" onClick={() => setConfirming(null)} title="Keep" aria-label="Keep"><X size={15} /></button>
              <button className="icon-btn is-sm is-danger" aria-label={`Revoke ${worker.name}`} title="Revoke access"
                onClick={() => run(async () => { await deleteUserProfile(worker.uid); setConfirming(null) })}>
                <Check size={15} />
              </button>
            </span>
          ) : (
            <button className="icon-btn is-sm is-danger-soft" onClick={() => setConfirming(worker.uid)}
              title={`Revoke ${worker.name}`} aria-label={`Revoke ${worker.name}`}>
              <Trash2 size={15} />
            </button>
          ))}
        </span>
      </div>
    )
  }

  return (
    <div className={`page admin-page ${global ? 'has-sites' : ''}`}>
      {global && (
        <aside className="sites-nav" aria-label="Sites">
          <Eyebrow>Sites</Eyebrow>
          <ul className="sites-list">
            {sites.map(entry => (
              <li key={entry.id}>
                <button className={`site-item ${entry.id === siteId ? 'is-active' : ''}`} onClick={() => onSelectSite(entry.id)}
                  aria-current={entry.id === siteId ? 'true' : undefined}>
                  <span className="site-item-name">{siteLabel(entry)}</span>
                  <span className="site-item-count">{countAt(entry.id)} {countAt(entry.id) === 1 ? 'worker' : 'workers'}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="site-add" onClick={() => setSiteDialog('new')}>
            <Plus size={15} /><span>New site</span>
          </button>
        </aside>
      )}

      <div className="admin-main">
        <header className="page-head">
          <div className="page-head-text">
            <Eyebrow>Admin · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
            <h1 className="display">Workers</h1>
          </div>
          {global && (
            <div className="page-head-actions">
              <button className="btn btn-outline" onClick={() => setSiteDialog('edit')}>
                <Pencil size={15} /><span>Edit site</span>
              </button>
            </div>
          )}
        </header>

        {error && (
          <p className="alert" role="alert">
            <AlertCircle size={16} /><span>{error}</span>
            <button className="icon-btn is-sm" onClick={() => setError('')} aria-label="Dismiss"><X size={14} /></button>
          </p>
        )}
        {notice && <p className="notice is-green" role="status"><Check size={16} /><span>{notice}</span></p>}

        <form className="add-worker" onSubmit={addWorker}>
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" placeholder="Full name" value={draft.name} autoComplete="off"
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Work ID</span>
            <input className="input is-mono" placeholder="New work ID" value={draft.wwid} autoComplete="off" spellCheck={false}
              onChange={e => setDraft({ ...draft, wwid: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-dark" disabled={busy}>
            <UserPlus size={16} /><span>Add worker</span>
          </button>
        </form>

        <div className="workers" role="table" aria-label={`Workers at ${site.name}`}>
          <div className="w-row is-head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Where today</span>
            <span role="columnheader">In queue</span>
            <span role="columnheader" className="sr-only">Actions</span>
          </div>
          {sorted.map(worker => rowFor(worker, false))}
          {activeVisitors.map(visitor => rowFor(visitor, true))}
          {sorted.length === 0 && activeVisitors.length === 0 && (
            <p className="card-empty">No workers yet. Add the first one above — they sign in with their work ID.</p>
          )}
        </div>

        <p className="footnote">
          The work ID is the worker's sign-in and is never stored. <strong>Hidden</strong> keeps someone out of the
          queue list without revoking them. Revoking removes access at once; the sign-in itself can only be
          deleted in the Firebase Console, so that work ID stays taken until then.
        </p>
      </div>

      <aside className="admin-aside">
        <section className="card">
          <div className="card-head">
            <h3 className="card-title">Shift hours</h3>
            {hoursAvailable && (
              <button className="btn btn-sm btn-outline" onClick={onEditHours}>Edit</button>
            )}
          </div>
          {hoursAvailable ? (
            <ul className="hours-list">
              {BASE_DAYS_META.map(meta => {
                const day = daySchedules?.[meta.key] || DEFAULT_DAY_SCHEDULES[meta.key]
                return (
                  <li key={meta.key} className={day.isWorkDay ? '' : 'is-off'}>
                    <span>{meta.name}</span>
                    {day.isWorkDay
                      ? <span className="mono">{day.startTime} – {day.endTime}</span>
                      : <span className="off-tag">Off</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="card-empty">Shift hours are set at the site itself — open this page while you are working at {site.name}.</p>
          )}
        </section>

        <section className="info-box">
          <Eyebrow tone="blue">How moves work</Eyebrow>
          <p><strong>Temporary</strong> — pick a site and a last day. The worker is in that site's queue until then and back here at midnight after it, on their own.</p>
          <p><strong>Permanent</strong> — the worker belongs to the other site from now on.{global ? '' : ' Site-admin rights do not carry over.'}</p>
          <p><strong>Visitors</strong> — people lent here by another site are in this queue until their last day. Their home site manages them.</p>
        </section>
      </aside>

      {movingWorker && (
        <MoveDialog
          worker={movingWorker}
          homeSiteId={siteId}
          sites={sites}
          now={now}
          dropsSiteAdmin={!!movingWorker.siteAdmin && !siteAdminAfterPermanentMove(session, movingWorker)}
          onMove={(move) => doMove(movingWorker, move)}
          onClose={() => setMoving(null)}
        />
      )}

      {siteDialog === 'new' && (
        <SiteDialog
          onSave={async (values) => { const id = await createSite(values); onSelectSite(id) }}
          onClose={() => setSiteDialog(null)}
        />
      )}
      {siteDialog === 'edit' && (
        <SiteDialog
          site={site}
          canDelete={!deleteBlockedReason}
          deleteBlockedReason={deleteBlockedReason}
          onSave={(values) => updateSite(siteId, values)}
          onDelete={async () => { await deleteSite(siteId, FEATURES.map(f => f.id)); onSelectSite(session.siteId) }}
          onClose={() => setSiteDialog(null)}
        />
      )}
    </div>
  )
}
