import { useEffect, useState } from 'react'
import { watchAgentSettings } from '../services/db'

/** The site's lab-PC agent settings, live; null when none are set yet. */
export const useAgentSettings = ({ siteId, canRead }) => {
  const [state, setState] = useState({ siteId: null, settings: null })

  useEffect(() => {
    if (!canRead || !siteId) return undefined
    return watchAgentSettings(siteId, (settings) => setState({ siteId, settings }), () => setState({ siteId, settings: null }))
  }, [siteId, canRead])

  return canRead && state.siteId === siteId ? state.settings : null
}
