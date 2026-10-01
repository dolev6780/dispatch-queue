#!/usr/bin/env node
/**
 * NBLAB ServiceNow relay — runs on the main lab PC.
 *
 *   node servicenow-relay.mjs            (then leave the window open)
 *   node servicenow-relay.mjs --port 8787 --site l12 --model gemini-2.5-flash
 *
 * The ServiceNow watcher (servicenow-watcher.user.js) on this PC hands the
 * unassigned tasks it sees to this relay. The relay keeps them IN MEMORY only
 * — nothing is written to disk and nothing goes to Firebase — and shows them
 * to the other lab PCs:
 *
 *   - Other PCs open http://<this PC>:8787/ instead of the GitHub Pages
 *     address. The relay serves them the same NBLAB app (fetched from the
 *     live site), and the app adds the ServiceNow list to the Queue page and
 *     the wall display. Browsers do not let an https page read a plain-http
 *     server on another PC, which is why the app itself comes from here too.
 *   - Only signed-in NBLAB users can read the list: every request carries
 *     the user's Firebase sign-in token, which is checked here (signature,
 *     project, expiry) along with their NBLAB profile. Anyone else on the
 *     network gets nothing.
 *   - Only this PC can update the list: updates are accepted from this
 *     machine (127.0.0.1) only.
 *
 * The AI tech assistant
 * ---------------------
 * With a Google Gemini API key on this PC — in a file named gemini.key next
 * to this script, or in the GEMINI_API_KEY environment variable — the relay
 * also answers the app's AI assistant. The key never leaves this PC: the app
 * sends its question here, the relay asks Gemini and returns the answer.
 * Only signed-in NBLAB users can ask, each a limited number of times per ten
 * minutes. Questions and answers are not stored or logged here; what people
 * type does go to Google.
 *
 * Needs Node.js 18 or later; no packages to install.
 */

import http from 'node:http'
import os from 'node:os'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const RELAY_VERSION = '1.1.0'
export const DEFAULTS = {
  port: 8787,
  projectId: 'nblabmanagment',
  appUrl: 'https://dolev6780.github.io/dispatch-queue/',
  // Optional: only people working at this site id may read the list.
  site: '',
  // Gemini model for the AI assistant. The "-latest" alias follows Google's
  // current Flash model, so it does not break when an old one is retired.
  model: 'gemini-flash-latest'
}

const MAX_BODY = 256 * 1024
const PROFILE_CACHE_MS = 5 * 60 * 1000
const APP_CACHE_MS = 60 * 1000
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

// ---- Pure helpers (tested in tools/servicenow-relay.test.mjs) -------------------

/** Is this socket address this machine? */
export const isLoopback = (address) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address || ''))

const base64url = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** Split a JWT into its parts; null if it is not one. */
export const decodeJwt = (token) => {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(base64url(parts[0]).toString('utf8')),
      payload: JSON.parse(base64url(parts[1]).toString('utf8')),
      signed: `${parts[0]}.${parts[1]}`,
      signature: base64url(parts[2])
    }
  } catch {
    return null
  }
}

/**
 * The checks Firebase documents for ID tokens: this project, issued by
 * Firebase, not expired, not from the future, and naming a user.
 * Returns an error message, or null when the claims are fine.
 */
export const checkClaims = (payload, { projectId, nowSec }) => {
  if (!payload || typeof payload !== 'object') return 'no claims'
  if (payload.aud !== projectId) return 'wrong project'
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return 'wrong issuer'
  if (!(payload.exp > nowSec)) return 'expired'
  if (!(payload.iat <= nowSec + 300)) return 'issued in the future'
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) return 'no user'
  return null
}

/**
 * Verify a Firebase ID token. `getCerts()` returns { kid: PEM } — Google's
 * certificates in production, a test key in the tests. Resolves to the uid.
 */
