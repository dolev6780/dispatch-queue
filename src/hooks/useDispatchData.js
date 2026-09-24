import { useEffect, useMemo, useRef, useState } from 'react'
import {
  subscribeToDispatchState,
  saveDispatchState,
  getLocalCachedState
} from '../services/firebase'
import { toDateKey, resolveDailyReset } from '../services/dailyReset'
import { DEFAULT_DAY_SCHEDULES } from '../services/schedule'

// Master team roster with Iris accent tones
export const INITIAL_ROSTER = [
  { id: '1', name: 'Komer', role: 'Dispatch Specialist', color: '#818cf8' },
  { id: '2', name: 'Alen', role: 'Dispatch Specialist', color: '#a78bfa' },
  { id: '3', name: 'Dani', role: 'Dispatch Specialist', color: '#60a5fa' },
  { id: '4', name: 'Yair', role: 'Dispatch Specialist', color: '#c084fc' },
  { id: '5', name: 'Chen', role: 'Dispatch Specialist', color: '#e879f9' },
  { id: '6', name: 'Dolev', role: 'Dispatch Specialist', color: '#6366f1' }
]

export const INITIAL_DAY_QUEUES = {
  0: ['1', '2', '3', '4', '5', '6'],
  1: ['1', '2', '3', '4', '5', '6'],
  2: ['1', '2', '3', '4', '5', '6'],
  3: ['1', '2', '3', '4', '5', '6'],
  4: ['1', '2', '3', '4', '5', '6'],
  5: [],
  6: []
}

const SYNC_DEFAULTS = {
  roster: INITIAL_ROSTER,
  dayQueues: INITIAL_DAY_QUEUES,
  daySchedules: DEFAULT_DAY_SCHEDULES
}

/**
 * Owns everything that is shared between stations: the live clock, the synced
 * roster/queues/schedules, the once-per-day queue reset, and the day rollover.
 *
 * Kept in one hook so both the Queue page and the full-screen board read the
 * same state and every station stays in step.
 */
export const useDispatchData = () => {
  const [currentTime, setCurrentTime] = useState(() => new Date())

  const cachedInitial = useMemo(() => getLocalCachedState(SYNC_DEFAULTS), [])

  const [roster, setRoster] = useState(cachedInitial.roster)
  const [dayQueues, setDayQueues] = useState(cachedInitial.dayQueues)
  const [daySchedules, setDaySchedules] = useState(cachedInitial.daySchedules)
  const [lastResetDate, setLastResetDate] = useState(cachedInitial.lastResetDate)

  // True once the first state (remote or cached) has arrived. The daily reset
  // waits on this so a station opening mid-morning cannot clear a queue
  // another station already built for today.
  const [isStateLoaded, setIsStateLoaded] = useState(false)

  const isRemoteUpdateRef = useRef(false)
  const isInitialMountRef = useRef(true)

  // Live clock. Everything time-derived hangs off this, so a display left
  // running overnight notices the date change.
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const todayDayIndex = currentTime.getDay()
  const todayDateKey = toDateKey(currentTime)

  const applyRemoteState = (remoteState) => {
    // Mark loaded even for our own echo, so the daily reset is never left
    // waiting on a snapshot that only ever comes back as self.
    setIsStateLoaded(true)
    if (remoteState._fromSelf) return

    isRemoteUpdateRef.current = true
    if (remoteState.roster) setRoster(remoteState.roster)
    if (remoteState.dayQueues) setDayQueues(remoteState.dayQueues)
    if (remoteState.daySchedules) setDaySchedules(remoteState.daySchedules)
    if (remoteState.lastResetDate) setLastResetDate(remoteState.lastResetDate)
  }

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = subscribeToDispatchState(applyRemoteState, SYNC_DEFAULTS)
    return () => unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist local mutations
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      return
    }
    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false
      return
    }
    saveDispatchState({ roster, dayQueues, daySchedules, lastResetDate })
  }, [roster, dayQueues, daySchedules, lastResetDate])

  // Daily queue reset — empty today's queue once per calendar day. Emptying is
  // idempotent, so two stations open at midnight converge rather than fight.
  //
  // The set-state-in-effect rule is disabled deliberately: this synchronises
  // with two external systems (the wall clock crossing midnight and the shared
  // Firestore document) and the reset must be persisted, so it cannot be
  // derived during render. The decision lives in services/dailyReset.js and is
  // unit tested.
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    const { action, date } = resolveDailyReset({ isStateLoaded, lastResetDate, todayDateKey })
    if (action === 'wait' || action === 'none') return

    if (action === 'reset') {
      setDayQueues(current => ({ ...current, [todayDayIndex]: [] }))
    }
    setLastResetDate(date)
  }, [isStateLoaded, lastResetDate, todayDateKey, todayDayIndex])
  /* oxlint-enable react/set-state-in-effect */

  return {
    currentTime,
    todayDayIndex,
    todayDateKey,
    roster,
    setRoster,
    dayQueues,
    setDayQueues,
    daySchedules,
    setDaySchedules,
    isStateLoaded
  }
}
