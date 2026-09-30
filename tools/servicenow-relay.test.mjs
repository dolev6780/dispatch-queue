import crypto from 'node:crypto'
import {
  isLoopback, decodeJwt, checkClaims, verifyIdToken, fromFirestoreProfile, mayRead, safeAppPath, parseArgs, createRelay
} from './servicenow-relay.mjs'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}
const rejects = async (label, promise, message) => {
  try {
    await promise
    eq(label, 'resolved', `rejected: ${message}`)
  } catch (err) {
    eq(label, err.message, message)
  }
}

// A signing key standing in for Google's, and tokens shaped like Firebase's.
const PROJECT = 'nblabmanagment'
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const certs = { k1: publicKey.export({ type: 'spki', format: 'pem' }) }
const getCerts = async () => certs
const now = Math.floor(Date.now() / 1000)
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = (claims = {}, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) => {
  const head = b64({ alg, kid, typ: 'JWT' })
  const body = b64({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'u1', iat: now - 10, exp: now + 3600, ...claims
  })
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${signature}`
}

console.log('--- only this PC may update ---')
eq('127.0.0.1', isLoopback('127.0.0.1'), true)
eq('::1', isLoopback('::1'), true)
eq('IPv4 over IPv6', isLoopback('::ffff:127.0.0.1'), true)
eq('another PC', isLoopback('10.0.0.7'), false)
eq('nothing', isLoopback(undefined), false)

console.log('--- sign-in tokens ---')
eq('a token splits into its parts', decodeJwt(token()).payload.sub, 'u1')
eq('garbage is not a token', decodeJwt('not-a-token'), null)
const claims = decodeJwt(token()).payload
eq('good claims', checkClaims(claims, { projectId: PROJECT, nowSec: now }), null)
eq('another project', checkClaims({ ...claims, aud: 'other' }, { projectId: PROJECT, nowSec: now }), 'wrong project')
eq('another issuer', checkClaims({ ...claims, iss: 'https://evil' }, { projectId: PROJECT, nowSec: now }), 'wrong issuer')
eq('expired', checkClaims({ ...claims, exp: now - 1 }, { projectId: PROJECT, nowSec: now }), 'expired')
eq('from the future', checkClaims({ ...claims, iat: now + 3600 }, { projectId: PROJECT, nowSec: now }), 'issued in the future')
eq('no user', checkClaims({ ...claims, sub: '' }, { projectId: PROJECT, nowSec: now }), 'no user')
eq('a valid token names its user', await verifyIdToken(token(), { projectId: PROJECT, getCerts }), 'u1')
await rejects('signed with another key', verifyIdToken(token({}, { key: other.privateKey }), { projectId: PROJECT, getCerts }), 'bad signature')
await rejects('an unknown key id', verifyIdToken(token({}, { kid: 'k9' }), { projectId: PROJECT, getCerts }), 'unknown key')
await rejects('"none" algorithm', verifyIdToken(token({}, { alg: 'none' }), { projectId: PROJECT, getCerts }), 'wrong algorithm')
await rejects('expired, even if signed', verifyIdToken(token({ exp: now - 5 }), { projectId: PROJECT, getCerts }), 'expired')
{
  const [head, , sig] = token().split('.')
  const forged = `${head}.${b64({ ...claims, sub: 'admin' })}.${sig}`
  await rejects('a payload changed after signing', verifyIdToken(forged, { projectId: PROJECT, getCerts }), 'bad signature')
}

console.log('--- who may read ---')
const doc = { fields: { siteId: { stringValue: 'l12' }, active: { booleanValue: true } } }
eq('profile from Firestore', fromFirestoreProfile(doc), { siteId: 'l12', tempSiteId: null, tempEndsAt: null, active: true })
const later = Date.now() + 864e5
const away = fromFirestoreProfile({ fields: { siteId: { stringValue: 'l12' }, tempSiteId: { stringValue: 'l9' }, tempEndsAt: { timestampValue: new Date(later).toISOString() } } })
eq('a temporary move is read', [away.tempSiteId, away.tempEndsAt], ['l9', later])
eq('any active member when no site is set', mayRead(fromFirestoreProfile(doc), '', Date.now()), true)
eq('a member of the site', mayRead(fromFirestoreProfile(doc), 'l12', Date.now()), true)
eq('a member of another site', mayRead(fromFirestoreProfile(doc), 'l9', Date.now()), false)
eq('someone moved away this week', mayRead(away, 'l12', Date.now()), false)
eq('...who reads where they are', mayRead(away, 'l9', Date.now()), true)
eq('...and is home once the move ends', mayRead(away, 'l12', later + 1), true)
eq('a hidden (inactive) profile', mayRead({ ...fromFirestoreProfile(doc), active: false }, '', Date.now()), false)
eq('no profile at all', mayRead(null, '', Date.now()), false)

console.log('--- serving the app ---')
eq('the page itself', safeAppPath('/'), '')
eq('an asset', safeAppPath('/assets/index-abc.js'), 'assets/index-abc.js')
eq('no climbing out', safeAppPath('/../secret'), null)
eq('not even encoded', safeAppPath('/%2e%2e/secret'), null)
eq('arguments', parseArgs(['--port', '9000', '--site=l12']), { port: 9000, site: 'l12' })

console.log('--- the whole relay ---')
const profiles = { u1: fromFirestoreProfile(doc) }
const server = createRelay({
  config: { port: 0, projectId: PROJECT, appUrl: 'https://example.invalid/', site: 'l12' },
  getCerts,
  getProfile: async (uid) => profiles[uid] || null,
  fetchApp: async (path) => ({ status: 200, type: 'text/html; charset=utf-8', body: Buffer.from(`app:${path || 'index'}`) })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const get = (path, headers = {}) => fetch(base + path, { headers })

eq('ping says it is a relay', (await (await get('/api/servicenow/ping')).json()).relay, true)
eq('the app is served', await (await get('/')).text(), 'app:index')
eq('...with its assets', await (await get('/assets/x.js')).text(), 'app:assets/x.js')
eq('reading without signing in', (await get('/api/servicenow')).status, 401)
eq('reading with a bad token', (await get('/api/servicenow', { Authorization: 'Bearer nope' })).status, 401)
eq('reading as someone with no NBLAB profile', (await get('/api/servicenow', { Authorization: `Bearer ${token({ sub: 'stranger' })}` })).status, 403)
eq('before the watcher reports, an empty answer', (await (await get('/api/servicenow', { Authorization: `Bearer ${token()}` })).json()).snapshot, null)

const snap = { count: 2, tasks: [{ id: 's1', number: 'SCTASK1' }], groups: ['G'], checkedAt: 1, okAt: 1, error: null }
const post = (body) => fetch(`${base}/api/servicenow`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
eq('the watcher on this PC reports', (await post(JSON.stringify(snap))).status, 204)
eq('not a snapshot is refused', (await post(JSON.stringify({ hello: 1 }))).status, 400)
eq('too large is refused', (await post(JSON.stringify({ tasks: [], pad: 'x'.repeat(300 * 1024) }))).status, 413)
eq('not JSON is refused', (await post('{nope')).status, 400)
const read = await (await get('/api/servicenow', { Authorization: `Bearer ${token()}` })).json()
eq('a member reads what was reported', read.snapshot, snap)
eq('...with when it arrived', typeof read.receivedAt, 'number')
eq('other methods are refused', (await fetch(`${base}/api/servicenow`, { method: 'DELETE' })).status, 405)
server.closeAllConnections()
await new Promise(resolve => server.close(resolve))

console.log(`\n${pass} passed, ${fail} failed`)
// exitCode, not exit(): exiting while sockets are closing crashes Node on Windows.
process.exitCode = fail ? 1 : 0
