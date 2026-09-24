import { useState } from 'react'
import { Check, ChevronUp, ChevronDown, Plus, UserPlus, Users, Trash2, ListChecks, Eraser } from 'lucide-react'
import { formatDuration } from '../services/schedule'

/**
 * Queue builder: a single list rather than two drag-and-drop columns.
 *
 * People in the queue sit on top in running order with their computed shift
 * window; everyone else sits below. Adding and removing is a tap and ordering
 * is arrow buttons, so the same interaction works on a phone, a tablet and the
 * wall PC — dragging did not.
 */
export const QueueBuilder = ({
  schedule,
  availablePeople,
  minutesPerPerson,
  isWorkDay,
  onToggle,
  onMove,
  onAddAll,
  onClear,
  onAddPerson,
  onRemovePerson
}) => {
  const [newName, setNewName] = useState('')
  const queueCount = schedule.length

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    onAddPerson(trimmed)
    setNewName('')
  }

  return (
    <section className="md-card md-builder">
      <div className="md-builder-head">
        <div className="md-section-title">
          <ListChecks size={19} />
          <span>Build the queue</span>
        </div>
        <div className="md-builder-summary">
          {queueCount > 0 ? (
            <>
              <strong>{queueCount}</strong>
              <span>in queue</span>
              {isWorkDay && minutesPerPerson > 0 && (
                <span className="md-builder-each">· {formatDuration(minutesPerPerson)} each</span>
              )}
            </>
          ) : (
            <span>Queue is empty</span>
          )}
        </div>
      </div>

      {!isWorkDay && (
        <p className="md-builder-note">
          This day is marked as non-working, so no shift times are calculated. You can still
          prepare the queue.
        </p>
      )}

      {queueCount > 0 && (
        <>
          <h4 className="md-builder-label">In queue</h4>
          <ul className="md-builder-list">
            {schedule.map((person, index) => (
              <li
                key={person.id}
                className={`md-builder-row is-queued ${person.status === 'serving' ? 'is-serving' : ''}`}
              >
                <button
                  className="md-builder-check is-on"
                  onClick={() => onToggle(person.id)}
                  title={`Remove ${person.name} from the queue`}
                  aria-label={`Remove ${person.name} from the queue`}
                >
                  <Check size={15} />
                </button>

                <span className="md-builder-pos">{person.position}</span>

                <span className="md-builder-name">
                  {person.name}
                  {person.status === 'serving' && (
                    <span className="md-status-pill md-status-serving">
                      <span className="md-pulse-dot" style={{ width: '6px', height: '6px' }} />
                      On duty
                    </span>
                  )}
                </span>

                {isWorkDay && (
                  <span className="md-builder-time">
                    {person.startTimeStr} – {person.endTimeStr}
                  </span>
                )}

                <span className="md-builder-actions">
                  <button
                    className="md-btn-action"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                    title="Move up"
                    aria-label={`Move ${person.name} up`}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    className="md-btn-action"
                    onClick={() => onMove(index, 1)}
                    disabled={index === queueCount - 1}
                    title="Move down"
                    aria-label={`Move ${person.name} down`}
                  >
                    <ChevronDown size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {availablePeople.length > 0 && (
        <>
          <h4 className="md-builder-label">Available</h4>
          <ul className="md-builder-list">
            {availablePeople.map(person => (
              <li key={person.id} className="md-builder-row">
                <button
                  className="md-builder-check"
                  onClick={() => onToggle(person.id)}
                  title={`Add ${person.name} to the queue`}
                  aria-label={`Add ${person.name} to the queue`}
                />
                <span className="md-builder-pos is-muted">–</span>
                <span className="md-builder-name is-muted">{person.name}</span>
                <span className="md-builder-time is-muted">Not in queue</span>
                <span className="md-builder-actions">
                  <button
                    className="md-btn-action btn-del"
                    onClick={() => onRemovePerson(person.id)}
                    title={`Remove ${person.name} from the team`}
                    aria-label={`Remove ${person.name} from the team`}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {queueCount === 0 && availablePeople.length === 0 && (
        <div className="md-empty-dropzone">
          <Users size={26} />
          <strong>No one on the team yet</strong>
          <p>Add your first team member below to start building the queue.</p>
        </div>
      )}

      <div className="md-builder-bulk">
        <button
          className="md-button md-button-tonal"
          onClick={onAddAll}
          disabled={availablePeople.length === 0}
        >
          <Plus size={16} />
          <span>Add everyone</span>
        </button>
        <button
          className="md-button md-button-text md-builder-clear"
          onClick={onClear}
          disabled={queueCount === 0}
        >
          <Eraser size={16} />
          <span>Clear queue</span>
        </button>
      </div>

      <form className="md-register-box" onSubmit={handleSubmit}>
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
  )
}