export const verifyIdToken = async (token, { projectId, getCerts, nowSec = Math.floor(Date.now() / 1000) }) => {
  const jwt = decodeJwt(token)
  if (!jwt) throw new Error('not a token')
  if (jwt.header.alg !== 'RS256') throw new Error('wrong algorithm')
  const pem = (await getCerts())[jwt.header.kid]
  if (!pem) throw new Error('unknown key')
  const valid = crypto.verify('RSA-SHA256', Buffer.from(jwt.signed), crypto.createPublicKey(pem), jwt.signature)
  if (!valid) throw new Error('bad signature')
  const problem = checkClaims(jwt.payload, { projectId, nowSec })
  if (problem) throw new Error(problem)
  return jwt.payload.sub
}

/** A Firestore REST document -> the few profile fields the relay needs. */
export const fromFirestoreProfile = (doc) => {
  const fields = doc?.fields || {}
  const str = (name) => fields[name]?.stringValue ?? null
  const ends = fields.tempEndsAt?.timestampValue ? Date.parse(fields.tempEndsAt.timestampValue) : null
  return {
    siteId: str('siteId'),
    tempSiteId: str('tempSiteId'),
    tempEndsAt: Number.isFinite(ends) ? ends : null,
    active: fields.active?.booleanValue !== false
  }
}

/** May this profile read the list? Mirrors the app: current site, temp moves included. */
export const mayRead = (profile, site, nowMs) => {
  if (!profile || profile.active === false) return false
  if (!site) return true
  const away = profile.tempSiteId && profile.tempEndsAt && nowMs < profile.tempEndsAt
  return (away ? profile.tempSiteId : profile.siteId) === site
}

/** The app is served from here too; only plain paths, nothing that climbs out. */
export const safeAppPath = (pathname) => {
  const path = decodeURIComponent(String(pathname || '/'))
  if (path.includes('..') || path.includes('\\') || !path.startsWith('/')) return null
  return path === '/' ? '' : path.slice(1)
}

/** "--port 9000 --site l12" -> { port: 9000, site: 'l12' } */
export const parseArgs = (argv) => {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].replace(/^--/, '').split('=')
    const value = inline ?? argv[i + 1]
    if (inline === undefined) i++
    if (key === 'port') out.port = Number(value)
    if (key === 'site') out.site = String(value || '')
    if (key === 'app') out.appUrl = String(value || '')
    if (key === 'project') out.projectId = String(value || '')
    if (key === 'model') out.model = String(value || '')
    if (key === 'gemini-key-file') out.geminiKeyFile = String(value || '')
  }
  return out
}

// ---- The AI assistant (pure parts, tested) ---------------------------------------

export const AI_LIMITS = {
  messages: 30,
  messageChars: 4000,
  processes: 40,
  steps: 30,
  stepChars: 200,
  notesChars: 500,
  contextChars: 24000,
  perUserPerTenMinutes: 40
}

// Keep in step with src/services/jobs.js JOB_TYPES.
const JOB_LABELS = {
  'pc-refresh': 'PC Refresh', otr: 'OTR', 'pc-supply': 'PC Supply', incident: 'Incident', 'quick-it': 'Quick IT',
  'ssd-upgrade': 'SSD Upgrade', 'ram-upgrade': 'RAM Upgrade', 'av-incident': 'AV Incident', 'av-task': 'AV Task'
}

export const SYSTEM_PROMPT = [
  'You are the IT and computer-technician assistant of NBLAB, a lab site of a large technology company.',
  'You help the lab technicians troubleshoot and fix desktops, laptops, docks, monitors, peripherals, printers,',
  'networking and audio-visual (AV) equipment, and carry out jobs such as PC refreshes, SSD and RAM upgrades,',
  'PC supply, incidents, quick IT fixes and AV tasks.',
  '',
  'How to answer:',
  '- Be practical and concise. Give procedures as numbered steps.',
  '- Ask for missing details (model, operating system, exact error message) when they matter.',
  '- Warn before anything that can lose data or lock a machine (disk formatting, BIOS or firmware changes,',
  '  BitLocker, re-imaging) and say to back up first.',
  '- Never ask for, store or repeat passwords, work IDs or personal data. If the user pastes some, do not repeat it.',
  '- If a step needs company-specific tools or permissions you cannot know, say so and suggest asking the service desk.',
  '- If the site work processes below are given, follow them, name the process you use, and point out where your advice differs.',
  '- Answer in the language the user writes in (for example Hebrew or English).'
].join('\n')

