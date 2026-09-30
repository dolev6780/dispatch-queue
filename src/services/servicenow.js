/**
 * ServiceNow tasks handed to this page by the lab PC's watcher script
 * (tools/servicenow-watcher.user.js) — pure, tested.
 *
 * The watcher runs in this same browser and posts a snapshot with
 * window.postMessage. Nothing here stores it: it lives in memory while the
 * page is open. The page trusts nothing in it — every field is cut to size
 * and only https links survive.
 */

export const WATCHER_SOURCE = 'nblab-servicenow-watcher'
export const APP_SOURCE = 'nblab-app'

/** No news from the watcher for this long means its ServiceNow tab is closed. */
export const STALE_AFTER_MS = 3 * 60 * 1000

const text = (value, max) => String(value ?? '').slice(0, max)

const httpsUrl = (value) => {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** A snapshot from a message, cleaned up — or null if it is not one. */
export const readSnapshot = (data) => {
  if (!data || data.source !== WATCHER_SOURCE) return null
  const snap = data.snapshot
  if (!snap || typeof snap !== 'object') return null
  const tasks = Array.isArray(snap.tasks)
    ? snap.tasks.slice(0, 50).map(task => ({
        id: text(task?.id, 64),
        number: text(task?.number, 40),
        title: text(task?.title, 200),
        priority: text(task?.priority, 40),
        opened: text(task?.opened, 40),
        url: httpsUrl(task?.url)
      }))
    : []
  const count = Number(snap.count)
  return {
    count: Number.isFinite(count) && count >= 0 ? count : tasks.length,
    tasks,
    groups: Array.isArray(snap.groups) ? snap.groups.slice(0, 10).map(group => text(group, 80)) : [],
    listUrl: httpsUrl(snap.listUrl),
    checkedAt: Number(snap.checkedAt) || 0,
    okAt: Number(snap.okAt) || 0,
    error: snap.error ? text(snap.error, 200) : null
  }
}

/** live — fresh and fine; error — the watcher reports a problem; stale — no news. */
export const snapshotState = (snapshot, nowMs) => {
  if (!snapshot) return 'none'
  if (nowMs - snapshot.checkedAt > STALE_AFTER_MS) return 'stale'
  return snapshot.error ? 'error' : 'live'
}

/** "10:41" out of ServiceNow's display date, whatever its date format. */
export const openedTime = (opened) => {
  const match = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(String(opened || ''))
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
}

/** Priority 1 and 2 stand out. */
export const isUrgent = (priority) => /^\s*[12]\b/.test(String(priority || ''))
