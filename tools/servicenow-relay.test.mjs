import crypto from 'node:crypto'
import {
  isLoopback, decodeJwt, checkClaims, verifyIdToken, fromFirestoreProfile, mayRead, safeAppPath, parseArgs, createRelay,
  AI_LIMITS, compactProcesses, compactJob, normaliseChatRequest, buildGeminiRequest, parseGeminiResponse, parseDraft,
  geminiErrorMessage, createRateLimiter, loadGeminiKey
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

console.log('--- AI assistant: what is asked ---')
eq('a question comes through', normaliseChatRequest({ messages: [{ role: 'user', text: ' Laptop will not boot ' }] }).messages,
  [{ role: 'user', text: 'Laptop will not boot' }])
eq('no question, no request', normaliseChatRequest({ messages: [] }), 'Ask a question.')
eq('the last word must be the user\'s', normaliseChatRequest({ messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] }), 'Ask a question.')
eq('not an object', normaliseChatRequest(null), 'That was not a question.')
eq('long messages are cut', normaliseChatRequest({ messages: [{ role: 'user', text: 'x'.repeat(9000) }] }).messages[0].text.length, AI_LIMITS.messageChars)
eq('only the last 30 messages', normaliseChatRequest({ messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` })).concat([{ role: 'user', text: 'last' }]) }).messages.length, AI_LIMITS.messages)
eq('a draft needs a title', normaliseChatRequest({ mode: 'draft-process', context: { draft: { title: ' ' } } }), 'Give the process a title first.')
eq('a draft with a title', normaliseChatRequest({ mode: 'draft-process', context: { draft: { title: 'SSD upgrade', jobType: 'ssd-upgrade', steps: ['Back up', ' '] } } }).context.draft,
  { title: 'SSD upgrade', jobType: 'SSD Upgrade', steps: ['Back up'] })
eq('processes keep title, type label, steps and notes', compactProcesses([{ title: 'SSD', jobType: 'ssd-upgrade', steps: ['a', 'b'], notes: 'n', extra: 'dropped' }]),
  [{ title: 'SSD', jobType: 'SSD Upgrade', steps: ['a', 'b'], notes: 'n' }])
eq('processes without steps are skipped', compactProcesses([{ title: 'Empty', steps: [] }]), [])
eq('processes stop before the context is too big',
  compactProcesses(Array.from({ length: 40 }, (_, i) => ({ title: `P${i}`, steps: Array(30).fill('s'.repeat(200)) }))).length < 40, true)
eq('a job with its checklist', compactJob({ type: 'incident', note: 'Printer offline', processTitle: 'Printer', steps: ['Check power', 'Check queue'], checks: [true, false] }),
  { type: 'Incident', note: 'Printer offline', processTitle: 'Printer', steps: [{ text: 'Check power', done: true }, { text: 'Check queue', done: false }] })

console.log('--- AI assistant: what Gemini gets ---')
const chat = buildGeminiRequest(normaliseChatRequest({
  messages: [{ role: 'assistant', text: 'Hello' }, { role: 'user', text: 'A' }, { role: 'user', text: 'B' }, { role: 'assistant', text: 'C' }, { role: 'user', text: 'D' }],
  context: { processes: [{ title: 'SSD', steps: ['Back up'] }], job: { type: 'incident', note: 'Printer offline' } }
}))
eq('starts with the user, alternates, merges repeats', chat.contents.map(c => `${c.role}:${c.parts[0].text}`), ['user:A\n\nB', 'model:C', 'user:D'])
eq('the processes are in the instructions', chat.systemInstruction.parts[0].text.includes('### SSD\n1. Back up'), true)
eq('the job is in the instructions', chat.systemInstruction.parts[0].text.includes('Note: Printer offline'), true)
eq('no processes, no processes section', buildGeminiRequest(normaliseChatRequest({ messages: [{ role: 'user', text: 'q' }] })).systemInstruction.parts[0].text.includes('Work processes'), false)
const draftReq = buildGeminiRequest(normaliseChatRequest({ mode: 'draft-process', context: { draft: { title: 'SSD upgrade', steps: ['Back up'] } } }))
eq('a draft asks for JSON', draftReq.generationConfig.responseMimeType, 'application/json')
eq('a draft passes the current steps to improve', draftReq.contents[0].parts[0].text, 'Title: SSD upgrade\nCurrent steps — improve them:\n1. Back up')

console.log('--- AI assistant: what comes back ---')
eq('the answer text', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Step 1' }, { text: ' and 2' }] } }] }), 'Step 1 and 2')
const throws = (label, fn, message) => { try { fn(); eq(label, 'no error', message) } catch (err) { eq(label, err.message, message) } }
throws('a blocked prompt', () => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }), 'Gemini would not answer that question.')
throws('a safety stop', () => parseGeminiResponse({ candidates: [{ finishReason: 'SAFETY' }] }), 'Gemini would not answer that question.')
throws('nothing at all', () => parseGeminiResponse({}), 'Gemini gave no answer — try asking differently.')
eq('a draft, numbering removed', parseDraft('{"steps": ["1. Back up", "- Swap", "Test"], "notes": "Use the dock"}'), { steps: ['Back up', 'Swap', 'Test'], notes: 'Use the dock' })
eq('a draft in a code fence', parseDraft('```json\n{"steps": ["A"]}\n```').steps, ['A'])
throws('an empty draft', () => parseDraft('{"steps": []}'), 'The draft came back empty — try a clearer title.')
throws('not JSON', () => parseDraft('sorry'), 'The draft came back empty — try a clearer title.')
eq('a bad key, in words', geminiErrorMessage(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 'm'), 'The Gemini key on the main PC is not valid.')
eq('an unknown model, in words', geminiErrorMessage(404, {}, 'gemini-x'), 'Gemini has no model "gemini-x" — start the relay with --model gemini-2.5-flash.')
eq('quota, in words', geminiErrorMessage(429, {}, 'm'), 'Gemini is busy or the free quota is used up — try again in a minute.')
const limiter = createRateLimiter(2, 1000)
eq('the rate limit lets a few through', [limiter('u', 0), limiter('u', 1), limiter('u', 2)], [true, true, false])
eq('...per person', limiter('v', 2), true)
eq('...and lets them ask again later', limiter('u', 1500), true)
eq('the key from the environment first', loadGeminiKey({ env: { GEMINI_API_KEY: ' k1 ' }, readFile: () => 'k2' }), 'k1')
eq('then the key file', loadGeminiKey({ env: {}, readFile: () => 'k2\n' }), 'k2')
eq('no key anywhere', loadGeminiKey({ env: {}, readFile: () => { throw new Error('ENOENT') } }), '')

console.log('--- AI assistant: through the relay ---')
const geminiCalls = []
let geminiAnswer = { status: 200, json: { candidates: [{ content: { parts: [{ text: 'Try a different port.' }] } }] } }
const aiRelay = createRelay({
  config: { port: 0, projectId: PROJECT, appUrl: 'https://example.invalid/', site: '', model: 'gemini-test' },
  getCerts,
  getProfile: async (uid) => profiles[uid] || null,
  fetchApp: async () => ({ status: 200, type: 'text/plain', body: Buffer.from('') }),
  geminiKey: 'secret-key',
  callGemini: async (payload) => { geminiCalls.push(payload); return geminiAnswer }
})
await new Promise(resolve => aiRelay.listen(0, '127.0.0.1', resolve))
const aiBase = `http://127.0.0.1:${aiRelay.address().port}`
const ask = (body, auth = `Bearer ${token()}`) => fetch(`${aiBase}/api/ai/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body)
})
const ping = await (await fetch(`${aiBase}/api/servicenow/ping`)).json()
eq('ping says the assistant is on, and which model', [ping.ai, ping.model], [true, 'gemini-test'])
eq('the key is never in the ping', JSON.stringify(ping).includes('secret-key'), false)
eq('asking without signing in', (await ask({ messages: [{ role: 'user', text: 'q' }] }, null)).status, 401)
eq('asking without an NBLAB profile', (await ask({ messages: [{ role: 'user', text: 'q' }] }, `Bearer ${token({ sub: 'stranger' })}`)).status, 403)
eq('Gemini is not called for those', geminiCalls.length, 0)
const empty = await ask({ messages: [] })
eq('an empty question is refused, in words', [empty.status, (await empty.json()).error], [400, 'Ask a question.'])
const answered = await ask({ messages: [{ role: 'user', text: 'Dock has no network' }] })
eq('a member gets the answer', [answered.status, (await answered.json()).text], [200, 'Try a different port.'])
eq('Gemini got the question', geminiCalls[0].contents[0].parts[0].text, 'Dock has no network')
geminiAnswer = { status: 200, json: { candidates: [{ content: { parts: [{ text: '{"steps": ["Back up", "Swap"], "notes": ""}' }] } }] } }
const drafted = await ask({ mode: 'draft-process', context: { draft: { title: 'SSD upgrade' } } })
eq('a draft comes back as steps', (await drafted.json()).draft, { steps: ['Back up', 'Swap'], notes: '' })
geminiAnswer = { status: 400, json: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } }
const badKey = await ask({ messages: [{ role: 'user', text: 'q' }] })
eq('a bad key is explained', [badKey.status, (await badKey.json()).error], [502, 'The Gemini key on the main PC is not valid.'])
geminiAnswer = { status: 200, json: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } }
let last = null
for (let i = 0; i < AI_LIMITS.perUserPerTenMinutes; i++) last = await ask({ messages: [{ role: 'user', text: 'q' }] })
eq('too many questions are refused', last.status, 429)
aiRelay.closeAllConnections()
await new Promise(resolve => aiRelay.close(resolve))

const noKey = createRelay({ config: { port: 0, projectId: PROJECT, appUrl: 'https://example.invalid/' }, getCerts, getProfile: async (uid) => profiles[uid] || null })
await new Promise(resolve => noKey.listen(0, '127.0.0.1', resolve))
const noKeyBase = `http://127.0.0.1:${noKey.address().port}`
eq('without a key the ping says the assistant is off', (await (await fetch(`${noKeyBase}/api/servicenow/ping`)).json()).ai, false)
const off = await fetch(`${noKeyBase}/api/ai/chat`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: '{}' })
eq('...and asking says so', [off.status, (await off.json()).error], [503, 'The AI assistant is not set up on the main PC.'])
noKey.closeAllConnections()
await new Promise(resolve => noKey.close(resolve))

console.log(`\n${pass} passed, ${fail} failed`)
// exitCode, not exit(): exiting while sockets are closing crashes Node on Windows.
process.exitCode = fail ? 1 : 0
