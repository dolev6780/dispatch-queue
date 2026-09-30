import { useState } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Dialog } from './Dialog'
import { BASE_DAYS_META, DEFAULT_DAY_SCHEDULES, formatDuration, timeStringToMinutes } from '../services/schedule'

const sameSchedule = (a, b) =>
  !!a.isWorkDay === !!b.isWorkDay && a.startTime === b.startTime && a.endTime === b.endTime

/**
 * The site's shift hours for the whole week. Each working day's window is
 * split equally between everyone in that day's queue. Only the days that
 * changed are written, one field each, so two people editing different days
 * never overwrite each other.
 */
export const HoursDialog = ({ daySchedules, focusDay, queueCounts, onSave, onClose }) => {
  const [draft, setDraft] = useState(() => Object.fromEntries(
    BASE_DAYS_META.map(meta => {
      const stored = daySchedules?.[meta.key] || DEFAULT_DAY_SCHEDULES[meta.key]
      return [meta.key, { isWorkDay: !!stored.isWorkDay, startTime: stored.startTime, endTime: stored.endTime }]
    })
  ))
  const [busy, setBusy] = useState(false)

  const set = (day, patch) => setDraft(current => ({ ...current, [day]: { ...current[day], ...patch } }))

  const invalidDays = BASE_DAYS_META.filter(meta => {
    const day = draft[meta.key]
    return day.isWorkDay && timeStringToMinutes(day.endTime) <= timeStringToMinutes(day.startTime)
  })

  const changes = BASE_DAYS_META
    .filter(meta => !sameSchedule(draft[meta.key], daySchedules?.[meta.key] || DEFAULT_DAY_SCHEDULES[meta.key]))
    .map(meta => ({ day: meta.key, schedule: draft[meta.key] }))

  const submit = async (event) => {
    event.preventDefault()
    if (invalidDays.length > 0) return
    if (changes.length === 0) { onClose(); return }
    setBusy(true)
    await onSave(changes)
    setBusy(false)
    onClose()
  }

  return (
    <Dialog
      title="Shift hours"
      subtitle="Each working day's hours are split equally between everyone in that day's queue."
      onClose={onClose}
      onSubmit={submit}
      wide
      labelId="hours-dialog-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost dialog-foot-start"
            onClick={() => setDraft(Object.fromEntries(BASE_DAYS_META.map(m => [m.key, { ...DEFAULT_DAY_SCHEDULES[m.key] }])))}>
            <RotateCcw size={15} /><span>Defaults</span>
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || invalidDays.length > 0}>
            {busy ? 'Saving…' : changes.length > 0 ? `Save ${changes.length} ${changes.length === 1 ? 'day' : 'days'}` : 'Save'}
          </button>
        </>
      )}
    >
      <div className="hours">
        {BASE_DAYS_META.map(meta => {
          const day = draft[meta.key]
          const minutes = timeStringToMinutes(day.endTime) - timeStringToMinutes(day.startTime)
          const count = queueCounts?.[meta.key] || 0
          const bad = day.isWorkDay && minutes <= 0
          return (
            <div key={meta.key} className={`hours-row ${meta.key === focusDay ? 'is-focus' : ''} ${day.isWorkDay ? '' : 'is-off'}`}>
              <span className="hours-day">{meta.name}</span>
              <button
                type="button"
                className={`switch ${day.isWorkDay ? 'is-on' : ''}`}
                role="switch"
                aria-checked={day.isWorkDay}
                aria-label={`${meta.name} is a working day`}
                onClick={() => set(meta.key, { isWorkDay: !day.isWorkDay })}
              >
                <span className="switch-knob" />
              </button>
              {day.isWorkDay ? (
                <>
                  <input type="time" className={`input is-time ${bad ? 'is-bad' : ''}`} value={day.startTime}
                    aria-label={`${meta.name} start`} onChange={e => set(meta.key, { startTime: e.target.value })} />
                  <span className="hours-dash">–</span>
                  <input type="time" className={`input is-time ${bad ? 'is-bad' : ''}`} value={day.endTime}
                    aria-label={`${meta.name} end`} onChange={e => set(meta.key, { endTime: e.target.value })} />
                  <span className="hours-each">
                    {bad ? 'End before start' : count > 0 ? `${formatDuration(minutes / count)} each · ${count}` : formatDuration(minutes)}
                  </span>
                </>
              ) : (
                <span className="hours-offtext">Day off</span>
              )}
            </div>
          )
        })}
      </div>
      {invalidDays.length > 0 && (
        <p className="alert" role="alert">
          <AlertCircle size={16} />
          <span>The end time must be after the start time on {invalidDays.map(m => m.name).join(', ')}.</span>
        </p>
      )}
    </Dialog>
  )
}
