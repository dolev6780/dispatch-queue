import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore'

// Generate a random client session ID to identify the current station/tab
export const CLIENT_ID = 'client_' + Math.random().toString(36).substring(2, 9)


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
  isAuthenticated: false,
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
 * in-app config entry and no offline mode: the app is a single shared board,
 * so a station that is not talking to Firestore is broken, not running in a
 * valid alternative mode.
 *
 * There is no local copy of the board at all. A disconnected station shows
 * the connection gate instead of stale data, because on a wall display a
 * stale queue and a live one look exactly the same.
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

// ---------------------------------------------------------------------------
// Anonymous authentication
//
// Every station signs in anonymously so Firestore rules can require
// `request.auth != null`, which shuts out direct API traffic from anything
// that is not this app (scripts, scanners, curl). It is invisible to users —
// the work-ID gate is still what decides who may edit.
//
// It is deliberately FAIL-SOFT. If the Anonymous provider is not enabled in
// the Firebase Console this resolves to null and the board keeps working,
// because the deployed rules still allow unauthenticated writes. Only after
// the provider is enabled should signedIn() in firestore.rules be tightened —
// doing it the other way round takes the board down. See `npm run auth:check`.
// ---------------------------------------------------------------------------
let authReadyPromise = null

const ensureAnonymousAuth = (app) => {
  if (authReadyPromise) return authReadyPromise

  authReadyPromise = (async () => {
    try {
      const auth = getAuth(app)
      if (auth.currentUser) return auth.currentUser
      const credential = await signInAnonymously(auth)
      connectionState = { ...connectionState, isAuthenticated: true }
      notifyStatusListeners()
      return credential.user
    } catch (err) {
      // auth/operation-not-allowed or auth/configuration-not-found means the
      // provider is not switched on yet. Not fatal while the rules are open.
      console.warn('Anonymous sign-in unavailable:', err?.code || err)
      connectionState = { ...connectionState, isAuthenticated: false }
      notifyStatusListeners()
      return null
    }
  })()

  return authReadyPromise
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
    // Firestore is the only source of truth. With no connection there is
    // nothing to show, so deliver nothing and leave the status reporting the
    // fault — the UI blocks rather than pretending to work from a local copy.
    return () => {}
  }

  // Sign in before attaching the listener. Once the rules require auth, a
  // listener attached first would be rejected before the token arrives.
  // The caller still gets its unsubscribe function synchronously.
  let cancelled = false
  ensureAnonymousAuth(currentApp).then(() => {
    if (cancelled) return
    attachSnapshot()
  })

  const returnUnsubscribe = () => {
    cancelled = true
    if (activeUnsubscribe) {
      activeUnsubscribe()
      activeUnsubscribe = null
    }
  }

  const stateDocRef = doc(db, 'dispatch_queue', 'shared_state')

  function attachSnapshot () {
  activeUnsubscribe = onSnapshot(
    stateDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        // Document does not exist yet in Firestore: auto-seed with local or default state
        // Seed from the shipped defaults, not from anything stored locally.
        const seedData = { ...initialDefaults }
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

      // No local fallback. Showing a stale copy on a wall display is worse
      // than showing nothing, because stale and live look identical. The UI
      // blocks on the error status instead.
    }
  )
  }

  return returnUnsubscribe
}

let saveTimeout = null

/**
 * Save dispatch state to Firestore.
 *
 * There is no local write path: if Firestore is unreachable the change is not
 * saved anywhere, and the caller is told so. The UI blocks editing while
 * disconnected, so this should not be reachable in practice.
 */
export const saveDispatchState = (statePatch) => {
  if (!currentDb) {
    return Promise.resolve(false)
  }

  // Debounce remote writes slightly to avoid thrashing on rapid UI drags
  return new Promise((resolve) => {
    if (saveTimeout) clearTimeout(saveTimeout)

    saveTimeout = setTimeout(async () => {
      try {
        // Wait for the anonymous session so the write carries a token once the
        // rules require one. Resolves immediately (to null) while the provider
        // is still switched off.
        await ensureAnonymousAuth(currentApp)
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
