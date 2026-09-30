#!/usr/bin/env node
/**
 * NBLAB ServiceNow relay — runs on the main lab PC.
 *
 *   node servicenow-relay.mjs            (then leave the window open)
 *   node servicenow-relay.mjs --port 8787 --site l12
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
 * Needs Node.js 18 or later; no packages to install.
 */

import http from 'node:http'
import os from 'node:os'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const RELAY_VERSION = '1.0.0'
export const DEFAULTS = {
  port: 8787,
  projectId: 'nblabmanagment',
  appUrl: 'https://dolev6780.github.io/dispatch-queue/',
  // Optional: only people working at this site id may read the list.
  site: ''
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
  }
  return out
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

/**
 * Build the relay. Dependencies are injectable so the tests can run it
 * without Google, Firestore or the live site.
 */
export const createRelay = ({
  config = DEFAULTS,
  getCerts = googleCerts(),
  getProfile = firestoreProfile(config.projectId),
  fetchApp = appFetcher(config.appUrl),
  log = () => {}
} = {}) => {
  let latest = { snapshot: null, receivedAt: 0 }
  const allowed = new Map() // uid -> { ok, until }

  const authorize = async (req) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    if (!token) return 401
    let uid
    try {
      uid = await verifyIdToken(token, { projectId: config.projectId, getCerts })
    } catch {
      return 401
    }
    const cached = allowed.get(uid)
    if (cached && Date.now() < cached.until) return cached.ok ? 200 : 403
    const profile = await getProfile(uid, token)
    const ok = mayRead(profile, config.site, Date.now())
    allowed.set(uid, { ok, until: Date.now() + PROFILE_CACHE_MS })
    return ok ? 200 : 403
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://relay')
    try {
      if (url.pathname === '/api/servicenow/ping') {
        return send(res, 200, { relay: true, version: RELAY_VERSION })
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
          const status = await authorize(req)
          if (status !== 200) return send(res, status, { error: status === 401 ? 'sign in to NBLAB' : 'not allowed' })
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
  const server = createRelay({ config, log: (line) => console.log(`[${stamp()}] ${line}`) })
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
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
