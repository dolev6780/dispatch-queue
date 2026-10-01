import { useEffect, useMemo, useState } from 'react'
import { watchGrabAndGo } from '../services/db'
import { cleanAutomation } from '../services/automation'

/**
 * The site's one automation (Grab & Go returns), live and cleaned; null until
 * an admin sets it up. `revision` changes with every save, so each PC's agent
 * knows when to take it again.
 */
export const useGrabAndGo = ({ siteId, canRead }) => {
  const [state, setState] = useState({ siteId: null, data: null, error: null })

  useEffect(() => {
    if (!canRead || !siteId) return undefined
    return watchGrabAndGo(siteId,
      (data) => setState({ siteId, data, error: null }),
      (err) => setState({ siteId, data: null, error: err?.message || 'Could not read the automation.' }))
  }, [siteId, canRead])

  const current = canRead && state.siteId === siteId ? state : null
  const data = current?.data || null
  const automation = useMemo(() => (data ? cleanAutomation(data) : null), [data])
  return {
    automation,
    revision: data?.updatedAt?.toMillis?.() || 0,
    loaded: !!current,
    error: current?.error || null
  }
}
