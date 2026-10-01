import { useEffect, useState } from 'react'
import { watchAutomations } from '../services/db'

/**
 * A site's dispatch automations, live, by name. Tagged with the site they
 * came from, so a site switch never shows one site's list under another's.
 */
export const useAutomations = ({ siteId, canRead }) => {
  const [state, setState] = useState({ siteId: null, list: [], error: null })

  useEffect(() => {
    if (!canRead || !siteId) return undefined
    return watchAutomations(siteId,
      (list) => setState({ siteId, list, error: null }),
      (err) => setState({ siteId, list: [], error: err?.message || 'Could not read the automations.' }))
  }, [siteId, canRead])

  const current = canRead && state.siteId === siteId ? state : null
  return {
    automations: current ? [...current.list].sort((a, b) => String(a.name).localeCompare(String(b.name))) : [],
    loaded: !!current,
    error: current?.error || null
  }
}
