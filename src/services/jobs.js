/**
 * Dispatch jobs — pure definitions and logic (no React, no Firebase).
 *
 * A job is assigned to one worker at a site and stays OPEN — visible on every
 * screen at the site, the wall display included — until it is marked done.
 *
 * The type ids here are also enforced by firestore.rules; keep the two lists
 * in step (the rules test checks every id is accepted).
 */

export const JOB_TYPES = [
  { id: 'pc-refresh', label: 'PC Refresh', color: '#2563eb' },
  { id: 'otr', label: 'OTR', color: '#4f46e5' },
  { id: 'pc-supply', label: 'PC Supply', color: '#7c3aed' },
  { id: 'incident', label: 'Incident', color: '#dc2626' },
  { id: 'quick-it', label: 'Quick IT', color: '#059669' },
  { id: 'ssd-upgrade', label: 'SSD Upgrade', color: '#0e7490' },
  { id: 'ram-upgrade', label: 'RAM Upgrade', color: '#0f766e' },
  { id: 'av-incident', label: 'AV Incident', color: '#db2777' },
  { id: 'av-task', label: 'AV Task', color: '#a21caf' }
]

export const JOB_TYPE_IDS = JOB_TYPES.map(type => type.id)

export const MAX_NOTE_LENGTH = 200

export const jobTypeOf = (id) =>
  JOB_TYPES.find(type => type.id === id) || { id, label: id || 'Job', color: '#4a4c52' }

const toMillis = (value) => {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

/** Check a new job before sending it; returns an error message or null. */
export const validateNewJob = ({ type, assigneeId, note }) => {
  if (!JOB_TYPE_IDS.includes(type)) return 'Choose a job type.'
  if (!assigneeId) return 'Choose who the job is for.'
  if ((note || '').length > MAX_NOTE_LENGTH) return `Keep the note under ${MAX_NOTE_LENGTH} characters.`
  return null
}

/**
 * Oldest first, so the job waiting longest is at the top. A job whose server
 * timestamp has not arrived yet (just created on this station) sorts last.
 */
export const sortOpenJobs = (jobs) =>
  [...jobs].sort((a, b) => (toMillis(a.createdAt) ?? Infinity) - (toMillis(b.createdAt) ?? Infinity))

/**
 * Which jobs in this snapshot have not been seen before?
 *
 * The first snapshot only seeds `knownIds` — jobs already open when a station
 * starts are shown, but do not ring. After that, anything new rings once,
 * even across a reconnect, because `knownIds` survives it.
 */
export const detectNewJobs = (knownIds, jobs, isFirstSnapshot) => {
  const fresh = isFirstSnapshot ? [] : jobs.filter(job => !knownIds.has(job.id))
  const nextKnown = new Set(knownIds)
  jobs.forEach(job => nextKnown.add(job.id))
  return { fresh, nextKnown }
}

/**
 * How a station should react to a new job:
 *   mine  — assigned to me: loud chime + desktop notification
 *   other — someone else's: soft chime + toast
 *   self  — I just created it: nothing, I know
 */
export const alertKindFor = (job, uid) => {
  if (job.createdBy === uid && job.assigneeId !== uid) return 'self'
  return job.assigneeId === uid ? 'mine' : 'other'
}

/**
 * May this person mark the job done? The assignee, whoever created it, or an
 * administrator of the site (mirrors firestore.rules).
 */
export const canCompleteJob = (job, uid, isSiteAdmin) =>
  !!job && job.status === 'open' && !!uid &&
  (job.assigneeId === uid || job.createdBy === uid || !!isSiteAdmin)

/**
 * A job's checklist — the steps of the work process it was logged with, and
 * which are ticked. A job without a process has an empty, complete checklist.
 */
export const checklistOf = (job) => {
  const steps = Array.isArray(job?.steps) ? job.steps : []
  const checks = Array.isArray(job?.checks) ? job.checks : []
  const done = steps.filter((_, index) => checks[index] === true).length
  return { steps, checks, total: steps.length, done, complete: done === steps.length }
}

/** The checklist with one step flipped, always as long as the steps. */
export const toggleCheck = (job, index) => {
  const { steps, checks } = checklistOf(job)
  return steps.map((_, i) => (i === index ? checks[i] !== true : checks[i] === true))
}

/** What a new job carries for its process: an exact copy, nothing ticked. */
export const processFields = (process) => (process
  ? { processId: process.id, processTitle: process.title, steps: [...process.steps], checks: process.steps.map(() => false) }
  : {})

/** Ticking follows the same people as closing: assignee, creator, admin. */
export const canTickJob = (job, uid, isSiteAdmin) =>
  canCompleteJob(job, uid, isSiteAdmin) && checklistOf(job).total > 0

/** Closing needs every step ticked, too (mirrors firestore.rules). */
export const canFinishJob = (job, uid, isSiteAdmin) =>
  canCompleteJob(job, uid, isSiteAdmin) && checklistOf(job).complete

/** Delete is for mistakes: the creator while it is still open, or an admin. */
export const canDeleteJob = (job, uid, isSiteAdmin) =>
  !!job && !!uid && (!!isSiteAdmin || (job.createdBy === uid && job.status === 'open'))

/** "just now", "4 min", "2 h 5 min" — how long a job has been waiting. */
export const waitingFor = (createdAt, now = new Date()) => {
  const created = toMillis(createdAt)
  if (created === null) return 'just now'
  const minutes = Math.max(0, Math.floor((now.getTime() - created) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Local midnight at the start of `now`'s day. */
export const startOfDay = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate())
