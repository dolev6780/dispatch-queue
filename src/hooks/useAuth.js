import { useCallback, useEffect, useState } from 'react'
import { watchAuth, watchProfile, initPersistence, signOut as doSignOut } from '../services/authService'

/**
 * Current session: the Firebase user plus their live Firestore profile.
 *
 * profileStatus distinguishes four things the previous version conflated:
 *   loading — waiting for the server (NEVER shown as "no profile")
 *   loaded  — profile present
 *   missing — the server confirmed there is no profile
 *   error   — the read failed; retried automatically
 *
 * Conflating "failed" with "missing" is what stranded a rebooting wall display
 * on a "this account has no profile" screen whose only button signed it out.
 * Conflating "loading" with "missing" flashed that same screen on every
 * sign-in.
 */
const RETRY_MS = [2000, 5000, 15000, 30000]

export const useAuth = () => {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileStatus, setProfileStatus] = useState('idle')
  const [profileError, setProfileError] = useState(null)

  // ---- Firebase Auth --------------------------------------------------------
  useEffect(() => {
    let active = true
    let unsubscribe = null

    const start = async () => {
      // Persistence first, so a restored session is not briefly reported as
      // signed out — that would flash the landing page on every wall reboot.
      await initPersistence()
      if (!active) return
      unsubscribe = watchAuth((firebaseUser) => {
        if (!active) return
        // Anonymous sessions belong to an earlier release; they carry no
        // profile and can do nothing, so drop them rather than strand the
        // browser on an error screen.
        if (firebaseUser?.isAnonymous) {
          doSignOut()
          return
        }
        // Set the user and mark the profile as loading in the SAME update, so
        // no render ever sees "signed in, profile unknown" as "missing".
        setUser(firebaseUser)
        setProfile(null)
        setProfileError(null)
        setProfileStatus(firebaseUser ? 'loading' : 'idle')
        setAuthReady(true)
      })
    }
    start()

    return () => {
      active = false
      if (unsubscribe) unsubscribe()
    }
  }, [])

  // ---- Profile listener, with retry ----------------------------------------
  const uid = user?.uid || null

  useEffect(() => {
    if (!uid) return

    let active = true
    let stop = null
    let attempt = 0
    let retryTimer = null

    const subscribe = () => {
      stop = watchProfile(
        uid,
        (data, { fromCache }) => {
          if (!active) return
          if (data) {
            attempt = 0
            setProfile(data)
            setProfileError(null)
            setProfileStatus('loaded')
          } else if (!fromCache) {
            // Only the SERVER can say a profile does not exist.
            setProfile(null)
            setProfileStatus('missing')
          }
          // Missing from an empty local cache: keep waiting for the server.
        },
        (err) => {
          if (!active) return
          setProfileError(err?.message || 'Could not load your account.')
          setProfileStatus(current => (current === 'loaded' ? 'loaded' : 'error'))
          // A Firestore listener is dead after an error — resubscribe.
          const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]
          attempt += 1
          retryTimer = setTimeout(() => {
            if (active) subscribe()
          }, delay)
        }
      )
    }

    subscribe()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      if (stop) stop()
    }
  }, [uid])

  const signOut = useCallback(async () => {
    await doSignOut()
  }, [])

  return {
    user,
    authReady,
    profile,
    profileStatus,
    profileError,
    isSignedIn: !!user,
    hasProfile: profileStatus === 'loaded' && !!profile,
    signOut
  }
}
