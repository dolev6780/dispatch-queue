import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  watchSiteWorkers,
  watchState,
  runDailyReset,
  writeQueueDay,
  addToQueueDay,
  removeFromQueueDay,
  writeDaySchedule,
  EMPTY_STATE
} from '../services/db'
import { DISPATCH_QUEUE } from '../services/features'
import { toDateKey, resolveDailyReset } from '../services/dailyReset'
import { moveById } from '../services/queueOps'
import { workersAt } from '../services/roles'

const RETRY_MS = [2000, 5000, 15000, 30000]
const RESET_RETRY_MS = 60000

/**
 * Live dispatch-queue data for one site.
 *
 * Three states matter, and the previous version could not tell them apart:
 *   isLoaded — the SERVER has answered for both the people and the board.
 *              A snapshot served from the local cache does not count: at an
 *              offline boot an empty cache used to look like an empty board.
 *   isStale  — loaded earlier, but currently disconnected or erroring.
 *              Editing is blocked while stale, because an edit from a stale
 *              copy is exactly how boards get overwritten.
 *   canWrite — loaded, live, and allowed to use this site.
 *
 * Workers are accounts: the site's residents and its temporary visitors are
 * both watched, and who is actually working here is worked out against `now`,
 * so a temporary move that ends at midnight takes effect without any write.
 */
