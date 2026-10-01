import { useEffect, useState } from 'react'
import { watchTemplates } from '../services/db'
import { sortTemplates } from '../services/emails'

/**
 * A site's email templates, live, by name. Tagged with the site they came
 * from, so a site switch never shows one site's list under another's.
 */
export const useEmailTemplates = ({ siteId, canRead }) => {
  const [state, setState] = useState({ siteId: null, list: [], error: null })

  useEffect(() => {
    if (!canRead || !siteId) return undefined
    return watchTemplates(siteId,
      (list) => setState({ siteId, list, error: null }),
      (err) => setState({ siteId, list: [], error: err?.message || 'Could not read the email templates.' }))
  }, [siteId, canRead])

  const current = canRead && state.siteId === siteId ? state : null
  return {
    templates: current ? sortTemplates(current.list) : [],
    loaded: !!current,
    error: current?.error || null
  }
}
