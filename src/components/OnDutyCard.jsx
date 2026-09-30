import { ArrowRight, Plus, Volume2 } from 'lucide-react'
import { formatHM } from '../services/format'
import { formatDuration } from '../services/schedule'

/**
 * The black card: who is on duty now, their window, and the time they have
 * left. When nobody is — before the day starts, after it ends, on a day off,
 * with an empty queue, or on another day — it says so plainly instead.
 *
 * `variant="home"` swaps the queue actions for a way to the queue.
 */
export const OnDutyCard = ({
  day,
  schedule,
  isToday,
  nowMinutes,
  variant = 'queue',
  openJobsCount = 0,
  onLogJob,
  logLabel,
  onTestChime,
  onOpenQueue,
  disabled
}) => {
  const serving = schedule.find(p => p.status === 'serving')
  const servingIndex = serving ? schedule.indexOf(serving) : -1
  const next = serving ? schedule[servingIndex + 1] : null
  const first = schedule[0]
  const each = schedule.length > 0 ? day.totalMinutes / schedule.length : 0

  let eyebrow
  let title
  let line
  let figure = null
  let progress = null

  if (!day.isWorkDay) {
    eyebrow = 'Day off'
    title = `${day.name} is a day off`
    line = 'No shifts are scheduled.'
  } else if (schedule.length === 0) {
    eyebrow = 'Queue is empty'
    title = 'Nobody in the queue'
    line = variant === 'home'
      ? 'Open the queue to add people — every screen updates live.'
      : 'Add people from the list — every screen updates live.'
  } else if (serving) {
    eyebrow = <><span className="duty-pulse" />On duty now · #{serving.position}</>
    title = serving.name
    const nextText = next ? `${next.name} at ${next.startTimeStr}` : 'end of day'
    const jobsText = openJobsCount > 0 ? ` · ${openJobsCount} open ${openJobsCount === 1 ? 'job' : 'jobs'}` : ''
    line = variant === 'home'
      ? `Next: ${nextText}${jobsText}`
      : <><span className="mono">{serving.startTimeStr} – {serving.endTimeStr}</span> · next: {nextText}</>
    figure = { label: 'Time left', value: formatHM(serving.remainingMinutes) }
    progress = serving.progressPercent
  } else if (isToday && nowMinutes >= day.endMins) {
    eyebrow = 'Shift completed'
    title = 'All done for today'
    line = <>{schedule.length} {schedule.length === 1 ? 'shift' : 'shifts'}, <span className="mono">{day.startTime} – {day.endTime}</span></>
  } else if (isToday) {
    eyebrow = `First up · starts ${first.startTimeStr}`
    title = first.name
    line = <><span className="mono">{first.startTimeStr} – {first.endTimeStr}</span> · {formatDuration(each)} each</>
    figure = { label: 'Starts in', value: formatHM(first.startMins - nowMinutes) }
  } else {
    eyebrow = `${day.name} · first up`
    title = first.name
    line = <><span className="mono">{first.startTimeStr} – {first.endTimeStr}</span> · {schedule.length} in queue</>
    figure = { label: 'Each', value: formatHM(each) }
  }

  const isLive = !!serving

  return (
    <section className={`duty ${isLive ? 'is-live' : 'is-idle'} ${variant === 'home' ? 'is-home' : ''}`}>
      <div className="duty-main">
        <div className="duty-text">
          <span className="duty-eyebrow">{eyebrow}</span>
          <h2 className="duty-name">{title}</h2>
          <p className="duty-line">{line}</p>
        </div>
        {figure && (
          <div className="duty-figure">
            <span className="duty-figure-label">{figure.label}</span>
            <span className="duty-figure-value">{figure.value}</span>
          </div>
        )}
      </div>

      {progress !== null && (
        <div className="duty-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}
          aria-label="Shift elapsed">
          <div className="duty-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {variant === 'home' ? (
        <div className="duty-actions">
          <button className="btn btn-primary" onClick={onOpenQueue}>
            <span>Open queue</span><ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="duty-actions">
          {onLogJob && (
            <button className="btn btn-primary" onClick={onLogJob} disabled={disabled}>
              <Plus size={16} /><span>{logLabel || 'Log a job'}</span>
            </button>
          )}
          {onTestChime && (
            <button className="btn btn-outline-night" onClick={onTestChime}>
              <Volume2 size={16} /><span>Test chime</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}
