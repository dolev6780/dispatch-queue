import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  deleteUser
} from 'firebase/auth'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  deleteField
} from 'firebase/firestore'
import { getFirebaseAuth, getDb, withSecondaryAuth } from './firebase'
import { wwidToCredentials } from './credentials'
import { toSlug } from './queueOps'
import { DISPATCH_QUEUE } from './features'

/**
 * Authentication and user profiles.
 *
 * Firebase Auth holds the credential; Firestore holds the profile
 * (users/{uid}: name, role, siteId, siteAdmin, isGlobalAdmin, active, and an
 * optional temporary move). Every account is also a WORKER at its site. The
 * rules read the profile to decide everything, so an account without one can
 * do nothing at all.
 *
 * Nothing derived from the WWID is stored — not the WWID, not a hint. It is
 * the whole credential, and profiles are visible to colleagues at the site.
 */

export const USERS = 'users'
const BOOTSTRAP = ['config', 'bootstrap']

/**
 * Keep the session across browser restarts, so the wall display can be signed
 * in once and stay signed in through reboots.
 */
export const initPersistence = async () => {
  const auth = getFirebaseAuth()
  if (!auth) return
  try {
    await setPersistence(auth, browserLocalPersistence)
  } catch (err) {
    console.warn('Could not set auth persistence:', err?.code || err)
  }
}

export const watchAuth = (callback) => {
  const auth = getFirebaseAuth()
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

/**
 * Watch the signed-in user's profile.
 *
 * A live listener rather than a one-off read, for two reasons found in review:
 * a read that failed while the wall display booted offline was previously
 * reported as "no profile" and never retried; and promotions, demotions and
 * revocations never reached a running session. The listener fixes both — it
 * delivers the document when the connection returns, and every later change.
 *
 * `fromCache` is passed through so the caller never concludes "this account
 * has no profile" from an empty local cache.
 */
export const watchProfile = (uid, onChange, onError) => {
  const db = getDb()
  if (!db || !uid) return () => {}
  return onSnapshot(
    doc(db, USERS, uid),
    { includeMetadataChanges: true },
    (snapshot) => onChange(
      snapshot.exists() ? { uid, ...snapshot.data() } : null,
      { fromCache: snapshot.metadata.fromCache }
    ),
    onError
  )
}

export const isBootstrapClaimed = async () => {
  const db = getDb()
  if (!db) return true
  const snapshot = await getDoc(doc(db, ...BOOTSTRAP))
  return snapshot.exists()
}

const friendlyError = (err) => {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'That work ID was not recognised.'
    case 'auth/email-already-in-use':
      return 'That work ID already has an account.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'No connection to the server.'
    case 'permission-denied':
      return 'You do not have permission to do that.'
    default:
      return err?.message || 'Something went wrong.'
  }
}

export const signInWithWwid = async (wwid) => {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase is not configured.')
  const credentials = await wwidToCredentials(wwid)
  if (!credentials) throw new Error('Enter your work ID.')

  try {
    const result = await signInWithEmailAndPassword(auth, credentials.email, credentials.password)
    return result.user
  } catch (err) {
    throw new Error(friendlyError(err))
  }
}

export const signOut = async () => {
  const auth = getFirebaseAuth()
  if (auth) await firebaseSignOut(auth)
}

/**
 * First-time setup: create the first global administrator and the first site.
 *
 * The profile, the site and the bootstrap marker go in ONE batch — the rules
 * tie them together with getAfter — so setup either happens completely or not
 * at all. If the batch is refused, the just-created Auth account is deleted
 * again so the WWID is not left taken by an account with no profile.
 */
export const createFirstAdmin = async ({ wwid, name, siteName, siteLocation }) => {
  const auth = getFirebaseAuth()
  const db = getDb()
  if (!auth || !db) throw new Error('Firebase is not configured.')

  const siteId = toSlug(siteName)
  if (!siteId) throw new Error('Give the site a name.')

  const credentials = await wwidToCredentials(wwid)
  if (!credentials) throw new Error('Enter a work ID.')

  let user
  try {
    const result = await createUserWithEmailAndPassword(auth, credentials.email, credentials.password)
    user = result.user
  } catch (err) {
    throw new Error(friendlyError(err))
  }

  try {
    const batch = writeBatch(db)
    batch.set(doc(db, 'sites', siteId), {
      name: siteName.trim(),
      location: (siteLocation || '').trim(),
      createdAt: serverTimestamp()
    })
    batch.set(doc(db, USERS, user.uid), {
      name: name.trim(),
      role: 'Administrator',
      siteId,
      siteAdmin: true,
      isGlobalAdmin: true,
      active: true,
      createdAt: serverTimestamp()
    })
    batch.set(doc(db, ...BOOTSTRAP), {
      claimedBy: user.uid,
      claimedAt: serverTimestamp()
    })
    await batch.commit()
  } catch (err) {
    try {
      await deleteUser(user)
    } catch {
      console.error('Setup failed and the new account could not be removed.')
    }
    throw new Error(friendlyError(err))
  }

  return user
}

