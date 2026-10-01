/**
 * The automation agent on THIS PC (tools/nblab-automation.ps1), reached on
 * 127.0.0.1. It answers only this website, and only on this PC. The website
 * hands it the site's automation and this PC's two printers; it listens to the
 * folder, prints, and prints on request from the Print card.
 *
 * Chrome asks once whether this website may reach devices on this PC: the
 * answer must be Allow. A page opened over plain http from another PC (the
 * relay) cannot reach it at all.
 */

export const AGENT_PORT = 47815
export const AGENT_ORIGIN = `http://127.0.0.1:${AGENT_PORT}`

/** Set once this PC's agent has answered, so other pages keep it up to date. */
export const SEEN_KEY = 'nblab-agent-seen'

const call = async (path, { method = 'GET', json, body, timeout = 5000 } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(AGENT_ORIGIN + path, {
      method,
      headers: json ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/octet-stream' } : undefined,
      body: json ? JSON.stringify(json) : body,
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `The agent on this PC answered ${response.status}.`)
    return data
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('The agent on this PC did not answer in time.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Who it is, this PC's printers, what it listens to, and the files it handled lately. */
export const agentStatus = () => call('/status', { timeout: 2500 })

/** Save this PC's printers and/or the site's automation on the agent. */
export const agentSetup = (payload) => call('/setup', { method: 'POST', json: payload })

/** Hand a file to the agent: it reads it and says its type and what it would print. */
export const agentRead = (file) =>
  call(`/read?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, timeout: 60000 })

/** What a file the agent holds would print as the given type. */
export const agentPlan = (id, type) =>
  call(`/plan?id=${encodeURIComponent(id)}${type ? `&type=${encodeURIComponent(type)}` : ''}`, { timeout: 30000 })

/**
 * Print. { id, type, what: 'all' | 'receipt' | 'sticker' | 'document', file?, lines? }
 * A form needs no file: { what: 'document', file: 'LDO.pdf' }.
 */
export const agentPrint = (request) => call('/print', { method: 'POST', json: request, timeout: 120000 })

/** Does the agent need the site's automation (again)? */
export const needsAutomation = (info, revision) =>
  !!info && !!revision && Number(info.automationRevision || 0) !== Number(revision)