export const DRAFT_PROMPT = [
  'You write work processes for lab technicians of an IT lab: short, practical, step-by-step guides.',
  'Return JSON only: {"steps": [...], "notes": "..."}.',
  '"steps": 5 to 12 steps in order, each one short imperative sentence of at most 200 characters, without numbering.',
  '"notes": optional tools, safety or contact notes, at most 400 characters; an empty string if none.',
  'Write in the language of the title.'
].join('\n')

const clip = (value, max) => String(value ?? '').slice(0, max)

/** The site's processes, cut down to what fits in a question. */
export const compactProcesses = (list) => {
  if (!Array.isArray(list)) return []
  const out = []
  let used = 0
  for (const process of list.slice(0, AI_LIMITS.processes)) {
    const entry = {
      title: clip(process?.title, 80).trim(),
      jobType: JOB_LABELS[process?.jobType] || '',
      steps: (Array.isArray(process?.steps) ? process.steps : []).slice(0, AI_LIMITS.steps).map(step => clip(step, AI_LIMITS.stepChars)),
      notes: clip(process?.notes, AI_LIMITS.notesChars)
    }
    if (!entry.title || entry.steps.length === 0) continue
    used += JSON.stringify(entry).length
    if (used > AI_LIMITS.contextChars) break
    out.push(entry)
  }
  return out
}

/** The job a question is about, if any. */
export const compactJob = (job) => {
  if (!job || typeof job !== 'object') return null
  const steps = (Array.isArray(job.steps) ? job.steps : []).slice(0, AI_LIMITS.steps).map(step => clip(step, AI_LIMITS.stepChars))
  const checks = Array.isArray(job.checks) ? job.checks : []
  return {
    type: JOB_LABELS[job.type] || clip(job.type, 40),
    note: clip(job.note, 200),
    processTitle: clip(job.processTitle, 80),
    steps: steps.map((text, index) => ({ text, done: checks[index] === true }))
  }
}

/**
 * Check what the app sends. Returns { mode, messages, context } — or an
 * error message for the person asking.
 */
export const normaliseChatRequest = (body) => {
  if (!body || typeof body !== 'object') return 'That was not a question.'
  const mode = body.mode === 'draft-process' ? 'draft-process' : 'chat'
  const context = { processes: compactProcesses(body.context?.processes), job: compactJob(body.context?.job), draft: null }

  if (mode === 'draft-process') {
    const draft = body.context?.draft || {}
    context.draft = {
      title: clip(draft.title, 80).trim(),
      jobType: JOB_LABELS[draft.jobType] || '',
      steps: (Array.isArray(draft.steps) ? draft.steps : []).map(step => clip(step, AI_LIMITS.stepChars).trim()).filter(Boolean).slice(0, AI_LIMITS.steps)
    }
    if (!context.draft.title) return 'Give the process a title first.'
    return { mode, messages: [], context }
  }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-AI_LIMITS.messages)
    .map(message => ({ role: message?.role === 'assistant' ? 'assistant' : 'user', text: clip(message?.text, AI_LIMITS.messageChars).trim() }))
    .filter(message => message.text)
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') return 'Ask a question.'
  return { mode, messages, context }
}

const processesText = (processes) => processes.map(process => [
  `### ${process.title}${process.jobType ? ` (checklist for ${process.jobType} jobs)` : ''}`,
  ...process.steps.map((step, index) => `${index + 1}. ${step}`),
  ...(process.notes ? [`Notes: ${process.notes}`] : [])
].join('\n')).join('\n\n')

