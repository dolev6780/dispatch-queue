import { useEffect, useState } from 'react'
import { watchProcesses } from '../services/db'
import { sortProcesses } from '../services/processes'

/**
 * A site's work processes, live. The result is tagged with the site it came
 * from, so switching site never shows one site's processes under another's
 * name while the new list loads.
 */
export const useProcesses = ({ siteId, canRead }) => {
  const [state, setState] = useState({ siteId: null, list: [], error: null })

  useEffect(() => {
    if (!canRead || !siteId) return undefined
    return watchProcesses(siteId,
      (list) => setState({ siteId, list, error: null }),
      (err) => setState({ siteId, list: [], error: err?.message || 'Could not read the work processes.' }))
  }, [siteId, canRead])

  const current = canRead && state.siteId === siteId ? state : null
  return {
    processes: current ? sortProcesses(current.list) : [],
    loaded: !!current,
    error: current?.error || null
  }
}