export const useDispatchQueue = ({ siteId, canUse, uid, now }) => {
  const [people, setPeople] = useState({ residents: [], visitors: [] })
  const [state, setState] = useState(EMPTY_STATE)
  const [workersLive, setWorkersLive] = useState(null) // null = never heard from server
  const [stateLive, setStateLive] = useState(null)
  const [stateMissing, setStateMissing] = useState(false)
  const [error, setError] = useState(null)
  const resetAttemptRef = useRef(null)

  const todayDayIndex = now.getDay()
  const todayDateKey = toDateKey(now)

  // Recomputed each tick; cheap for a site's worth of people.
  const workers = useMemo(
    () => workersAt(siteId, people.residents, people.visitors, now),
    [siteId, people, now]
  )

  // ---- Subscriptions --------------------------------------------------------
  //
  // The set-state-in-effect rule is disabled deliberately: this effect
  // synchronises with Firestore listeners and must clear the previous site's
  // data when the site or session changes — leaving it would show one site's
  // board under another site's name.
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    setPeople({ residents: [], visitors: [] })
    setState(EMPTY_STATE)
    setWorkersLive(null)
    setStateLive(null)
    setStateMissing(false)
    setError(null)
    resetAttemptRef.current = null

    if (!canUse || !siteId) return

    let active = true
    const timers = new Set()
    const stops = { workers: null, state: null }

    const retry = (name, attemptRef, start) => {
      const delay = RETRY_MS[Math.min(attemptRef.n, RETRY_MS.length - 1)]
      attemptRef.n += 1
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (active) start()
      }, delay)
      timers.add(timer)
    }

    const workersAttempt = { n: 0 }
    const startWorkers = () => {
      stops.workers = watchSiteWorkers(siteId,
        (lists, { fromCache }) => {
          if (!active) return
          setPeople(lists)
          if (!fromCache) { workersAttempt.n = 0; setError(null) }
          // Once the server has answered, a later cache-only snapshot means
          // the connection dropped: stale, not unloaded.
          setWorkersLive(prev => (fromCache ? (prev === null ? null : false) : true))
        },
        (err) => {
          if (!active) return
          setError(err?.message || 'Could not read the workers for this site.')
          setWorkersLive(prev => (prev === null ? null : false))
          retry('workers', workersAttempt, startWorkers)
        })
    }

    const stateAttempt = { n: 0 }
    const startState = () => {
      stops.state = watchState(siteId, DISPATCH_QUEUE,
        (next, { fromCache, missing }) => {
          if (!active) return
          setState(next)
          if (!fromCache) { stateAttempt.n = 0; setStateMissing(missing); setError(null) }
          setStateLive(prev => (fromCache ? (prev === null ? null : false) : true))
        },
        (err) => {
          if (!active) return
          setError(err?.message || 'Could not read the queue for this site.')
          setStateLive(prev => (prev === null ? null : false))
          retry('state', stateAttempt, startState)
        })
    }

    startWorkers()
    startState()

    return () => {
      active = false
      timers.forEach(clearTimeout)
      if (stops.workers) stops.workers()
      if (stops.state) stops.state()
    }
  }, [siteId, canUse])
  /* oxlint-enable react/set-state-in-effect */

  const isLoaded = workersLive !== null && stateLive !== null
  const isStale = isLoaded && (workersLive === false || stateLive === false)
  const canWrite = !!(canUse && siteId && uid && isLoaded && !isStale)

  // ---- Daily reset ------------------------------------------------------------
  //
  // Only from live server data, at most once per date per station, and via a
  // transaction that re-reads the server — never from this station's copy.
  useEffect(() => {
    if (!canWrite) return
    if (resetAttemptRef.current === todayDateKey) return

    const { action } = resolveDailyReset({
      isStateLoaded: true,
      lastResetDate: stateMissing ? null : state.lastResetDate,
      todayDateKey
    })
    if (action === 'none' && !stateMissing) return

    resetAttemptRef.current = todayDateKey
    runDailyReset(siteId, DISPATCH_QUEUE, { todayDateKey, todayIndex: todayDayIndex, uid })
      .catch((err) => {
        console.warn('Daily reset failed; will retry:', err?.code || err)
        // Back off rather than hammering a rule that refuses us.
        setTimeout(() => {
          if (resetAttemptRef.current === todayDateKey) resetAttemptRef.current = null
        }, RESET_RETRY_MS)
      })
  }, [canWrite, state.lastResetDate, stateMissing, todayDateKey, todayDayIndex, siteId, uid])

  // ---- Mutations ----------------------------------------------------------------
  const guard = useCallback(async (work) => {
    if (!canWrite) {
      setError('Not connected — changes are paused until the board reconnects.')
      return
    }
    try {
      await work()
    } catch (err) {
      setError(err?.message || 'Could not save the change.')
    }
  }, [canWrite])

  const toggle = useCallback((day, id) => guard(() => {
    const list = state.dayQueues[day] || []
    return list.includes(id)
      ? removeFromQueueDay(siteId, DISPATCH_QUEUE, day, id, uid)
      : addToQueueDay(siteId, DISPATCH_QUEUE, day, [id], uid)
  }), [guard, state.dayQueues, siteId, uid])

  const move = useCallback((day, id, direction, visibleIds) => guard(() => {
    const list = state.dayQueues[day] || []
    const next = moveById(list, visibleIds, id, direction)
    if (next === list) return undefined
    return writeQueueDay(siteId, DISPATCH_QUEUE, day, next, uid)
  }), [guard, state.dayQueues, siteId, uid])

  // arrayUnion appends only the ids not already present, in order — the
  // existing hand-set order survives and concurrent adds both land.
  const addAll = useCallback((day, ids) => guard(() =>
    ids.length ? addToQueueDay(siteId, DISPATCH_QUEUE, day, ids, uid) : undefined
  ), [guard, siteId, uid])

  const clear = useCallback((day) => guard(() =>
    writeQueueDay(siteId, DISPATCH_QUEUE, day, [], uid)
  ), [guard, siteId, uid])

  const setDaySchedule = useCallback((day, schedule) => guard(() =>
    writeDaySchedule(siteId, DISPATCH_QUEUE, day, schedule, uid)
  ), [guard, siteId, uid])

  return {
    todayDayIndex,
    workers,
    dayQueues: state.dayQueues,
    daySchedules: state.daySchedules,
    isLoaded,
    isStale,
    canWrite,
    error,
    clearError: () => setError(null),
    actions: { toggle, move, addAll, clear, setDaySchedule }
  }
}
