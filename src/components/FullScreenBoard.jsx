import { Clock, Bell, BellOff, Minimize2, Eye, EyeOff, Users, Volume2 } from 'lucide-react'
import { formatClockTime, formatTimeRemaining } from '../services/schedule'

/**
 * Wall-mounted command centre display.
 *
 * Shows the live day only. Earlier completed officers collapse by default so
 * the current and next officer stay large and readable from across the room.
 */
export const FullScreenBoard = ({
  activeDay,
  formattedDate,
  currentTime,
  schedule,
  earlierCompletedCount,
  showAll,
  onToggleShowAll,
  nowMinutes,
  soundEnabled,
  onToggleSound,
  onTestBell,
  onExit
}) => {
  const visibleSchedule = (showAll || earlierCompletedCount <= 0)
    ? schedule
    : schedule.slice(earlierCompletedCount)

  return (
    <div className="md-fullscreen-overlay">
      <div className="md-fs-header">
        <div className="md-fs-header-top">
          <div className="md-fs-date-block">
            <div className="md-fs-date">{formattedDate}</div>
            <div className="md-fs-shift">
              <Clock size={20} />
              <span>{activeDay.hours}</span>
            </div>
          </div>

          <div className="md-fs-controls">
            <button
              className={`md-sound-btn ${soundEnabled ? 'is-active' : ''}`}
              onClick={onToggleSound}
              title={soundEnabled ? 'Turnover sound on' : 'Turnover sound muted'}
            >
              {soundEnabled ? <Bell size={17} /> : <BellOff size={17} />}
              <span>{soundEnabled ? 'Sound on' : 'Muted'}</span>
            </button>
            <button className="md-button md-button-tonal" onClick={onTestBell} title="Test turnover sound">
              <Volume2 size={17} />
              <span>Test</span>
            </button>
            <button className="md-button md-button-tonal" onClick={onExit} title="Exit full screen">
              <Minimize2 size={17} />
              <span>Exit</span>
            </button>
          </div>
        </div>

        <div className="md-fs-master-clock" title="Dispatch master time (24h)">
          <span className="md-pulse-dot md-fs-pulse-dot" />
          <span className="md-fs-clock-digits">{formatClockTime(currentTime)}</span>
        </div>
      </div>

      <div className="md-fs-list">
        {earlierCompletedCount > 0 && (
          <div className="md-fs-earlier-bar">
            <button className="md-fs-earlier-btn" onClick={onToggleShowAll}>
              {showAll ? <EyeOff size={18} /> : <Eye size={18} />}
              <span>
                {showAll
                  ? 'Hide earlier completed officers'
                  : `Show ${earlierCompletedCount} earlier completed ${earlierCompletedCount === 1 ? 'officer' : 'officers'}`}
              </span>
            </button>
          </div>
        )}

        {/* After the daily reset the queue is empty until someone fills it in,
            so the wall display says so rather than showing a blank screen. */}
        {visibleSchedule.length === 0 && (
          <div className="md-fs-empty">
            <div className="md-fs-empty-icon">
              <Users size={54} />
            </div>
            <h2>Queue cleared for {activeDay.name}</h2>
            <p>
              {activeDay.isWorkDay
                ? 'No officers assigned yet. Add them from any connected station — this display updates live.'
                : `${activeDay.name} is not a working day.`}
            </p>
          </div>
        )}

        {visibleSchedule.map(person => {
          const isServing = person.status === 'serving'
          const isCompleted = person.status === 'completed'
          const minsUntilStart = Math.max(0, Math.ceil(person.startMins - nowMinutes))

          return (
            <div key={person.id} className={`md-fs-row ${isServing ? 'is-active' : ''}`}>
              <div className="md-fs-left">
                <div className="md-fs-pos">#{person.position}</div>
                <div className="md-fs-name">{person.name}</div>
              </div>

              <div className="md-fs-center">
                <div className="md-fs-center-block">
                  <span className="md-fs-center-label">Shift window</span>
                  <span className="md-fs-center-time">
                    {person.startTimeStr} – {person.endTimeStr}
                  </span>
                </div>
              </div>

              <div className="md-fs-right">
                {isServing ? (
                  <div className="md-fs-time-left md-time-left-active">
                    <span className="md-pulse-dot" style={{ width: '10px', height: '10px' }} />
                    <span>{formatTimeRemaining(person.remainingMinutes)} left</span>
                  </div>
                ) : isCompleted ? (
                  <div className="md-fs-time-left md-time-left-done">Completed</div>
                ) : (
                  <div className="md-fs-time-left md-time-left-upcoming">
                    in {formatTimeRemaining(minsUntilStart)}
                  </div>
                )}
              </div>

              <div
                className="md-fs-row-progress"
                style={{ width: `${person.progressPercent}%` }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
