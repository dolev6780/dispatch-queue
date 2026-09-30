import { useEffect, useState } from 'react'
import { APP_SOURCE, readWatcherMessage } from '../services/servicenow'

/**
 * The lab PC's ServiceNow watcher, if it runs in this browser:
 *   present  — the watcher answered here
 *   version  — which version of it
 *   snapshot — the latest unassigned tasks, or null until a ServiceNow tab
 *              in this browser has reported
 * Held in memory only — never stored, never sent anywhere. On any station
 * without the watcher, `present` stays false and nothing is shown.
 */
export const useServiceNowBridge = () => {
  const [bridge, setBridge] = useState({ present: false, version: '', snapshot: null })

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return
      const message = readWatcherMessage(event.data)
      if (message) setBridge({ present: true, ...message })
    }
    window.addEventListener('message', onMessage)
    // In case the watcher started first: ask for what it has.
    window.postMessage({ source: APP_SOURCE, type: 'servicenow:hello' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return bridge
}
