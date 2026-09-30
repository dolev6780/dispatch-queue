import { Bell, BellOff, Minimize2 } from 'lucide-react'
import { JobChip, StatusBadge } from './ui'
import { StaleBanner } from './StaleBanner'
import { formatClockHM, formatHM, formatLongDate } from '../services/format'
import { checklistOf, jobTypeOf, waitingFor } from '../services/jobs'

/** The big card: who is on duty, readable from across the room. */
const WallDuty = ({ day, schedule, nowMinutes }) => {
  const serving = schedule.find(p => p.status === 'serving')

  if (serving) {
    const next = schedule[schedule.indexOf(serving) + 1]
    return (
      <section className="wall-duty is-live">
        <span className="wall-duty-eyebrow"><span className="duty-pulse" />On duty now · #{serving.position}</span>
        <h2 className="wall-duty-name">{serving.name}</h2>
        <span className="wall-duty-times">{serving.startTimeStr} – {serving.endTimeStr}</span>
        <div className="wall-duty-figure">
          <span className="wall-duty-label">Time left</span>
          <span className="wall-duty-value">{formatHM(serving.remainingMinutes)}</span>
        </div>
        <span className="wall-duty-next">
          {next ? <>Then <strong>{next.name}</strong> at {next.startTimeStr}</> : 'Last shift of the day'}
        </span>
        <div className="wall-progress"><div className="wall-progress-bar" style={{ width: `${serving.progressPercent}%` }} /></div>
      </section>
    )
  }

  let eyebrow = 'Queue is empty'
  let title = `No one queued for ${day.name}`
  let line = 'Add people from any station — this display updates live.'
  if (!day.isWorkDay) {
    eyebrow = 'Day off'
    title = `${day.name} is a day off`
    line = 'No shifts are scheduled.'
  } else if (schedule.length > 0 && nowMinutes >= day.endMins) {
    eyebrow = 'Shift completed'
    title = 'All done for today'
    line = `${schedule.length} ${schedule.length === 1 ? 'shift' : 'shifts'}, ${day.startTime} – ${day.endTime}`
  } else if (schedule.length > 0) {
    const first = schedule[0]
    return (
      <section className="wall-duty is-idle">
        <span className="wall-duty-eyebrow">First up · starts {first.startTimeStr}</span>
        <h2 className="wall-duty-name">{first.name}</h2>
        <span className="wall-duty-times">{first.startTimeStr} – {first.endTimeStr}</span>
        <div className="wall-duty-figure">
          <span className="wall-duty-label">Starts in</span>
          <span className="wall-duty-value">{formatHM(first.startMins - nowMinutes)}</span>
        </div>
      </section>
    )
  }

  return (
    <section className="wall-duty is-idle">
      <span className="wall-duty-eyebrow">{eyebrow}</span>
      <h2 className="wall-duty-name is-message">{title}</h2>
      <span className="wall-duty-next">{line}</span>
    </section>
  )
}

/**
 * The wall display: always today at this station's site, whatever day the
 * Queue page was browsing, always dark, and read-only. Open jobs stay along
 * the bottom until they are marked done.
 */
export const WallDisplay = ({
  site,
  currentTime,
  day,
  schedule,
  nowMinutes,
  jobs,
  soundEnabled,
  onToggleSound,
  onExit,
  isStale
}) => {
  const siteText = site ? [site.name, site.location].filter(Boolean).join(' ') : ''
  const meta = day.isWorkDay
    ? `${day.startTime} – ${day.endTime} · ${schedule.length} in queue`
    : 'Day off'

  return (
    <div className="wall">
      {isStale && <StaleBanner compact />}
      <header className="wall-head">
        <div className="wall-id">
          <span className="wall-eyebrow">NBLAB{siteText ? ` · ${siteText}` : ''}</span>
          <h1 className="wall-date">{formatLongDate(currentTime)}</h1>
          <span className="wall-meta">{meta}</span>
        </div>
        <div className="wall-clock" aria-label="Time">
          {formatClockHM(currentTime)}
          <span className="wall-clock-sec">{String(currentTime.getSeconds()).padStart(2, '0')}</span>
        </div>
        <div className="wall-ctrl">
          <button className={`btn btn-outline-night ${soundEnabled ? '' : 'is-muted'}`} onClick={onToggleSound}
            title={soundEnabled ? 'Chimes on — click to mute' : 'Muted — click to turn chimes on'}>
            {soundEnabled ? <Bell size={16} /> : <BellOff size={16} />}
            <span>{soundEnabled ? 'Sound on' : 'Muted'}</span>
          </button>
          <button className="btn btn-outline-night" onClick={onExit}>
            <Minimize2 size={16} /><span>Exit</span>
          </button>
        </div>
      </header>

      <div className="wall-body">
        <WallDuty day={day} schedule={schedule} nowMinutes={nowMinutes} />

        {schedule.length > 0 && (
          <ol className="wall-queue">
            {schedule.map(person => (
              <li key={person.id} className={`wall-row is-${person.status}`}>
                <span className="wall-row-pos">#{person.position}</span>
                <span className="wall-row-name">{person.name}</span>
                <span className="wall-row-time">{person.startTimeStr} – {person.endTimeStr}</span>
                <StatusBadge status={person.status} />
              </li>
            ))}
          </ol>
        )}
      </div>

      {jobs.length > 0 && (
        <footer className="wall-jobs" aria-label="Open jobs">
          <span className="wall-jobs-count"><strong>{jobs.length}</strong> open</span>
          <ul className="wall-job-list">
            {jobs.map(job => {
              const { done, total } = checklistOf(job)
              return (
                <li key={job.id} className="wall-job">
                  <span className="wall-job-top">
                    <JobChip type={job.type} />
                    {total > 0 && <span className="wall-job-steps">{done}/{total} steps</span>}
                  </span>
                  <strong className="wall-job-title">{job.note || jobTypeOf(job.type).label}</strong>
                  <span className="wall-job-meta">→ {job.assigneeName} · {formatClockHM(job.createdAt)} · {waitingFor(job.createdAt, currentTime)}</span>
                  {total > 0 && (
                    <span className="wall-job-bar"><span style={{ width: `${(done / total) * 100}%` }} /></span>
                  )}
                </li>
              )
            })}
          </ul>
        </footer>
      )}
    </div>
  )
}