const jobText = (job) => [
  `Type: ${job.type}`,
  ...(job.note ? [`Note: ${job.note}`] : []),
  ...(job.steps.length
    ? [`Checklist (${job.processTitle || 'work process'}):`, ...job.steps.map((step, index) => `${index + 1}. [${step.done ? 'done' : 'to do'}] ${step.text}`)]
    : [])
].join('\n')

/** The request for Gemini's generateContent. */
export const buildGeminiRequest = ({ mode, messages, context }) => {
  if (mode === 'draft-process') {
    const { title, jobType, steps } = context.draft
    const ask = [
      `Title: ${title}`,
      ...(jobType ? [`Used as the checklist for ${jobType} jobs.`] : []),
      ...(steps.length ? ['Current steps — improve them:', ...steps.map((step, index) => `${index + 1}. ${step}`)] : [])
    ].join('\n')
    return {
      systemInstruction: { parts: [{ text: DRAFT_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: ask }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { steps: { type: 'ARRAY', items: { type: 'STRING' } }, notes: { type: 'STRING' } },
          required: ['steps']
        }
      }
    }
  }

  const system = [SYSTEM_PROMPT]
  if (context.processes.length) system.push(`Work processes of this site:\n\n${processesText(context.processes)}`)
  if (context.job) system.push(`The technician is asking about this job:\n${jobText(context.job)}`)

  // Gemini wants the conversation to start with the user and alternate.
  const contents = []
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user'
    if (contents.length === 0 && role === 'model') continue
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts[0].text += `\n\n${message.text}`
    else contents.push({ role, parts: [{ text: message.text }] })
  }
  return {
    systemInstruction: { parts: [{ text: system.join('\n\n') }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
  }
}

/** Gemini's answer as text; throws a message for the person asking. */
export const parseGeminiResponse = (json) => {
  if (json?.promptFeedback?.blockReason) throw new Error('Gemini would not answer that question.')
  const candidate = json?.candidates?.[0]
  const text = (candidate?.content?.parts || []).map(part => part?.text || '').join('').trim()
  if (text) return text
  if (candidate?.finishReason === 'SAFETY') throw new Error('Gemini would not answer that question.')
  throw new Error('Gemini gave no answer — try asking differently.')
}

/** A drafted process: clean steps (no numbering) and notes. */
export const parseDraft = (text) => {
  let data = null
  try { data = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { /* below */ }
  const steps = (Array.isArray(data?.steps) ? data.steps : [])
    .map(step => clip(step, AI_LIMITS.stepChars).replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, AI_LIMITS.steps)
  if (steps.length === 0) throw new Error('The draft came back empty — try a clearer title.')
  return { steps, notes: clip(data?.notes, AI_LIMITS.notesChars).trim() }
}

/** What went wrong with Gemini, in words for the person asking. */
export const geminiErrorMessage = (status, json, model) => {
  const reason = JSON.stringify(json?.error || '')
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(reason)) return 'The Gemini key on the main PC is not valid.'
  if (status === 403) return 'The Gemini key on the main PC may not use this model.'
  if (status === 404) return `Gemini has no model "${model}" — start the relay with --model gemini-2.5-flash.`
  if (status === 429) return 'Gemini is busy or the free quota is used up — try again in a minute.'
  if (status >= 500) return 'Gemini is not answering right now — try again.'
  return `Gemini refused the request (${status}).`
}

/** At most `limit` uses per `windowMs` for each person. */
export const createRateLimiter = (limit, windowMs) => {
  const uses = new Map()
  return (uid, now = Date.now()) => {
    const recent = (uses.get(uid) || []).filter(at => now - at < windowMs)
    if (recent.length >= limit) { uses.set(uid, recent); return false }
    recent.push(now)
    uses.set(uid, recent)
    return true
  }
}

/** The Gemini key: the environment first, then the key file. Never printed. */
export const loadGeminiKey = ({ env = {}, readFile = () => '' } = {}) => {
  const fromEnv = String(env.GEMINI_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  try {
    return String(readFile() || '').trim()
  } catch {
    return ''
  }
}

// ---- The server ---------------------------------------------------------------------

const send = (res, status, body, headers = {}) => {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers
  })
  res.end(isJson ? JSON.stringify(body) : body)
}

