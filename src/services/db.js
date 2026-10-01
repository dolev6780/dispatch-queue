import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
  arrayUnion,
  arrayRemove,
  deleteField,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore'
import { getDb } from './firebase'
import { DEFAULT_DAY_SCHEDULES } from './schedule'
import { resolveDailyReset } from './dailyReset'
import { toSlug } from './queueOps'
import { USERS } from './authService'
import { DISPATCH_QUEUE, WORK_PROCESSES, DISPATCH_AUTOMATION } from './features'
import { cleanSteps } from './processes'
import { cleanAutomation, cleanAgentSettings } from './automation'

/**
 * Firestore data layer — everything is scoped to a site.
 *
 *   users/{uid}                                     accounts = WORKERS (siteId = home)
 *   sites/{siteId}                                  name, location
 *   sites/{siteId}/features/{featureId}/state/current   the board
 *   sites/{siteId}/features/dispatch-queue/jobs/{jobId}    jobs
 *   sites/{siteId}/features/work-processes/processes/{id}  work processes
 *   sites/{siteId}/features/dispatch-automation/automations/{id}  what lab PCs print
 *
 * Every account is a worker at its site. The queue draws on the people who
 * work at the site today: its residents, minus anyone temporarily away, plus
 * anyone temporarily here (see roles.workersAt).
 *
 * WRITE DISCIPLINE — the lessons of two incidents and a review:
 *   - Never send the whole week. Every queue or hours edit writes only the
 *     day it touches, so two stations editing different days cannot overwrite
 *     each other, and a station holding a stale copy cannot roll the others
 *     back. setDoc({merge:true}) deep-merges maps, so {dayQueues:{3:[...]}}
 *     replaces day 3 and nothing else.
 *   - Adding and removing single people uses arrayUnion/arrayRemove, which
 *     commute: two people adding different names to the same day both land.
 *   - The daily reset runs in a transaction that reads the server copy. A
 *     transaction cannot commit offline or on a stale read, so a laptop waking
 *     from sleep cannot push last week's board over today's.
 */

export const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6']

export const EMPTY_QUEUES = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }

export const EMPTY_STATE = {
  dayQueues: EMPTY_QUEUES,
  daySchedules: DEFAULT_DAY_SCHEDULES,
  lastResetDate: null
}

const requireDb = () => {
  const db = getDb()
  if (!db) throw new Error('Not connected.')
  return db
}

const featurePath = (siteId, featureId) => ['sites', siteId, 'features', featureId]
const stateRef = (db, siteId, featureId) => doc(db, ...featurePath(siteId, featureId), 'state', 'current')

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/** Every site. Global admins only — the rules refuse anyone else. */
export const watchSites = (onChange, onError) => {
  const db = getDb()
  if (!db) return () => {}
  return onSnapshot(
    query(collection(db, 'sites'), orderBy('name', 'asc')),
    (snapshot) => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  )
}

export const watchSite = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    doc(db, 'sites', siteId),
    (snapshot) => onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError
  )
}

export const createSite = async ({ name, location }) => {
  const db = requireDb()
  const siteId = toSlug(name)
  if (!siteId) throw new Error('Give the site a name.')

  // setDoc would silently replace an existing site of the same name.
  const existing = await getDoc(doc(db, 'sites', siteId))
  if (existing.exists()) throw new Error('A site with that name already exists.')

  await setDoc(doc(db, 'sites', siteId), {
    name: name.trim(),
    location: (location || '').trim(),
    createdAt: serverTimestamp()
  })
  return siteId
}

export const updateSite = (siteId, patch) =>
  updateDoc(doc(requireDb(), 'sites', siteId), { ...patch, updatedAt: serverTimestamp() })

/**
 * Delete a site and everything under it.
 *
 * Refuses while any account lives at the site OR is temporarily moved there —
 * those people would otherwise be signed in to a site that no longer exists.
 * Firestore does not cascade, so the site's subcollections are removed
 * explicitly, including superseded worker documents.
 */
