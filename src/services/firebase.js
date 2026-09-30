import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app'
import { getAuth, initializeAuth, inMemoryPersistence, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

/**
 * Firebase bootstrap.
 *
 * Configuration comes from VITE_FIREBASE_* only — there is no in-app config
 * screen and no offline mode. A station that cannot reach Firestore is broken,
 * not running an alternative, so the UI blocks rather than showing stale data.
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

export const isFirebaseConfigured = () =>
  !!(firebaseConfig.apiKey && firebaseConfig.projectId)

export const PROJECT_ID = firebaseConfig.projectId || null

let app = null

export const getFirebaseApp = () => {
  if (!isFirebaseConfigured()) return null
  if (app) return app
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  return app
}

export const getFirebaseAuth = () => {
  const instance = getFirebaseApp()
  return instance ? getAuth(instance) : null
}

export const getDb = () => {
  const instance = getFirebaseApp()
  return instance ? getFirestore(instance) : null
}

/**
 * A throwaway second Firebase app, used only to create accounts.
 *
 * createUserWithEmailAndPassword signs in as the account it just made. Doing
 * that on the main app would kick the administrator out of their own session
 * midway through adding a colleague, so account creation runs on an isolated
 * instance that is torn down immediately afterwards.
 *
 * In-memory persistence, so the new account's refresh token is never written
 * to the administrator's browser storage — not even if teardown fails.
 */
export const withSecondaryAuth = async (work) => {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.')
  const name = `secondary-${Date.now()}`
  const secondaryApp = initializeApp(firebaseConfig, name)
  const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence })
  try {
    return await work(secondaryAuth)
  } finally {
    try {
      await signOut(secondaryAuth)
    } catch {
      // Already signed out, or never signed in.
    }
    try {
      await deleteApp(secondaryApp)
    } catch {
      // Nothing useful to do if teardown fails.
    }
  }
}
