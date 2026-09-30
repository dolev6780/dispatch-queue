import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Monitor, Pencil, Plus, UserPlus, X } from 'lucide-react'
import { OnDutyCard } from '../components/OnDutyCard'
import { StaleBanner } from '../components/StaleBanner'
import { Eyebrow, StatusBadge } from '../components/ui'
import { formatDuration } from '../services/schedule'
import { formatClockHM, formatLongDate, formatMediumDate } from '../services/format'
import { jobTypeOf } from '../services/jobs'

/** "08:00 – 16:30 · 4 in queue · 2h 07m each" */
const dayMeta = (day, count, minutesPerPerson) => {
  if (!day.isWorkDay) return count > 0 ? `Day off · ${count} in queue` : 'Day off'
  const parts = [`${day.startTime} – ${day.endTime}`]
  parts.push(count > 0 ? `${count} in queue` : 'queue empty')
  if (count > 0 && minutesPerPerson > 0) parts.push(`${formatDuration(minutesPerPerson)} each`)
  return parts.join(' · ')
}

/** The week as seven segments; the selected day is black, days off are paper. */
const DayBar = ({ daysOfWeek, selectedDayKey, todayDayIndex, onSelectDay }) => (
  <div className="daybar" role="tablist" aria-label="Day">
    {daysOfWeek.map(day => {
      const selected = day.key === selectedDayKey
      return (
        <button
          key={day.key}
          role="tab"
          aria-selected={selected}
          className={`day-seg ${selected ? 'is-selected' : ''} ${day.isWorkDay ? '' : 'is-off'} ${day.key === todayDayIndex ? 'is-today' : ''}`}
          onClick={() => onSelectDay(day.key)}
        >
          <span className="day-seg-name">
            {day.short}
            {day.key === todayDayIndex && <span className="day-seg-today">Today</span>}
          </span>
          <span className="day-seg-hours">{day.isWorkDay ? `${day.startTime}–${day.endTime}` : 'Off'}</span>
        </button>
      )
    })}
  </div>
)

/** One queued person: position, name, window, state, and the controls. */
const QueueRow = ({ person, index, count, isWorkDay, isToday, editable, disabled, visitorNote, onMove, onToggle }) => {
  const note = visitorNote(person)
  return (
    <li className={`q-row is-${person.status || 'none'} ${isToday ? '' : 'is-plan'}`}>
      <span className="q-pos">#{person.position}</span>
      <span className="q-name">
        <span className="q-name-text">{person.name}</span>
        {note && <span className="q-visitor" title={note}>Visitor</span>}
      </span>
      <span className="q-time">{isWorkDay && person.startTimeStr ? `${person.startTimeStr} – ${person.endTimeStr}` : '—'}</span>
      <span className="q-state">
        {isToday && isWorkDay ? <StatusBadge status={person.status} /> : (
          isWorkDay && person.durationStr ? <span className="q-duration">{person.durationStr}</span> : null
        )}
      </span>
      {editable && (
        <span className="q-ctrl">
          <button className="icon-btn is-sm" onClick={() => onMove(person.id, -1)} disabled={disabled || index === 0}
            title="Move up" aria-label={`Move ${person.name} up`}>
            <ChevronUp size={16} />
          </button>
          <button className="icon-btn is-sm" onClick={() => onMove(person.id, 1)} disabled={disabled || index === count - 1}
            title="Move down" aria-label={`Move ${person.name} down`}>
            <ChevronDown size={16} />
          </button>
          <button className="icon-btn is-sm" onClick={() => onToggle(person.id)} disabled={disabled}
            title="Take out of the queue" aria-label={`Take ${person.name} out of the queue`}>
            <X size={16} />
          </button>
        </span>
      )}
    </li>
  )
}