export const deleteSite = async (siteId, featureIds) => {
  const db = requireDb()

  const [residents, visitors] = await Promise.all([
    getDocs(query(collection(db, USERS), where('siteId', '==', siteId))),
    getDocs(query(collection(db, USERS), where('tempSiteId', '==', siteId)))
  ])
  const count = residents.size + visitors.size
  if (count > 0) {
    throw new Error(`Move the ${count} worker(s) at or visiting this site elsewhere first.`)
  }

  const batch = writeBatch(db)
  for (const featureId of featureIds) {
    const legacyWorkers = await getDocs(collection(db, ...featurePath(siteId, featureId), 'workers'))
    legacyWorkers.docs.forEach(worker => batch.delete(worker.ref))
    batch.delete(stateRef(db, siteId, featureId))
  }
  const [jobs, processes, automations] = await Promise.all([
    getDocs(jobsCollection(db, siteId)),
    getDocs(processesCollection(db, siteId)),
    getDocs(automationsCollection(db, siteId))
  ])
  jobs.docs.forEach(job => batch.delete(job.ref))
  processes.docs.forEach(process => batch.delete(process.ref))
  automations.docs.forEach(automation => batch.delete(automation.ref))
  batch.delete(agentSettingsRef(db, siteId))
  batch.delete(doc(db, 'sites', siteId))
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Workers — accounts, read by site
// ---------------------------------------------------------------------------

/**
 * Watch everyone who could be working at a site: its residents and its
 * temporary visitors. Two queries, because those are the two shapes the rules
 * can prove; the caller works out who is actually here today with
 * roles.workersAt, so a move that expires at midnight is reflected without any
 * write.
 *
 * `fromCache` is true until BOTH queries have heard from the server.
 */
export const watchSiteWorkers = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}

  const latest = { residents: null, visitors: null }
  const emit = () => {
    if (!latest.residents || !latest.visitors) return
    onChange(
      { residents: latest.residents.list, visitors: latest.visitors.list },
      { fromCache: latest.residents.fromCache || latest.visitors.fromCache }
    )
  }
  const listen = (key, field) => onSnapshot(
    query(collection(db, USERS), where(field, '==', siteId)),
    { includeMetadataChanges: true },
    (snapshot) => {
      latest[key] = {
        // `id` is what the queue stores; for workers it is the account uid.
        list: snapshot.docs.map(d => ({ ...d.data(), id: d.id, uid: d.id })),
        fromCache: snapshot.metadata.fromCache
      }
      emit()
    },
    onError
  )

  const stops = [listen('residents', 'siteId'), listen('visitors', 'tempSiteId')]
  return () => stops.forEach(stop => stop())
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * Watch the board. `fromCache` is passed through so the caller can refuse to
 * treat a local cache as the truth — an empty cache at an offline boot used to
 * count as "loaded" and quietly skip the day's reset.
 */
export const watchState = (siteId, featureId, onChange, onError) => {
  const db = getDb()
  if (!db) return () => {}
  return onSnapshot(
    stateRef(db, siteId, featureId),
    { includeMetadataChanges: true },
    (snapshot) => {
      const meta = { fromCache: snapshot.metadata.fromCache, missing: !snapshot.exists() }
      if (!snapshot.exists()) {
        onChange({ ...EMPTY_STATE }, meta)
        return
      }
      const data = snapshot.data()
      onChange({
        dayQueues: { ...EMPTY_QUEUES, ...(data.dayQueues || {}) },
        daySchedules: { ...DEFAULT_DAY_SCHEDULES, ...(data.daySchedules || {}) },
        lastResetDate: data.lastResetDate || null
      }, meta)
    },
    onError
  )
}

const stamp = (uid) => ({ updatedBy: uid, updatedAt: serverTimestamp() })

/** Replace ONE day's queue (used for reordering and clearing). */
export const writeQueueDay = (siteId, featureId, day, ids, uid) =>
  setDoc(stateRef(requireDb(), siteId, featureId), {
    dayQueues: { [String(day)]: ids },
    ...stamp(uid)
  }, { merge: true })

/** Add people to one day without disturbing anyone else's edit. */
export const addToQueueDay = (siteId, featureId, day, ids, uid) =>
  setDoc(stateRef(requireDb(), siteId, featureId), {
    dayQueues: { [String(day)]: arrayUnion(...ids) },
    ...stamp(uid)
  }, { merge: true })

export const removeFromQueueDay = (siteId, featureId, day, id, uid) =>
  setDoc(stateRef(requireDb(), siteId, featureId), {
    dayQueues: { [String(day)]: arrayRemove(id) },
    ...stamp(uid)
  }, { merge: true })

/** Change ONE day's shift hours. */
export const writeDaySchedule = (siteId, featureId, day, schedule, uid) =>
  setDoc(stateRef(requireDb(), siteId, featureId), {
    daySchedules: { [String(day)]: schedule },
    ...stamp(uid)
  }, { merge: true })