/**
 * Create an account — which is also a new worker at that site.
 *
 * Runs on an in-memory secondary app so the administrator stays signed in. The
 * profile is written through the PRIMARY app, so the write carries the
 * administrator's credentials, which is what the rules check. If the profile
 * write is refused, the new Auth account is deleted again.
 */
export const createUserAccount = async ({ wwid, name, role, siteId, siteAdmin = false, isGlobalAdmin = false }) => {
  const db = getDb()
  if (!db) throw new Error('Firebase is not configured.')
  if (!siteId) throw new Error('Choose a site.')

  const credentials = await wwidToCredentials(wwid)
  if (!credentials) throw new Error('Enter a work ID.')

  return withSecondaryAuth(async (secondaryAuth) => {
    let created
    try {
      created = await createUserWithEmailAndPassword(secondaryAuth, credentials.email, credentials.password)
    } catch (err) {
      throw new Error(friendlyError(err))
    }

    try {
      const batch = writeBatch(db)
      batch.set(doc(db, USERS, created.user.uid), {
        name: name.trim(),
        role: (role || '').trim() || 'Member',
        siteId,
        siteAdmin: !!siteAdmin,
        isGlobalAdmin: !!isGlobalAdmin,
        active: true,
        createdAt: serverTimestamp()
      })
      await batch.commit()
    } catch (err) {
      try {
        await deleteUser(created.user)
      } catch {
        console.error('Orphaned auth account for a new user.')
      }
      throw new Error(friendlyError(err))
    }

    return created.user.uid
  })
}

/**
 * Migrate a pre-sites database into its first site.
 *
 * Profiles created before sites existed have no siteId and may hold the
 * plaintext WWID. This moves the signed-in global admin and every other
 * pre-sites account into a new site — where they become its workers — and
 * strips the plaintext WWIDs, all in one batch so it cannot half-apply.
 *
 * The old separate "people" list is not copied: workers are accounts now. The
 * custom shift hours are kept.
 */
export const migrateToFirstSite = async ({ uid, siteName, siteLocation }) => {
  const db = getDb()
  if (!db) throw new Error('Firebase is not configured.')

  const siteId = toSlug(siteName)
  if (!siteId) throw new Error('Give the site a name.')

  const existingSite = await getDoc(doc(db, 'sites', siteId))
  if (existingSite.exists()) throw new Error('A site with that name already exists.')

  const [users, oldPeople, state] = await Promise.all([
    getDocs(collection(db, USERS)),
    getDocs(collection(db, 'features', DISPATCH_QUEUE, 'workers')),
    getDoc(doc(db, 'features', DISPATCH_QUEUE, 'state', 'current'))
  ])

  const batch = writeBatch(db)

  batch.set(doc(db, 'sites', siteId), {
    name: siteName.trim(),
    location: (siteLocation || '').trim(),
    createdAt: serverTimestamp()
  })

  for (const snapshot of users.docs) {
    const data = snapshot.data()
    if (data.siteId) continue
    const wasAdmin = data.isAdmin === true || snapshot.id === uid
    batch.update(snapshot.ref, {
      siteId,
      siteAdmin: wasAdmin,
      isGlobalAdmin: wasAdmin,
      active: data.active !== false,
      wwid: deleteField(),
      wwidHint: deleteField(),
      isAdmin: deleteField(),
      updatedAt: serverTimestamp()
    })
  }

  if (state.exists()) {
    const { daySchedules } = state.data()
    if (daySchedules) {
      batch.set(doc(db, 'sites', siteId, 'features', DISPATCH_QUEUE, 'state', 'current'), {
        daySchedules,
        lastResetDate: null,
        updatedBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    }
  }

  await batch.commit()

  // Best effort: the old copies are unreachable to everyone but a global
  // admin, so a failure here leaves harmless leftovers, not exposure.
  const cleanup = writeBatch(db)
  oldPeople.docs.forEach(person => cleanup.delete(person.ref))
  if (state.exists()) cleanup.delete(state.ref)
  cleanup.delete(doc(db, 'features', DISPATCH_QUEUE))
  await cleanup.commit().catch(err => console.warn('Old data cleanup failed:', err?.code || err))

  return siteId
}