/** Workers at the site today who are not in this day's queue. */
const NotInQueue = ({ people, disabled, visitorNote, onToggle, onAddAll, hasWorkers }) => (
  <section className="card">
    <div className="card-head">
      <h3 className="card-title">Not in queue</h3>
      {people.length > 0 && <span className="card-count">{people.length}</span>}
    </div>
    {people.length === 0 ? (
      <p className="card-empty">
        {hasWorkers
          ? 'Everyone working here today is in the queue.'
          : 'Nobody works at this site yet. An administrator adds workers on the Admin page.'}
      </p>
    ) : (
      <>
        <ul className="pool">
          {people.map(person => {
            const note = visitorNote(person)
            return (
              <li key={person.id} className="pool-row">
                <span className="pool-name">
                  <span>{person.name}</span>
                  {note && <span className="pool-note">{note}</span>}
                </span>
                <button className="icon-btn is-add" onClick={() => onToggle(person.id)} disabled={disabled}
                  title={`Add ${person.name} to the queue`} aria-label={`Add ${person.name} to the queue`}>
                  <Plus size={16} />
                </button>
              </li>
            )
          })}
        </ul>
        <button className="btn btn-outline btn-block" onClick={onAddAll} disabled={disabled}>
          <UserPlus size={15} /><span>Add everyone</span>
        </button>
      </>
    )}
  </section>
)