/** The request body as text, or null when it is larger than a snapshot can be. */
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size <= MAX_BODY) chunks.push(chunk)
    // Read on to the end so the answer can still be sent — unless it is absurd.
    else if (size > MAX_BODY * 4) req.destroy()
  })
  req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

/** Google's signing certificates, cached as long as Google says. */
const googleCerts = () => {
  let cache = { certs: null, until: 0 }
  return async () => {
    if (cache.certs && Date.now() < cache.until) return cache.certs
    const res = await fetch(CERTS_URL)
    if (!res.ok) throw new Error(`certificates: ${res.status}`)
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600)
    cache = { certs: await res.json(), until: Date.now() + maxAge * 1000 }
    return cache.certs
  }
}

/** The user's own profile, read with their own token — the Firestore rules allow exactly that. */
const firestoreProfile = (projectId) => async (uid, token) => {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`profile: ${res.status}`)
  return fromFirestoreProfile(await res.json())
}

/** Files of the live NBLAB app, briefly cached. */
const appFetcher = (appUrl) => {
  const cache = new Map()
  return async (path) => {
    const hit = cache.get(path)
    if (hit && Date.now() < hit.until) return hit
    const res = await fetch(new URL(path, appUrl))
    const entry = {
      status: res.status,
      type: res.headers.get('content-type') || 'application/octet-stream',
      body: Buffer.from(await res.arrayBuffer()),
      until: Date.now() + APP_CACHE_MS
    }
    if (res.ok) cache.set(path, entry)
    return entry
  }
}

/** Ask Gemini. The key goes in a header, never in a URL or a log. */
const geminiCaller = ({ key, model }) => async (payload) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the relay. Dependencies are injectable so the tests can run it
 * without Google, Firestore or the live site.
 */
