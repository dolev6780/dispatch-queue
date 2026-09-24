/**
 * Shift scheduling domain logic.
 *
 * Pure functions only — no React, no Firebase — so the arithmetic that decides
 * who is on duty can be unit tested without mounting the app or waiting for a
 * particular time of day.
 */

// Base metadata for all 7 weekdays
export const BASE_DAYS_META = [
  { key: 0, name: 'Sunday', short: 'Sun', isSunday: true },
  { key: 1, name: 'Monday', short: 'Mon', isSunday: false },
  { key: 2, name: 'Tuesday', short: 'Tue', isSunday: false },
  { key: 3, name: 'Wednesday', short: 'Wed', isSunday: false },
  { key: 4, name: 'Thursday', short: 'Thu', isSunday: false },
  { key: 5, name: 'Friday', short: 'Fri', isSunday: false },
  { key: 6, name: 'Saturday', short: 'Sat', isSunday: false }
]

// Sunday 08:00–15:30, Monday–Thursday 08:00–16:30, Friday & Saturday off.
export const DEFAULT_DAY_SCHEDULES = {
  0: { isWorkDay: true, startTime: '08:00', endTime: '15:30' },
  1: { isWorkDay: true, startTime: '08:00', endTime: '16:30' },
  2: { isWorkDay: true, startTime: '08:00', endTime: '16:30' },
  3: { isWorkDay: true, startTime: '08:00', endTime: '16:30' },
  4: { isWorkDay: true, startTime: '08:00', endTime: '16:30' },
  5: { isWorkDay: false, startTime: '08:00', endTime: '16:30' },
  6: { isWorkDay: false, startTime: '08:00', endTime: '16:30' }
}

export const SHIFT_PRESETS = [
  { label: '08:00 – 16:30 (Standard)', start: '08:00', end: '16:30' },
  { label: '08:00 – 15:30 (Sunday)', start: '08:00', end: '15:30' },
  { label: '08:00 – 14:00 (Short Day)', start: '08:00', end: '14:00' },
  { label: '07:00 – 15:30 (Early Shift)', start: '07:00', end: '15:30' },
  { label: '09:00 – 17:30 (9-to-5)', start: '09:00', end: '17:30' },
  { label: '12:00 – 20:00 (Evening Shift)', start: '12:00', end: '20:00' }
]

/** "HH:MM" -> minutes from midnight. */
export const timeStringToMinutes = (timeStr) => {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Minutes from midnight -> "HH:MM". */
export const formatTime = (totalMins) => {
  const h = Math.floor(totalMins / 60)
  const m = Math.floor(totalMins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const formatDuration = (mins, forceHours = true) => {
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0 && !forceHours) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export const formatTimeRemaining = (mins) => {
  const total = Math.max(0, Math.ceil(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export const formatClockTime = (date, includeSeconds = true) =>
  date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false
  })

/** Minutes from midnight for a Date, including seconds as a fraction. */
export const minutesSinceMidnight = (date) =>
  date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60

/** Merge stored schedules over the weekday metadata. */
export const buildDaysOfWeek = (daySchedules = {}) =>
  BASE_DAYS_META.map(meta => {
    const stored = daySchedules[meta.key] || DEFAULT_DAY_SCHEDULES[meta.key]
    const isWorkDay = !!stored.isWorkDay
    const startTime = stored.startTime || '08:00'
    const endTime = stored.endTime || '16:30'
    const startMins = timeStringToMinutes(startTime)
    const endMins = timeStringToMinutes(endTime)
    const def = DEFAULT_DAY_SCHEDULES[meta.key]

    return {
      ...meta,
      isWorkDay,
      startTime,
      endTime,
      startMins,
      endMins,
      totalMinutes: isWorkDay ? Math.max(0, endMins - startMins) : 0,
      hours: isWorkDay ? `${startTime} – ${endTime}` : 'Non-Working Day',
      isCustom:
        stored.isWorkDay !== def.isWorkDay ||
        stored.startTime !== def.startTime ||
        stored.endTime !== def.endTime
    }
  })

/**
 * Split a day's shift equally between the queued people.
 *
 * The final slot is pinned to the day's end time rather than computed, so
 * rounding never leaves a gap or overrun at the end of the day.
 *
 * @param {object}  params
 * @param {object}  params.day         A day from buildDaysOfWeek().
 * @param {Array}   params.people      Queued people, in order.
 * @param {number}  params.nowMinutes  Current minutes from midnight.
 * @param {boolean} params.isToday     Is this day the live day?
 */
export const buildSchedule = ({ day, people, nowMinutes, isToday }) => {
  if (!day || !day.isWorkDay || people.length === 0) return []

  const count = people.length
  const perPerson = day.totalMinutes / count

  return people.map((person, index) => {
    const startMins = Math.round(day.startMins + index * perPerson)
    const endMins =
      index === count - 1
        ? day.endMins
        : Math.round(day.startMins + (index + 1) * perPerson)

    const durationMins = endMins - startMins

    let status = 'scheduled'
    let progressPercent = 0
    let remainingMinutes = 0

    if (isToday) {
      if (nowMinutes >= startMins && nowMinutes < endMins) {
        status = 'serving'
        progressPercent = Math.min(100, Math.max(0, ((nowMinutes - startMins) / durationMins) * 100))
        remainingMinutes = Math.max(0, Math.ceil(endMins - nowMinutes))
      } else if (nowMinutes >= endMins) {
        status = 'completed'
        progressPercent = 100
      } else if (index === 0 || nowMinutes >= Math.round(day.startMins + (index - 1) * perPerson)) {
        status = 'up-next'
      }
    } else {
      status = index === 0 ? 'up-next' : 'scheduled'
    }

    return {
      ...person,
      position: index + 1,
      startMins,
      endMins,
      startTimeStr: formatTime(startMins),
      endTimeStr: formatTime(endMins),
      durationStr: formatDuration(durationMins),
      status,
      progressPercent,
      remainingMinutes
    }
  })
}