/**
 * Empty today's queue once per calendar day.
 *
 * Reads the server copy inside a transaction and only acts if the stored date
 * is strictly earlier than today, then touches ONLY today's list by field
 * path. Two stations racing at midnight both run this; the second sees the
 * first's date and does nothing.
 */
export const runDailyReset = (siteId, featureId, { todayDateKey, todayIndex, uid }) => {
  const db = requireDb()
  const ref = stateRef(db, siteId, featureId)

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)

    if (!snapshot.exists()) {
      transaction.set(ref, {
        dayQueues: EMPTY_QUEUES,
        daySchedules: DEFAULT_DAY_SCHEDULES,
        lastResetDate: todayDateKey,
        createdAt: serverTimestamp(),
        ...stamp(uid)
      })
      return 'created'
    }

    const { action } = resolveDailyReset({
      isStateLoaded: true,
      lastResetDate: snapshot.data().lastResetDate || null,
      todayDateKey
    })

    if (action === 'none') return 'none'

    if (action === 'adopt') {
      transaction.update(ref, { lastResetDate: todayDateKey, ...stamp(uid) })
      return 'adopt'
    }

    transaction.update(ref, {
      [`dayQueues.${todayIndex}`]: [],
      lastResetDate: todayDateKey,
      ...stamp(uid)
    })
    return 'reset'
  })
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Accounts at one site. The siteId filter is what lets the rules prove a site
 * admin is only listing their own people.
 */
export const watchSiteUsers = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    query(collection(db, USERS), where('siteId', '==', siteId)),
    (snapshot) => onChange(snapshot.docs.map(d => ({ uid: d.id, ...d.data() }))),
    onError
  )
}

/** Every account. Global admins only — used to count each site's workers. */
export const watchAllUsers = (onChange, onError) => {
  const db = getDb()
  if (!db) return () => {}
  return onSnapshot(
    collection(db, USERS),
    (snapshot) => onChange(snapshot.docs.map(d => ({ uid: d.id, ...d.data() }))),
    onError
  )
}

/**
 * Edit a profile. Always strips `wwidHint`: profiles are shared with
 * colleagues now, so nothing derived from the credential may stay on them.
 */
export const updateUser = (uid, patch) =>
  updateDoc(doc(requireDb(), USERS, uid), {
    ...patch,
    wwidHint: deleteField(),
    updatedAt: serverTimestamp()
  })

/**
 * Move a worker temporarily. `endsAt` is the instant they are home again —
 * local midnight after their last day (roles.endOfLastDay).
 */
export const moveTemporarily = (uid, tempSiteId, endsAt) =>
  updateUser(uid, { tempSiteId, tempEndsAt: Timestamp.fromDate(endsAt) })

/** End a temporary move now. */
export const endTemporaryMove = (uid) =>
  updateUser(uid, { tempSiteId: deleteField(), tempEndsAt: deleteField() })

/**
 * Move a worker permanently. Any temporary move is cleared. `keepSiteAdmin`
 * must be false when a site admin does it — the rules refuse otherwise, so a
 * site admin cannot plant an administrator in another site.
 */
export const movePermanently = (uid, siteId, keepSiteAdmin) =>
  updateUser(uid, {
    siteId,
    siteAdmin: !!keepSiteAdmin,
    tempSiteId: deleteField(),
    tempEndsAt: deleteField()
  })

/**
 * Revoke an account by removing its profile.
 *
 * Without a profile the rules refuse every read and write, so access ends
 * immediately — and because only an administrator can create a profile, the
 * person cannot restore it themselves. The Firebase Auth sign-in itself
 * survives (deleting another user's sign-in needs the Admin SDK on a server),
 * so the WWID stays taken until it is removed in the Firebase Console.
 */
export const deleteUserProfile = (uid) => deleteDoc(doc(requireDb(), USERS, uid))

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const jobsCollection = (db, siteId) => collection(db, ...featurePath(siteId, DISPATCH_QUEUE), 'jobs')

/**
 * Open jobs at a site. No orderBy — combined with the status filter it would
 * need a composite index; the caller sorts. `fromCache` is passed through so
 * the caller never treats a cached snapshot as the list that exists "now"
 * (that would make every already-open job ring as new once the server answers).
 */
export const watchOpenJobs = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    query(jobsCollection(db, siteId), where('status', '==', 'open')),
    { includeMetadataChanges: true },
    // A job just logged here has no server time yet; the estimate shows its
    // time straight away instead of a blank.
    (snapshot) => onChange(
      snapshot.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })),
      { fromCache: snapshot.metadata.fromCache }
    ),
    onError
  )
}

