import { useState } from 'react'
import {
  Clock,
  Calendar,
  Maximize2,
  Music,
  Volume2,
  Bell,
  BellOff,
  Sliders,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ListOrdered,
  LogIn
} from 'lucide-react'
import { QueueBuilder } from '../components/QueueBuilder'
import { formatDuration, formatTimeRemaining } from '../services/schedule'

/**
 * Queue management, focused on today.
 *
 * Leads with who is on duty right now, then the builder. Other weekdays are
 * reachable through a compact day switcher rather than a permanent 7-chip bar,
 * which kept the page busy without being used often.
 */
export const QueuePage = ({
  canEdit,
  onRequestSignIn,
  daysOfWeek,
  activeDay,
  selectedDayKey,
  onSelectDay,
  todayDayIndex,
  isSelectedDayToday,
  formattedDate,
  schedule,
  availablePeople,
  minutesPerPerson,
  currentServingPerson,
  nextInLinePerson,
  nowMinutes,
  soundEnabled,
  onToggleSound,
  onTestBell,
  onOpenSoundModal,
  onOpenFullScreen,
  onEditHours,
  onToggle,
  onMove,
  onAddAll,
  onClear,
  onAddPerson,
  onRemovePerson
}) => {
  const [isDayPickerOpen, setIsDayPickerOpen] = useState(false)

  const stepDay = (direction) => {
    const next = (selectedDayKey + direction + 7) % 7
    onSelectDay(next)
  }

  return (
    <div className="md-page">
      {/* ---- Page header ------------------------------------------------ */}
      <section className="md-queue-head">
        <div className="md-queue-head-main">
          <span className="md-hero-eyebrow">
            <Calendar size={14} />
            {isSelectedDayToday ? 'Today' : 'Viewing'}
          </span>
          <h1 className="md-date-title">
            {isSelectedDayToday ? formattedDate : activeDay.name}
          </h1>
          <div className="md-queue-head-meta">
            <span className="md-shift-chip">
              <Clock size={15} />
              <span>{activeDay.hours}</span>
              {activeDay.isCustom && <span className="md-custom-badge">Custom</span>}
            </span>
            {canEdit && (
              <button className="md-button md-button-tonal" onClick={onEditHours}>
                <Sliders size={15} />
                <span>Edit hours</span>
              </button>
            )}
          </div>
        </div>

        <div className="md-queue-head-actions">
          {/* Compact day switcher replaces the permanent 7-chip bar */}
          <div className="md-day-switch">
            <button
              className="md-icon-button"
              onClick={() => stepDay(-1)}
              title="Previous day"
              aria-label="Previous day"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="md-day-switch-label"
              onClick={() => setIsDayPickerOpen(open => !open)}
              aria-expanded={isDayPickerOpen}
            >
              <CalendarDays size={15} />
              <span>{activeDay.name}</span>
              {selectedDayKey === todayDayIndex && <span className="md-chip-today-tag">Today</span>}
            </button>
            <button
              className="md-icon-button"
              onClick={() => stepDay(1)}
              title="Next day"
              aria-label="Next day"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="md-queue-tools">
            <button
              className={`md-sound-btn ${soundEnabled ? 'is-active' : ''}`}
              onClick={onToggleSound}
              title={soundEnabled ? 'Turnover sound on' : 'Turnover sound muted'}
            >
              {soundEnabled ? <Bell size={15} /> : <BellOff size={15} />}
              <span>{soundEnabled ? 'Sound on' : 'Muted'}</span>
            </button>
            <button className="md-icon-button" onClick={onTestBell} title="Test turnover sound">
              <Volume2 size={17} />
            </button>
            <button className="md-icon-button" onClick={onOpenSoundModal} title="Change turnover sound">
              <Music size={17} />
            </button>
            <button className="md-button md-button-tonal" onClick={onOpenFullScreen}>
              <Maximize2 size={16} />
              <span>Full screen</span>
            </button>
          </div>
        </div>
      </section>

      {isDayPickerOpen && (
        <div className="md-day-picker">
          {daysOfWeek.map(day => (
            <button
              key={day.key}
              className={`md-filter-chip ${day.key === selectedDayKey ? 'is-selected' : ''} ${day.isWorkDay ? '' : 'is-off'}`}
              onClick={() => {
                onSelectDay(day.key)
                setIsDayPickerOpen(false)
              }}
            >
              <div className="md-chip-name">
                <span>{day.short}</span>
                {day.key === todayDayIndex && <span className="md-chip-today-tag">Today</span>}
              </div>
              <div className="md-chip-sub">{day.isWorkDay ? day.hours : 'Off'}</div>
            </button>
          ))}
        </div>
      )}

      {/* ---- On duty now ------------------------------------------------ */}
      <section className="md-spotlight-card">
        {currentServingPerson ? (
          <>
            <div className="md-spotlight-top">
              <span className="md-badge md-badge-primary">
                <span className="md-pulse-dot" style={{ width: '6px', height: '6px' }} />
                On duty now
              </span>
              <span className="md-shift-chip" style={{ height: '30px' }}>
                {currentServingPerson.startTimeStr} – {currentServingPerson.endTimeStr}
              </span>
            </div>

            <div className="md-spotlight-body">
              <div className="md-officer-info">
                <div className="md-avatar">
                  {currentServingPerson.name.split(' ').map(part => part[0]).join('')}
                </div>
                <div className="md-officer-details">
                  <h2>{currentServingPerson.name}</h2>
                  <p>Position #{currentServingPerson.position} · {currentServingPerson.role}</p>
                </div>
              </div>
              <div className="md-countdown-display">
                <span className="md-countdown-label">Time remaining</span>
                <span className="md-countdown-value">
                  {formatTimeRemaining(currentServingPerson.remainingMinutes)}
                </span>
              </div>
            </div>

            <div className="md-linear-progress">
              <div className="md-linear-track">
                <div
                  className="md-linear-bar"
                  style={{ width: `${currentServingPerson.progressPercent}%` }}
                />
              </div>
              <div className="md-progress-meta">
                <span>{currentServingPerson.startTimeStr}</span>
                <span>{Math.round(currentServingPerson.progressPercent)}% elapsed</span>
                <span>{currentServingPerson.endTimeStr}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="md-spotlight-body">
            <div className="md-officer-info">
              <div className="md-avatar" style={{ background: 'var(--status-completed)' }}>
                {isSelectedDayToday && nowMinutes >= activeDay.endMins
                  ? <CheckCircle size={26} />
                  : <Clock size={26} />}
              </div>
              <div className="md-officer-details">
                <h2>
                  {!activeDay.isWorkDay
                    ? `${activeDay.name} is a day off`
                    : schedule.length === 0
                      ? 'Queue is empty'
                      : isSelectedDayToday && nowMinutes >= activeDay.endMins
                        ? 'Shift completed'
                        : `Shift starts at ${activeDay.startTime}`}
                </h2>
                <p>
                  {!activeDay.isWorkDay
                    ? 'No shifts are scheduled for this day.'
                    : schedule.length === 0
                      ? 'Add people below to build the queue — every station updates live.'
                      : nextInLinePerson
                        ? `Up first: ${nextInLinePerson.name} (${nextInLinePerson.startTimeStr} – ${nextInLinePerson.endTimeStr})`
                        : `${schedule.length} scheduled · ${formatDuration(minutesPerPerson)} each`}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---- Builder ------------------------------------------------------
          Viewing is public; editing needs a work ID. The wall display can
          therefore sit on this page unattended after a reboot. */}
      {canEdit ? (
        <QueueBuilder
          schedule={schedule}
          availablePeople={availablePeople}
          minutesPerPerson={minutesPerPerson}
          isWorkDay={activeDay.isWorkDay}
          onToggle={onToggle}
          onMove={onMove}
          onAddAll={onAddAll}
          onClear={onClear}
          onAddPerson={onAddPerson}
          onRemovePerson={onRemovePerson}
        />
      ) : (
        <>
          <section className="md-card md-readonly-list">
            <div className="md-section-header">
              <div className="md-section-title">
                <ListOrdered size={19} />
                <span>Queue</span>
              </div>
              <span className="md-pill-duration">
                {schedule.length > 0 ? `${schedule.length} scheduled` : 'Empty'}
              </span>
            </div>

            {schedule.length === 0 ? (
              <div className="md-empty-dropzone">
                <ListOrdered size={26} />
                <strong>Nothing scheduled</strong>
                <p>Sign in with your work ID to build the queue for this day.</p>
              </div>
            ) : (
              <ul className="md-builder-list">
                {schedule.map(person => (
                  <li
                    key={person.id}
                    className={`md-builder-row is-queued ${person.status === 'serving' ? 'is-serving' : ''}`}
                  >
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
                    {activeDay.isWorkDay && (
                      <span className="md-builder-time">
                        {person.startTimeStr} – {person.endTimeStr}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button className="md-signin-prompt" onClick={onRequestSignIn}>
            <LogIn size={17} />
            <span>Sign in with your work ID to edit this queue</span>
          </button>
        </>
      )}
    </div>
  )
}
