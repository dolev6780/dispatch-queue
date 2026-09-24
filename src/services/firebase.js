import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore'

// Generate a random client session ID to identify the current station/tab
export const CLIENT_ID = 'client_' + Math.random().toString(36).substring(2, 9)

const LOCAL_ROSTER_KEY = 'dispatch_roster_v1'
const LOCAL_DAY_QUEUES_KEY = 'dispatch_day_queues_v1'
const LOCAL_DAY_SCHEDULES_KEY = 'dispatch_day_schedules_v1'
// Calendar date ("YYYY-MM-DD") of the last automatic daily queue reset.
// Shared so that whichever station is open first performs the reset and
// every other station sees it as already done.
const LOCAL_LAST_RESET_KEY = 'dispatch_last_reset_date_v1'

let currentApp = null
let currentDb = null
let activeUnsubscribe = null
let statusListeners = new Set()

let connectionState = {
  // 'unconfigured' now means the build is missing its VITE_FIREBASE_* values,
  // which is a misconfiguration rather than a supported offline mode.
  status: 'unconfigured', // 'unconfigured' | 'connecting' | 'connected' | 'error'
  projectId: null,
  isConfigured: false,
  lastSyncTime: null,
  error: null
}

const notifyStatusListeners = () => {
  statusListeners.forEach(listener => {
    try {
      listener({ ...connectionState })
    } catch (err) {
      console.error('Status listener error:', err)
    }
  })
}

export const onConnectionStatusChange = (listener) => {
  statusListeners.add(listener)
  listener({ ...connectionState })
  return () => statusListeners.delete(listener)
}

export const getConnectionState = () => ({ ...connectionState })

/**
 * Resolve Firebase configuration from the build-time environment.
 *
 * Configuration comes from VITE_FIREBASE_* only. There is deliberately no
 * in-app config entry and no offline-only mode: the app is a single shared
 * board, so a station that is not talking to Firestore is misconfigured
 * rather than running in a valid alternative mode.
 *
 * The localStorage cache below is a different thing and is kept — it is what
 * carries a station through a brief network drop, not a mode.
 */
export const getActiveFirebaseConfig = () => {
  const envConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  }

  if (envConfig.apiKey && envConfig.projectId) {
    return { ...envConfig, _source: 'env' }
  }

  return null
}

/**
 * Initialize Firebase app and Firestore instance safely
 */
export const initFirebase = () => {
  const config = getActiveFirebaseConfig()

  if (!config || !config.apiKey || !config.projectId) {
    connectionState = {
      status: 'unconfigured',
      projectId: null,
      isConfigured: false,
      lastSyncTime: null,
      error: null
    }
    notifyStatusListeners()
    return null
  }

  try {
    connectionState = {
      ...connectionState,
      status: 'connecting',
      projectId: config.projectId,
      isConfigured: true,
      error: null
    }
    notifyStatusListeners()

    // Initialize or reuse named app
    if (getApps().length > 0) {
      currentApp = getApp()
    } else {
      currentApp = initializeApp(config)
    }

    currentDb = getFirestore(currentApp)
    return currentDb
  } catch (err) {
    console.error('Firebase initialization failed:', err)
    connectionState = {
      status: 'error',
      projectId: config.projectId,
      isConfigured: true,
      lastSyncTime: null,
      error: err.message || 'Initialization error'
    }
    notifyStatusListeners()
    return null
  }
}

/**
 * Read cached local state from localStorage with fallbacks
 */
export const getLocalCachedState = (defaults) => {
  let roster = defaults?.roster || []
  let dayQueues = defaults?.dayQueues || {}
  let daySchedules = defaults?.daySchedules || {}
  let lastResetDate = defaults?.lastResetDate || null

  try {
    const savedRoster = localStorage.getItem(LOCAL_ROSTER_KEY)
    if (savedRoster) roster = JSON.parse(savedRoster)
  } catch {
    // Ignore parse error
  }

  try {
    const savedQueues = localStorage.getItem(LOCAL_DAY_QUEUES_KEY)
    if (savedQueues) dayQueues = JSON.parse(savedQueues)
  } catch {
    // Ignore parse error
  }

  try {
    const savedSchedules = localStorage.getItem(LOCAL_DAY_SCHEDULES_KEY)
    if (savedSchedules) daySchedules = JSON.parse(savedSchedules)
  } catch {
    // Ignore parse error
  }

  try {
    const savedReset = localStorage.getItem(LOCAL_LAST_RESET_KEY)
    if (savedReset) lastResetDate = savedReset
  } catch {
    // Ignore read error
  }

  return { roster, dayQueues, daySchedules, lastResetDate }
}

