/**
 * Display formatting for the NBLAB design — pure, tested.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const pad = (n) => String(n).padStart(2, '0')

const toDate = (value) => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value.toMillis === 'function') return new Date(value.toMillis())
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  if (typeof value === 'number') return new Date(value)
  return null
}

/** Minutes -> "1:11" (h:mm), the design's time-left format. */
export const formatHM = (minutes) => {
  const total = Math.max(0, Math.ceil(minutes || 0))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** "Monday 28 September" */
export const formatLongDate = (date) =>
  `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`

/** "Mon 28 Sep" */
export const formatMediumDate = (date) =>
  `${WEEKDAYS[date.getDay()].slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`

/** "Thu 1 Oct" from a Date, a Firestore Timestamp, or "YYYY-MM-DD". */
export const formatShortDate = (value) => {
  let date = null
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-').map(Number)
    if (y && m && d) date = new Date(y, m - 1, d)
  } else {
    date = toDate(value)
  }
  return date ? formatMediumDate(date) : ''
}

/** "11:04" — 24-hour clock without seconds. */
export const formatClockHM = (value) => {
  const date = toDate(value)
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '--:--'
}

/** "11:04:32" — the live clock, with seconds. */
export const formatClockHMS = (value) => {
  const date = toDate(value)
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : '--:--:--'
}

/** "L12 · Main lab" — a site's short name and its description. */
export const siteLabel = (site) => {
  if (!site) return ''
  return site.location ? `${site.name} · ${site.location}` : site.name || ''
}

/** "DL" from "Dana Levi". */
export const initialsOf = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

/** "Yossi" from "Yossi Katz". */
export const firstNameOf = (name) => String(name || '').trim().split(/\s+/)[0] || ''