const DoneToday = ({ jobs }) => (
  <section className="card">
    <div className="card-head">
      <h3 className="card-title">Jobs done today</h3>
      {jobs.length > 0 && <span className="card-count">{jobs.length}</span>}
    </div>
    {jobs.length === 0 ? (
      <p className="card-empty">Nothing finished yet today.</p>
    ) : (
      <ul className="done-list">
        {jobs.map(job => (
          <li key={job.id} className="done-row">
            <span className="done-time">{formatClockHM(job.doneAt)}</span>
            <span className="done-what">
              <span>{jobTypeOf(job.type).label}{job.note ? ` · ${job.note}` : ''}</span>
              <span className="done-who">{job.assigneeName}</span>
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
)

/**
 * The dispatch queue: who is on duty, the day's running order, and who else
 * could be added. Everything here writes straight to the shared board, and
 * every station updates live. While the connection is lost the controls are
 * disabled, so nobody edits from a stale copy.
 */
export const QueuePage = ({
  isNarrow,
  isStale,
  currentTime,
  daysOfWeek,
  activeDay,
  selectedDayKey,
  onSelectDay,
  todayDayIndex,
  isSelectedDayToday,
  rows,
  schedule,
  availablePeople,
  hasWorkers,
  minutesPerPerson,
  nowMinutes,
  doneToday,
  visitorNote,
  logLabel,
  onLogJob,
  onTestChime,
  onEditHours,
  onWallDisplay,
  onToggle,
  onMove,
  onAddAll,
  onClear
}) => {
  const [editing, setEditing] = useState(false)
  const disabled = isStale
  const count = rows.length
  const queueTitle = isSelectedDayToday ? "Today's queue" : `${activeDay.name}'s queue`
  const stepDay = (direction) => onSelectDay((selectedDayKey + direction + 7) % 7)

  const rowList = (editable) => count === 0 ? (
    <p className="card-empty">
      {isNarrow && !editing
        ? 'Nobody in the queue yet. Tap Edit queue to add people.'
        : 'Nobody in the queue yet. Add people from Not in queue.'}
    </p>
  ) : (
    <ol className="q-rows">
      {rows.map((person, index) => (
        <QueueRow key={person.id} person={person} index={index} count={count}
          isWorkDay={activeDay.isWorkDay} isToday={isSelectedDayToday}
          editable={editable} disabled={disabled} visitorNote={visitorNote}
          onMove={onMove} onToggle={onToggle} />
      ))}
    </ol>
  )

  const onDuty = (
    <OnDutyCard
      day={activeDay}
      schedule={schedule}
      isToday={isSelectedDayToday}
      nowMinutes={nowMinutes}
      onLogJob={isNarrow ? undefined : onLogJob}
      logLabel={logLabel}
      onTestChime={isNarrow ? undefined : onTestChime}
      disabled={disabled}
    />
  )

  // ---- Phone ------------------------------------------------------------------
  if (isNarrow) {
    return (
      <div className="page q-page is-narrow">
        {isStale && <StaleBanner />}
        <div className="daynav">
          <button className="icon-btn" onClick={() => stepDay(-1)} aria-label="Previous day"><ChevronLeft size={20} /></button>
          <button className="daynav-label" onClick={() => onSelectDay(todayDayIndex)} title="Back to today">
            <strong>{isSelectedDayToday ? `Today · ${formatMediumDate(currentTime)}` : activeDay.name}</strong>
            <span className="mono">{activeDay.isWorkDay ? `${activeDay.startTime} – ${activeDay.endTime}` : 'Day off'}</span>
          </button>
          <button className="icon-btn" onClick={() => stepDay(1)} aria-label="Next day"><ChevronRight size={20} /></button>
        </div>

        {onDuty}

        <section className="card q-card">
          <div className="card-head">
            <h3 className="card-title">{queueTitle}</h3>
            {count > 0 && <span className="card-count">{count}</span>}
          </div>
          {rowList(editing)}
          {editing && (
            <div className="q-tools">
              <button className="btn btn-outline btn-sm" onClick={onEditHours} disabled={disabled}>
                <Clock size={14} /><span>Edit hours</span>
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onClear} disabled={disabled || count === 0}>Clear queue</button>
            </div>
          )}
        </section>

        {editing && (
          <NotInQueue people={availablePeople} disabled={disabled} visitorNote={visitorNote}
            onToggle={onToggle} onAddAll={onAddAll} hasWorkers={hasWorkers} />
        )}

        <div className="bottom-bar">
          <button className="btn btn-primary" onClick={onLogJob} disabled={disabled}>
            <Plus size={17} /><span>Log a job</span>
          </button>
          <button className={`btn ${editing ? 'btn-dark' : 'btn-outline'}`} onClick={() => setEditing(open => !open)}>
            <Pencil size={15} /><span>{editing ? 'Done' : 'Edit queue'}</span>
          </button>
        </div>
      </div>
    )
  }

  // ---- Desktop ------------------------------------------------------------------
  return (
    <div className="page q-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow tone="accent">{isSelectedDayToday ? 'Today' : 'Planning'}</Eyebrow>
          <h1 className="display">{isSelectedDayToday ? formatLongDate(currentTime) : activeDay.name}</h1>
          <p className="page-meta">{dayMeta(activeDay, count, minutesPerPerson)}</p>
        </div>
        <div className="page-head-actions">
          {!isSelectedDayToday && (
            <button className="btn btn-ghost" onClick={() => onSelectDay(todayDayIndex)}>Back to today</button>
          )}
          <button className="btn btn-outline" onClick={onEditHours} disabled={disabled}>
            <Clock size={16} /><span>Edit hours</span>
          </button>
          <button className="btn btn-dark" onClick={onWallDisplay}>
            <Monitor size={16} /><span>Wall display</span>
          </button>
        </div>
      </header>

      <DayBar daysOfWeek={daysOfWeek} selectedDayKey={selectedDayKey} todayDayIndex={todayDayIndex} onSelectDay={onSelectDay} />

      {isStale && <StaleBanner />}

      <div className="q-grid">
        <div className="q-main">
          {onDuty}
          <section className="card q-card">
            <div className="card-head">
              <h3 className="card-title">{queueTitle}</h3>
              <button className="btn btn-sm btn-ghost" onClick={onClear} disabled={disabled || count === 0}>Clear queue</button>
            </div>
            {rowList(true)}
          </section>
        </div>

        <aside className="q-aside">
          <NotInQueue people={availablePeople} disabled={disabled} visitorNote={visitorNote}
            onToggle={onToggle} onAddAll={onAddAll} hasWorkers={hasWorkers} />
          <DoneToday jobs={doneToday} />
        </aside>
      </div>
    </div>
  )
}