/** Jobs finished since `since` — a single-field range, so no index needed. */
export const watchJobsDoneSince = (siteId, since, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    query(jobsCollection(db, siteId), where('doneAt', '>=', Timestamp.fromDate(since))),
    (snapshot) => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    onError
  )
}

/**
 * `process` is jobs.processFields(...) — an exact copy of the work process
 * for this job type, which the rules check against the process itself.
 */
export const createJob = (siteId, { type, note, assigneeId, assigneeName, createdBy, createdByName, process }) =>
  addDoc(jobsCollection(requireDb(), siteId), {
    type,
    ...(note && note.trim() ? { note: note.trim() } : {}),
    assigneeId,
    assigneeName: String(assigneeName || '').slice(0, 80),
    createdBy,
    createdByName: String(createdByName || '').slice(0, 80),
    createdAt: serverTimestamp(),
    status: 'open',
    ...(process || {})
  })

/** Tick or untick a job's process steps: the whole list, same length. */
export const setJobChecks = (siteId, jobId, checks) =>
  updateDoc(doc(jobsCollection(requireDb(), siteId), jobId), { checks })

/** Open -> done: the only change the rules allow on a job. */
export const completeJob = (siteId, jobId, uid) =>
  updateDoc(doc(jobsCollection(requireDb(), siteId), jobId), {
    status: 'done',
    doneBy: uid,
    doneAt: serverTimestamp()
  })

export const deleteJob = (siteId, jobId) => deleteDoc(doc(jobsCollection(requireDb(), siteId), jobId))

// ---------------------------------------------------------------------------
// Work processes
// ---------------------------------------------------------------------------

const processesCollection = (db, siteId) => collection(db, ...featurePath(siteId, WORK_PROCESSES), 'processes')

/** A site's work processes, live. */
export const watchProcesses = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    processesCollection(db, siteId),
    (snapshot) => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  )
}

const processData = ({ title, jobType, steps, notes }, uid) => ({
  title: String(title || '').trim(),
  jobType: jobType || '',
  steps: cleanSteps(steps),
  notes: String(notes || '').trim(),
  updatedBy: uid,
  updatedAt: serverTimestamp()
})

/** Create a process (no id) or replace its content (with id). Returns the id. */
export const saveProcess = async (siteId, processId, values, uid) => {
  const db = requireDb()
  if (processId) {
    await updateDoc(doc(processesCollection(db, siteId), processId), processData(values, uid))
    return processId
  }
  const ref = doc(processesCollection(db, siteId))
  await setDoc(ref, { ...processData(values, uid), createdAt: serverTimestamp() })
  return ref.id
}

/** Open jobs keep their own copy of the steps, so deleting is always safe. */
export const deleteProcess = (siteId, processId) =>
  deleteDoc(doc(processesCollection(requireDb(), siteId), processId))

// ---------------------------------------------------------------------------
// Dispatch automation
// ---------------------------------------------------------------------------

const automationsCollection = (db, siteId) => collection(db, ...featurePath(siteId, DISPATCH_AUTOMATION), 'automations')

/** A site's dispatch automations, live. */
export const watchAutomations = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(
    automationsCollection(db, siteId),
    (snapshot) => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  )
}

/** Create an automation (no id) or replace its content (with id). Returns the id. */
export const saveAutomation = async (siteId, automationId, values, uid) => {
  const db = requireDb()
  const data = { ...cleanAutomation(values), updatedBy: uid, updatedAt: serverTimestamp() }
  if (automationId) {
    await updateDoc(doc(automationsCollection(db, siteId), automationId), data)
    return automationId
  }
  const ref = doc(automationsCollection(db, siteId))
  await setDoc(ref, { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export const deleteAutomation = (siteId, automationId) =>
  deleteDoc(doc(automationsCollection(requireDb(), siteId), automationId))

const agentSettingsRef = (db, siteId) => doc(db, ...featurePath(siteId, DISPATCH_AUTOMATION), 'settings', 'agent')

/** The site's settings for the lab-PC agents, live; null until set. */
export const watchAgentSettings = (siteId, onChange, onError) => {
  const db = getDb()
  if (!db || !siteId) return () => {}
  return onSnapshot(agentSettingsRef(db, siteId), (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null), onError)
}

export const saveAgentSettings = (siteId, values, uid) =>
  setDoc(agentSettingsRef(requireDb(), siteId), { ...cleanAgentSettings(values), updatedBy: uid, updatedAt: serverTimestamp() })
