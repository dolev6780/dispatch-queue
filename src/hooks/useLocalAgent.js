import { useCallback, useEffect, useRef, useState } from 'react'
import { SEEN_KEY, agentPlan, agentPrint, agentRead, agentSetup, agentStatus, needsAutomation } from '../services/localAgent'
import { agentPayload } from '../services/automation'

const remembered = () => {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

/**
 * The automation agent on this PC. On the Automation page it is checked every
 * few seconds; on other pages only where it has answered before, once a
 * minute — so a PC without it is never asked, and one with it always gets the
 * site's newest automation, whatever page is open.
 */
export const useLocalAgent = ({ active, automation, revision, siteId, siteName }) => {
  const [state, setState] = useState({ status: 'idle', info: null, error: '' })
  const [seen, setSeen] = useState(remembered)
  const pushing = useRef(false)
  const misses = useRef(0)
  const enabled = active || seen

  const refresh = useCallback(async () => {
    try {
      let info = await agentStatus()
      if (!seen) {
        try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private window */ }
        setSeen(true)
      }
      if (automation && needsAutomation(info, revision) && !pushing.current) {
        pushing.current = true
        try {
          info = await agentSetup(agentPayload(automation, { revision, site: { id: siteId, name: siteName } }))
        } finally {
          pushing.current = false
        }
      }
      misses.current = 0
      setState({ status: 'ready', info, error: '' })
      return info
    } catch (err) {
      // The agent may be busy for a moment (a file still downloading): only
      // say it is missing after a few checks in a row.
      misses.current += 1
      const missing = { status: 'missing', info: null, error: err?.message || '' }
      setState(current => (current.info && misses.current < 3 ? current : missing))
      return null
    }
  }, [automation, revision, siteId, siteName, seen])

  useEffect(() => {
    if (!enabled) return undefined
    let stopped = false
    const tick = () => { if (!stopped) refresh() }
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, active ? 5000 : 60000)
    return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
  }, [enabled, active, refresh])

  const setPrinters = useCallback(async (printers) => {
    const info = await agentSetup({ printers })
    setState({ status: 'ready', info, error: '' })
  }, [])

  // After a file is read or printed, the agent's list of recent files changed.
  const read = useCallback(async (file) => {
    const plan = await agentRead(file)
    refresh()
    return plan
  }, [refresh])

  const print = useCallback(async (request) => {
    const result = await agentPrint(request)
    refresh()
    return result
  }, [refresh])

  return { ...state, refresh, setPrinters, read, plan: agentPlan, print }
}