/**
 * Persist state to local storage cache
 */
export const saveLocalCachedState = (state) => {
  try {
    if (state.roster) localStorage.setItem(LOCAL_ROSTER_KEY, JSON.stringify(state.roster))
    if (state.dayQueues) localStorage.setItem(LOCAL_DAY_QUEUES_KEY, JSON.stringify(state.dayQueues))
    if (state.daySchedules) localStorage.setItem(LOCAL_DAY_SCHEDULES_KEY, JSON.stringify(state.daySchedules))
    if (state.lastResetDate) localStorage.setItem(LOCAL_LAST_RESET_KEY, state.lastResetDate)
  } catch (err) {
    console.warn('Failed to save to local cache:', err)
  }
}

/**
 * Subscribe to real-time dispatch state from Cloud Firestore
 */
export const subscribeToDispatchState = (onStateReceived, initialDefaults) => {
  if (activeUnsubscribe) {
    activeUnsubscribe()
    activeUnsubscribe = null
  }

  const db = initFirebase()

  if (!db) {
    // Deliver local cached state
    const local = getLocalCachedState(initialDefaults)
    onStateReceived({
      ...local,
      _isRemote: false,
      _fromSelf: false
    })
    return () => {}
  }

  const stateDocRef = doc(db, 'dispatch_queue', 'shared_state')

  activeUnsubscribe = onSnapshot(
    stateDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        // Document does not exist yet in Firestore: auto-seed with local or default state
        const seedData = getLocalCachedState(initialDefaults)
        setDoc(stateDocRef, {
          ...seedData,
          updatedBy: CLIENT_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(err => {
          console.warn('Could not auto-seed initial Firestore state:', err)
        })

        connectionState = {
          ...connectionState,
          status: 'connected',
          lastSyncTime: new Date(),
          error: null
        }
        notifyStatusListeners()

        onStateReceived({
          ...seedData,
          _isRemote: true,
          _fromSelf: true
        })
      } else {
        const data = snapshot.data()
        const fromSelf = data.updatedBy === CLIENT_ID

        connectionState = {
          ...connectionState,
          status: 'connected',
          lastSyncTime: new Date(),
          error: null
        }
        notifyStatusListeners()

        // Sync local storage as backup cache
        saveLocalCachedState({
          roster: data.roster,
          dayQueues: data.dayQueues,
          daySchedules: data.daySchedules,
          lastResetDate: data.lastResetDate
        })

        onStateReceived({
          roster: data.roster || initialDefaults.roster,
          dayQueues: data.dayQueues || initialDefaults.dayQueues,
          daySchedules: data.daySchedules || initialDefaults.daySchedules,
          lastResetDate: data.lastResetDate || null,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
          _isRemote: true,
          _fromSelf: fromSelf
        })
      }
    },
    (err) => {
      console.warn('Firestore subscription snapshot error:', err)
      connectionState = {
        ...connectionState,
        status: 'error',
        error: err.message || 'Firestore connection error'
      }
      notifyStatusListeners()

      // Fallback to local cache so the user can continue working seamlessly
      const local = getLocalCachedState(initialDefaults)
      onStateReceived({
        ...local,
        _isRemote: false,
        _fromSelf: false,
        _error: err.message
      })
    }
  )

  return () => {
    if (activeUnsubscribe) {
      activeUnsubscribe()
      activeUnsubscribe = null
    }
  }
}

let saveTimeout = null

/**
 * Save dispatch state remotely to Firestore and locally as fallback
 */
export const saveDispatchState = (statePatch) => {
  // Always update local cache immediately for zero latency
  saveLocalCachedState(statePatch)

  if (!currentDb) {
    return Promise.resolve(false)
  }

  // Debounce remote writes slightly to avoid thrashing on rapid UI drags
  return new Promise((resolve) => {
    if (saveTimeout) clearTimeout(saveTimeout)

    saveTimeout = setTimeout(async () => {
      try {
        const stateDocRef = doc(currentDb, 'dispatch_queue', 'shared_state')
        await setDoc(
          stateDocRef,
          {
            ...statePatch,
            updatedBy: CLIENT_ID,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        )
        connectionState = {
          ...connectionState,
          status: 'connected',
          lastSyncTime: new Date(),
          error: null
        }
        notifyStatusListeners()
        resolve(true)
      } catch (err) {
        console.warn('Failed to save to Firestore:', err)
        connectionState = {
          ...connectionState,
          status: 'error',
          error: err.message
        }
        notifyStatusListeners()
        resolve(false)
      }
    }, 250)
  })
}