export const createRelay = ({
  config = DEFAULTS,
  getCerts = googleCerts(),
  getProfile = firestoreProfile(config.projectId),
  fetchApp = appFetcher(config.appUrl),
  geminiKey = '',
  callGemini = geminiCaller({ key: geminiKey, model: config.model || DEFAULTS.model }),
  log = () => {}
} = {}) => {
  let latest = { snapshot: null, receivedAt: 0 }
  const allowed = new Map() // uid -> { ok, until }
  const model = config.model || DEFAULTS.model
  const mayAsk = createRateLimiter(AI_LIMITS.perUserPerTenMinutes, 10 * 60 * 1000)

  /** { status: 200 | 401 | 403, uid } */
  const authorize = async (req) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    if (!token) return { status: 401 }
    let uid
    try {
      uid = await verifyIdToken(token, { projectId: config.projectId, getCerts })
    } catch {
      return { status: 401 }
    }
    const cached = allowed.get(uid)
    if (cached && Date.now() < cached.until) return { status: cached.ok ? 200 : 403, uid }
    const profile = await getProfile(uid, token)
    const ok = mayRead(profile, config.site, Date.now())
    allowed.set(uid, { ok, until: Date.now() + PROFILE_CACHE_MS })
    return { status: ok ? 200 : 403, uid }
  }

  const refuse = (res, status) => send(res, status, { error: status === 401 ? 'Sign in to NBLAB.' : 'Not allowed.' })

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://relay')
    try {
      if (url.pathname === '/api/servicenow/ping') {
        return send(res, 200, { relay: true, version: RELAY_VERSION, ai: !!geminiKey, model: geminiKey ? model : null })
      }

      if (url.pathname === '/api/ai/chat') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method' })
        const auth = await authorize(req)
        if (auth.status !== 200) return refuse(res, auth.status)
        if (!geminiKey) return send(res, 503, { error: 'The AI assistant is not set up on the main PC.' })
        const body = await readBody(req)
        if (body === null) return send(res, 413, { error: 'That is too long.' })
        let parsed = null
        try { parsed = JSON.parse(body) } catch { /* not JSON */ }
        const request = normaliseChatRequest(parsed)
        if (typeof request === 'string') return send(res, 400, { error: request })
        if (!mayAsk(auth.uid)) return send(res, 429, { error: 'Too many questions in a short time — wait a few minutes.' })
        const answer = await callGemini(buildGeminiRequest(request))
        if (answer.status !== 200) {
          log(`assistant: Gemini answered ${answer.status}`)
          return send(res, 502, { error: geminiErrorMessage(answer.status, answer.json, model) })
        }
        let text
        try {
          text = parseGeminiResponse(answer.json)
          // Only the size is logged — never what was asked or answered.
          log(`assistant: ${request.mode}, ${text.length} characters`)
          return send(res, 200, request.mode === 'draft-process' ? { draft: parseDraft(text) } : { text })
        } catch (err) {
          return send(res, 502, { error: err.message })
        }
      }

      if (url.pathname === '/api/servicenow') {
        if (req.method === 'POST') {
          // Only the watcher on this very PC may update the list.
          if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: 'only from this PC' })
          const body = await readBody(req)
          if (body === null) return send(res, 413, { error: 'too large' })
          let snapshot = null
          try { snapshot = JSON.parse(body) } catch { /* not JSON */ }
          if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.tasks)) {
            return send(res, 400, { error: 'not a snapshot' })
          }
          latest = { snapshot, receivedAt: Date.now() }
          log(`received ${snapshot.count ?? snapshot.tasks.length} unassigned`)
          return send(res, 204, '')
        }
        if (req.method === 'GET') {
          const auth = await authorize(req)
          if (auth.status !== 200) return refuse(res, auth.status)
          return send(res, 200, latest)
        }
        return send(res, 405, { error: 'method' })
      }

      // Everything else is the NBLAB app, fetched from the live site.
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
      const path = safeAppPath(url.pathname)
      if (path === null) return send(res, 400, 'Bad path')
      const file = await fetchApp(path)
      return send(res, file.status, req.method === 'HEAD' ? '' : file.body, {
        'Content-Type': file.type,
        'Cache-Control': path === '' || path.endsWith('.html') ? 'no-cache' : 'public, max-age=300'
      })
    } catch (err) {
      log(`error: ${err?.message || err}`)
      return send(res, 502, { error: 'relay error' })
    }
  })
}

const addresses = (port) => {
  const list = [`http://${os.hostname()}:${port}/`]
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) list.push(`http://${entry.address}:${port}/`)
    }
  }
  return list
}

const start = () => {
  const config = { ...DEFAULTS, ...parseArgs(process.argv.slice(2)) }
  const stamp = () => new Date().toLocaleTimeString([], { hour12: false })
  const keyFile = config.geminiKeyFile || new URL('./gemini.key', import.meta.url)
  const geminiKey = loadGeminiKey({ env: process.env, readFile: () => readFileSync(keyFile, 'utf8') })
  const server = createRelay({ config, geminiKey, log: (line) => console.log(`[${stamp()}] ${line}`) })
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Is the relay already running? Or start it with --port 8788.`
      : `Could not start: ${err.message}`)
    process.exitCode = 1
  })
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`NBLAB ServiceNow relay ${RELAY_VERSION} is running. Leave this window open.`)
    console.log('')
    console.log('On the other lab PCs, open the app from one of these addresses:')
    addresses(config.port).forEach(address => console.log(`  ${address}`))
    console.log('')
    console.log('On this PC, keep ServiceNow open in the browser with the watcher installed.')
    if (config.site) console.log(`Only people working at site "${config.site}" can see the list.`)
    console.log('Nothing is written to disk; the list lives only while this window is open.')
    console.log('')
    console.log(geminiKey
      ? `AI assistant: on (Gemini model ${config.model}). The key stays on this PC.`
      : 'AI assistant: off. To turn it on, put your Gemini API key in a file named gemini.key next to this script and restart.')
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
