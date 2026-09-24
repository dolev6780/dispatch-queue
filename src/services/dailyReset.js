/**
 * Daily queue reset policy.
 *
 * Kept as a pure module so the decision can be unit tested without waiting
 * for a real midnight. App.jsx only wires the result to state.
 */

/**
 * Local calendar date key, "YYYY-MM-DD".
 *
 * Built from local date parts rather than toISOString(), which reports the
 * UTC date and would roll the day over at the wrong local hour (in UTC+3
 * that would fire at 03:00 local, not midnight).
 */
export const toDateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Decide what the daily reset should do right now.
 *
 * @param {object}  params
 * @param {boolean} params.isStateLoaded  Has the first synced/cached state arrived?
 * @param {?string} params.lastResetDate  Date key of the last reset, or null/undefined if never.
 * @param {string}  params.todayDateKey   Date key for the current local day.
 * @returns {{action: 'wait'|'none'|'adopt'|'reset', date?: string}}
 *
 *  wait  — state has not loaded yet; do nothing, so a station opening
 *          mid-morning cannot clear a queue another station already built.
 *  none  — already reset today.
 *  adopt — never reset before; record today's date WITHOUT clearing, so
 *          enabling the feature never wipes a queue already set up.
 *  reset — a new day has begun; empty today's queue and record the date.
 */
export const resolveDailyReset = ({ isStateLoaded, lastResetDate, todayDateKey }) => {
  if (!isStateLoaded) return { action: 'wait' }
  if (lastResetDate === todayDateKey) return { action: 'none' }
  if (!lastResetDate) return { action: 'adopt', date: todayDateKey }
  return { action: 'reset', date: todayDateKey }
}
