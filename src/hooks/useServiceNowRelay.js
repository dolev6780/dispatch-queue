import { useEffect, useState } from 'react'
import { RELAY_POLL_MS, WATCHER_SOURCE, readSnapshot } from '../services/servicenow'

/**
 * The ServiceNow list from the main PC's relay (tools/servicenow-relay.mjs),
 * when this page was opened from it — http://<main PC>:8787/.
 *
 * The relay answers only signed-in NBLAB users, so every request carries the
 * user's Firebase sign-in token. The list is held in memory here, like the
 * relay itself holds it: never stored, never sent to Firebase. `isRelay`
 * comes from useRelayInfo; on the normal website it is false and this stays
 * quiet.
 */
export const useServiceNowRelay = (user, isRelay) => {
  const [state, setState] = useState({ snapshot: null, denied: false })

  useEffect(() => {
    if (!isRelay || !user) return undefined
    let active = true
    let timer = null
    const poll = async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch('api/servicenow', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        if (!active) return
        if (res.ok) {
          const body = await res.json()
          const snapshot = body?.snapshot ? readSnapshot({ source: WATCHER_SOURCE, snapshot: body.snapshot }) : null
          setState({ snapshot, denied: false })
        } else {
          setState(prev => ({ ...prev, denied: res.status === 401 || res.status === 403 }))
        }
      } catch {
        // Relay unreachable: keep the last list; it shows as paused on its own.
      }
      if (active) timer = setTimeout(poll, RELAY_POLL_MS)
    }
    poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [isRelay, user])

  return isRelay
    ? { present: true, via: 'relay', version: '', ...state }
    : { present: false, via: 'relay', version: '', snapshot: null, denied: false }
}
