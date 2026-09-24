import { useState } from 'react'
import {
  Users,
  Clock,
  ShieldCheck,
  TriangleAlert,
  KeyRound,
  Trash2,
  UserPlus,
  Check,
  X,
  RotateCcw,
  Eraser,
  Sliders
} from 'lucide-react'
import { hashWorkId, isWorkIdTaken, normaliseWorkId } from '../services/auth'
import { formatDuration } from '../services/schedule'

/**
 * Administration: team, work IDs, shift hours and destructive actions.
 *
 * Reachable only when the signed-in member is flagged as an administrator.
 * That check is UI-only — see services/auth.js for why it is not a security
 * boundary.
 */
export const AdminPage = ({
  roster,
  daysOfWeek,
  dayQueues,
  session,
  onUpdateMember,
  onAddMember,
  onRemoveMember,
  onEditDayHours,
  onResetTodayQueue,
  onClearAllQueues,
  onRestoreDefaultRoster
}) => {
  const [newName, setNewName] = useState('')
  const [workIdDraft, setWorkIdDraft] = useState({ id: null, value: '', error: '' })
  const [confirming, setConfirming] = useState(null)

  const adminCount = roster.filter(person => person.isAdmin).length

  const saveWorkId = async (memberId) => {
    const value = workIdDraft.value
    if (normaliseWorkId(value).length < 3) {
      setWorkIdDraft(draft => ({ ...draft, error: 'At least 3 characters.' }))
      return
    }
    if (await isWorkIdTaken(roster, value, memberId)) {
      setWorkIdDraft(draft => ({ ...draft, error: 'Already in use.' }))
      return
    }
    const hash = await hashWorkId(value)
    onUpdateMember(memberId, { workIdHash: hash })
    setWorkIdDraft({ id: null, value: '', error: '' })
  }

  const toggleAdmin = (person) => {
    // Refuse to remove the last administrator, otherwise nobody can ever
    // reach this page again without the bootstrap path reopening.
    if (person.isAdmin && adminCount <= 1) return
    onUpdateMember(person.id, { isAdmin: !person.isAdmin })
  }

  const handleAdd = (event) => {
    event.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    onAddMember(trimmed)
    setNewName('')
  }

  const runConfirmed = (action) => {
    action()
    setConfirming(null)
  }

  return (
    <div className="md-page">
      <section className="md-hero">
        <span className="md-hero-eyebrow">
          <ShieldCheck size={14} />
          Administration
        </span>
        <h1 className="md-hero-title">Settings</h1>
        <p className="md-hero-lede">
          Signed in as <strong>{session.name}</strong>. Changes here sync to every station
          immediately.
        </p>
      </section>

      {/* ---- Team & access ------------------------------------------------ */}
      <section className="md-card">
        <div className="md-section-header">
          <div className="md-section-title">
            <Users size={19} />
            <span>Team &amp; access</span>
          </div>
          <span className="md-pill-duration">{roster.length} people</span>
        </div>

        <div className="md-admin-table" role="table">
          <div className="md-admin-row md-admin-head" role="row">
            <span>Name</span>
            <span>Role</span>
            <span>Work ID</span>
            <span>Admin</span>
            <span />
          </div>

          {roster.map(person => {
            const isEditing = workIdDraft.id === person.id
            const isLastAdmin = person.isAdmin && adminCount <= 1

            return (
              <div className="md-admin-row" role="row" key={person.id}>
                <input
                  className="md-input md-admin-input"
                  value={person.name}
                  onChange={(event) => onUpdateMember(person.id, { name: event.target.value })}
                  aria-label={`Name for ${person.name}`}
                />

                <input
                  className="md-input md-admin-input"
                  value={person.role || ''}
                  placeholder="Role"
                  onChange={(event) => onUpdateMember(person.id, { role: event.target.value })}
                  aria-label={`Role for ${person.name}`}
                />

                {isEditing ? (
                  <span className="md-admin-workid-edit">
                    <input
                      className="md-input md-admin-input"
                      type="text"
                      autoFocus
                      placeholder="New work ID"
                      value={workIdDraft.value}
                      onChange={(event) => setWorkIdDraft({ id: person.id, value: event.target.value, error: '' })}
                      aria-label={`New work ID for ${person.name}`}
                    />
                    <button className="md-btn-action" onClick={() => saveWorkId(person.id)} title="Save">
                      <Check size={15} />
                    </button>
                    <button
                      className="md-btn-action"
                      onClick={() => setWorkIdDraft({ id: null, value: '', error: '' })}
                      title="Cancel"
                    >
                      <X size={15} />
                    </button>
                    {workIdDraft.error && <span className="md-admin-error">{workIdDraft.error}</span>}
                  </span>
                ) : (
                  <button
                    className="md-admin-workid"
                    onClick={() => setWorkIdDraft({ id: person.id, value: '', error: '' })}
                    title="Set a new work ID"
                  >
                    <KeyRound size={14} />
                    <span>{person.workIdHash ? '•••••• set' : 'Not set'}</span>
                  </button>
                )}

                <button
                  className={`md-admin-toggle ${person.isAdmin ? 'is-on' : ''}`}
                  onClick={() => toggleAdmin(person)}
                  disabled={isLastAdmin}
                  title={isLastAdmin ? 'The last administrator cannot be demoted' : 'Toggle administrator'}
                  aria-pressed={!!person.isAdmin}
                >
                  <ShieldCheck size={14} />
                </button>

                <button
                  className="md-btn-action btn-del"
                  onClick={() => onRemoveMember(person.id)}
                  disabled={isLastAdmin}
                  title={isLastAdmin ? 'The last administrator cannot be removed' : `Remove ${person.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
        </div>

        <p className="md-builder-note">
          Work IDs are stored as a hash, so they cannot be read back — setting one replaces it.
          A member with no work ID simply cannot sign in.
        </p>

        <form className="md-register-box" onSubmit={handleAdd}>
          <input
            className="md-input"
            placeholder="Add a team member…"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            aria-label="New team member name"
          />
          <button type="submit" className="md-button md-button-filled" disabled={!newName.trim()}>
            <UserPlus size={16} />
            <span>Add</span>
          </button>
        </form>
      </section>

      {/* ---- Shift hours -------------------------------------------------- */}
      <section className="md-card">
        <div className="md-section-header">
          <div className="md-section-title">
            <Clock size={19} />
            <span>Shift hours</span>
          </div>
        </div>

        <div className="md-admin-table">
          <div className="md-admin-row md-admin-head md-admin-hours">
            <span>Day</span>
            <span>Hours</span>
            <span>Length</span>
            <span>In queue</span>
            <span />
          </div>

          {daysOfWeek.map(day => {
            const queued = (dayQueues[day.key] || []).length
            return (
              <div className="md-admin-row md-admin-hours" key={day.key}>
                <span className="md-admin-day">
                  {day.name}
                  {day.isCustom && <span className="md-custom-badge">Custom</span>}
                </span>
                <span className="md-admin-mono">{day.hours}</span>
                <span className="md-admin-mono">
                  {day.isWorkDay ? formatDuration(day.totalMinutes) : '—'}
                </span>
                <span className="md-admin-mono">
                  {queued > 0 && day.isWorkDay
                    ? `${queued} · ${formatDuration(day.totalMinutes / queued)} each`
                    : queued > 0 ? `${queued}` : '—'}
                </span>
                <button className="md-button md-button-tonal" onClick={() => onEditDayHours(day.key)}>
                  <Sliders size={15} />
                  <span>Edit</span>
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* ---- Danger zone -------------------------------------------------- */}
      <section className="md-card md-danger-card">
        <div className="md-section-header">
          <div className="md-section-title">
            <TriangleAlert size={19} />
            <span>Danger zone</span>
          </div>
        </div>

        {[
          {
            id: 'reset-today',
            label: 'Clear today\'s queue now',
            description: 'Empties today\'s queue immediately instead of waiting for midnight.',
            icon: RotateCcw,
            action: onResetTodayQueue
          },
          {
            id: 'clear-all',
            label: 'Clear every day\'s queue',
            description: 'Empties all seven weekday queues. The team list is untouched.',
            icon: Eraser,
            action: onClearAllQueues
          },
          {
            id: 'restore-roster',
            label: 'Restore the default team',
            description: 'Replaces the team with the original six people. Work IDs and admin rights are lost.',
            icon: Users,
            action: onRestoreDefaultRoster
          }
        ].map(item => {
          const Icon = item.icon
          const isConfirming = confirming === item.id
          return (
            <div className="md-danger-row" key={item.id}>
              <div className="md-danger-text">
                <strong>{item.label}</strong>
                <p>{item.description}</p>
              </div>
              {isConfirming ? (
                <div className="md-dialog-action-buttons">
                  <button className="md-button md-button-tonal" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button className="md-button md-button-danger" onClick={() => runConfirmed(item.action)}>
                    <Check size={15} />
                    <span>Confirm</span>
                  </button>
                </div>
              ) : (
                <button className="md-button md-button-tonal" onClick={() => setConfirming(item.id)}>
                  <Icon size={15} />
                  <span>Run</span>
                </button>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
