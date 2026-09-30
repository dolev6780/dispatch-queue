import { useEffect, useState } from 'react'
import { APP_SOURCE, readSnapshot } from '../services/servicenow'

/**
 * Unassigned ServiceNow tasks from the lab PC's watcher script, if it runs in
 * this browser. Held in memory only — never stored, never sent anywhere.
 * Null on any station without the watcher, which then shows nothing.
 */
export const useServiceNowBridge = () => {
  const [snapshot, setSnapshot] = useState(null)

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return
      const next = readSnapshot(event.data)
      if (next) setSnapshot(next)
    }
    window.addEventListener('message', onMessage)
    // In case the watcher started first: ask for what it has.
    window.postMessage({ source: APP_SOURCE, type: 'servicenow:hello' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return snapshot
}
