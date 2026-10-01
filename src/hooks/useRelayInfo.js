import { useEffect, useState } from 'react'

/**
 * Was this page opened from the main PC's relay (tools/servicenow-relay.mjs)?
 * And does that relay run the AI assistant? Asked once, when the app starts.
 * On the normal website there is no relay: the check fails and everything
 * relay-based stays out of sight.
 */
export const useRelayInfo = () => {
  const [info, setInfo] = useState({ isRelay: false, ai: false, model: null })

  useEffect(() => {
    let active = true
    fetch('api/servicenow/ping', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (active && body?.relay) setInfo({ isRelay: true, ai: !!body.ai, model: body.model || null })
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  return info
}
