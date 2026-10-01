/**
 * Firestore security-rules test suite, run against the local emulator.
 *
 *   npm run test:rules
 *
 * Nothing here touches the live project: it uses a `demo-` project id, which
 * the emulator refuses to connect anywhere real. Every role is exercised
 * against every path, including the attacks found in review and the
 * date-dependent temporary moves.
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  writeBatch, deleteField, setLogLevel, Timestamp, serverTimestamp
} from 'firebase/firestore'

// Every expected denial would otherwise print a PERMISSION_DENIED stack.
setLogLevel('silent')

const env = await initializeTestEnvironment({
  projectId: 'demo-nblab',
  firestore: {
    rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    host: '127.0.0.1',
    port: 8085
  }
})

let pass = 0
let fail = 0
const failures = []

const check = async (label, expectAllowed, operation) => {
  try {
    if (expectAllowed) await assertSucceeds(operation())
    else await assertFails(operation())
    pass++
    console.log(`  OK    ${expectAllowed ? 'allow' : 'deny '}  ${label}`)
  } catch (err) {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${expectAllowed ? 'allow' : 'deny '}  ${label}\n        ${String(err?.message || err).split('\n')[0]}`)
  }
}
const allow = (label, op) => check(label, true, op)
const deny = (label, op) => check(label, false, op)

const FQ = ['features', 'dispatch-queue']
const stateOf = (site) => ['sites', site, ...FQ, 'state', 'current']
const future = Timestamp.fromDate(new Date(Date.now() + 7 * 864e5))
const past = Timestamp.fromDate(new Date(Date.now() - 864e5))

const person = (extra) => ({ name: 'Person', role: 'Member', siteAdmin: false, isGlobalAdmin: false, active: true, ...extra })

const seed = async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'config', 'bootstrap'), { claimedBy: 'g' })
    for (const [id, name] of [['haifa', 'Haifa'], ['tlv', 'Tel Aviv'], ['eilat', 'Eilat']]) {
      await setDoc(doc(db, 'sites', id), { name })
    }
    await setDoc(doc(db, 'users', 'g'), person({ siteId: 'haifa', siteAdmin: true, isGlobalAdmin: true }))
    await setDoc(doc(db, 'users', 'sa'), person({ siteId: 'haifa', siteAdmin: true }))
    await setDoc(doc(db, 'users', 'sa2'), person({ siteId: 'haifa', siteAdmin: true }))
    await setDoc(doc(db, 'users', 'm'), person({ siteId: 'haifa' }))
    await setDoc(doc(db, 'users', 'mt'), person({ siteId: 'tlv' }))
    await setDoc(doc(db, 'users', 'satlv'), person({ siteId: 'tlv', siteAdmin: true }))
    // Tel Aviv worker temporarily at Haifa for another week.
    await setDoc(doc(db, 'users', 'vis'), person({ siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: future }))
    // Tel Aviv worker whose Haifa stint ended yesterday.
    await setDoc(doc(db, 'users', 'ret'), person({ siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: past }))
    // Haifa site admin currently lent to Tel Aviv.
    await setDoc(doc(db, 'users', 'away'), person({ siteId: 'haifa', siteAdmin: true, tempSiteId: 'tlv', tempEndsAt: future }))
    await setDoc(doc(db, 'users', 'legacy'), { name: 'Old admin', role: 'Administrator', wwid: '4471', isAdmin: true })
    for (const site of ['haifa', 'tlv']) {
      await setDoc(doc(db, ...stateOf(site)), { dayQueues: { 0: ['m'] }, lastResetDate: '2026-09-27', updatedBy: 'g' })
    }
    await setDoc(doc(db, 'sites', 'haifa', ...FQ, 'workers', 'old'), { name: 'Superseded worker' })
    await setDoc(doc(db, 'features', 'dispatch-queue', 'workers', 'pre'), { name: 'Pre-sites worker' })
  })
}

const as = (uid) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()
const stamp = (uid, extra) => ({ updatedBy: uid, ...extra })
const usersAt = (db, field, site) => getDocs(query(collection(db, 'users'), where(field, '==', site)))

await seed()

// ---------------------------------------------------------------------------
console.log('\n--- signed out ---')
await allow('read config/bootstrap (sign-in page needs it)', () => getDoc(doc(anon(), 'config', 'bootstrap')))
await deny('get a site', () => getDoc(doc(anon(), 'sites', 'haifa')))
await deny('read the queue', () => getDoc(doc(anon(), ...stateOf('haifa'))))
await deny('list users', () => getDocs(collection(anon(), 'users')))

// ---------------------------------------------------------------------------
console.log('\n--- stranger: token from the public sign-up API, no profile ---')
const stranger = as('stranger')
await allow('read own (missing) profile', () => getDoc(doc(stranger, 'users', 'stranger')))
await deny('LIST users (WWID-harvest attack)', () => getDocs(collection(stranger, 'users')))
await deny('list a site\'s workers', () => usersAt(stranger, 'siteId', 'haifa'))
await deny('get the global admin profile', () => getDoc(doc(stranger, 'users', 'g')))
await deny('self-create a member profile after setup', () =>
  setDoc(doc(stranger, 'users', 'stranger'), person({ siteId: 'haifa' })))
await deny('self-create a GLOBAL profile after setup', () =>
  setDoc(doc(stranger, 'users', 'stranger'), person({ siteId: 'haifa', isGlobalAdmin: true })))
await deny('get a site', () => getDoc(doc(stranger, 'sites', 'haifa')))
await deny('list sites', () => getDocs(collection(stranger, 'sites')))
await deny('read the queue', () => getDoc(doc(stranger, ...stateOf('haifa'))))
await deny('write the queue', () =>
  setDoc(doc(stranger, ...stateOf('haifa')), stamp('stranger', { dayQueues: { 0: [] } }), { merge: true }))
await deny('overwrite the bootstrap marker', () => setDoc(doc(stranger, 'config', 'bootstrap'), { claimedBy: 'stranger' }))
await deny('read pre-sites data', () => getDocs(collection(stranger, 'features', 'dispatch-queue', 'workers')))

// ---------------------------------------------------------------------------
console.log('\n--- member at Haifa ---')
const m = as('m')
await allow('get own profile', () => getDoc(doc(m, 'users', 'm')))
await allow('get a Haifa colleague (queue shows names)', () => getDoc(doc(m, 'users', 'sa')))
await allow('get a visitor working at Haifa this week', () => getDoc(doc(m, 'users', 'vis')))
await deny('get a Tel Aviv worker', () => getDoc(doc(m, 'users', 'mt')))
await allow('list Haifa workers by home site', () => usersAt(m, 'siteId', 'haifa'))
await allow('list visitors at Haifa by temporary site', () => usersAt(m, 'tempSiteId', 'haifa'))
await deny('list Tel Aviv workers', () => usersAt(m, 'siteId', 'tlv'))
await deny('list ALL users', () => getDocs(collection(m, 'users')))
await allow('get own site', () => getDoc(doc(m, 'sites', 'haifa')))
await deny('get another site', () => getDoc(doc(m, 'sites', 'tlv')))
await deny('list sites', () => getDocs(collection(m, 'sites')))
await allow('read own site queue', () => getDoc(doc(m, ...stateOf('haifa'))))
await deny('read another site queue', () => getDoc(doc(m, ...stateOf('tlv'))))
await allow('edit one day of own site queue', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { dayQueues: { 1: ['m'] } }), { merge: true }))
await allow('edit one day of shift hours', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { daySchedules: { 1: { isWorkDay: true, startTime: '08:00', endTime: '16:00' } } }), { merge: true }))
await deny('edit another site queue', () =>
  setDoc(doc(m, ...stateOf('tlv')), stamp('m', { dayQueues: { 1: [] } }), { merge: true }))
await deny('forge attribution', () =>
  setDoc(doc(m, ...stateOf('haifa')), { updatedBy: 'g', dayQueues: { 1: [] } }, { merge: true }))
await deny('move the reset date BACKWARDS', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { lastResetDate: '2026-09-26' }), { merge: true }))
await allow('move the reset date forwards', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { lastResetDate: '2026-09-28' }), { merge: true }))
await deny('write a junk field', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { evil: true }), { merge: true }))
await deny('write a bogus day key', () =>
  setDoc(doc(m, ...stateOf('haifa')), stamp('m', { dayQueues: { 9: [] } }), { merge: true }))
await deny('create a stray state document', () =>
  setDoc(doc(m, 'sites', 'haifa', ...FQ, 'state', 'other'), stamp('m', {})))
await deny('delete the queue', () => deleteDoc(doc(m, ...stateOf('haifa'))))
await deny('self-promote to site admin', () => updateDoc(doc(m, 'users', 'm'), { siteAdmin: true }))
await deny('self-promote to global admin', () => updateDoc(doc(m, 'users', 'm'), { isGlobalAdmin: true }))
await deny('move self to another site', () => updateDoc(doc(m, 'users', 'm'), { siteId: 'tlv' }))
await deny('create a worker', () => setDoc(doc(m, 'users', 'new1'), person({ siteId: 'haifa' })))

// ---------------------------------------------------------------------------
console.log('\n--- temporary moves: fully relocated, and automatically over ---')
const vis = as('vis')
await allow('visitor uses the TEMPORARY site board', () => getDoc(doc(vis, ...stateOf('haifa'))))
await allow('visitor edits the temporary site queue', () =>
  setDoc(doc(vis, ...stateOf('haifa')), stamp('vis', { dayQueues: { 2: ['vis'] } }), { merge: true }))
await deny('visitor cannot use the HOME site board meanwhile', () => getDoc(doc(vis, ...stateOf('tlv'))))
await allow('visitor lists colleagues at the temporary site', () => usersAt(vis, 'siteId', 'haifa'))
const ret = as('ret')
await allow('after the end date: back on the HOME board', () => getDoc(doc(ret, ...stateOf('tlv'))))
await deny('after the end date: the old temporary board is closed', () => getDoc(doc(ret, ...stateOf('haifa'))))

// ---------------------------------------------------------------------------
console.log('\n--- site admin at Haifa ---')
const sa = as('sa')
await allow('list Haifa accounts', () => usersAt(sa, 'siteId', 'haifa'))
await deny('list ALL accounts', () => getDocs(collection(sa, 'users')))
await deny('list Tel Aviv accounts', () => usersAt(sa, 'siteId', 'tlv'))
await allow('list sites (to choose a move destination)', () => getDocs(collection(sa, 'sites')))
await allow('get another site', () => getDoc(doc(sa, 'sites', 'tlv')))
await allow('create a Haifa worker', () => setDoc(doc(sa, 'users', 'new2'), person({ siteId: 'haifa' })))
await allow('create a Haifa site admin', () => setDoc(doc(sa, 'users', 'new3'), person({ siteId: 'haifa', siteAdmin: true })))
await deny('create a GLOBAL admin', () => setDoc(doc(sa, 'users', 'new4'), person({ siteId: 'haifa', isGlobalAdmin: true })))
await deny('create a worker at Tel Aviv', () => setDoc(doc(sa, 'users', 'new5'), person({ siteId: 'tlv' })))
await deny('create a worker at a site that does not exist', () => setDoc(doc(sa, 'users', 'new6'), person({ siteId: 'nowhere' })))
await deny('create a profile carrying a plaintext wwid', () =>
  setDoc(doc(sa, 'users', 'new7'), { ...person({ siteId: 'haifa' }), wwid: '4471' }))
await allow('hide a worker from the queue', () => updateDoc(doc(sa, 'users', 'new2'), { active: false }))
await allow('promote a Haifa worker to site admin', () => updateDoc(doc(sa, 'users', 'm'), { siteAdmin: true }))
await allow('demote a fellow Haifa site admin', () => updateDoc(doc(sa, 'users', 'sa2'), { siteAdmin: false }))
await allow('TEMPORARY move of a Haifa worker to Tel Aviv', () =>
  updateDoc(doc(sa, 'users', 'new2'), { tempSiteId: 'tlv', tempEndsAt: future }))
await allow('end a temporary move early', () =>
  updateDoc(doc(sa, 'users', 'new2'), { tempSiteId: deleteField(), tempEndsAt: deleteField() }))
await deny('temporary move without an end date', () => updateDoc(doc(sa, 'users', 'new2'), { tempSiteId: 'tlv' }))
await deny('temporary move to the home site itself', () =>
  updateDoc(doc(sa, 'users', 'new2'), { tempSiteId: 'haifa', tempEndsAt: future }))
await deny('temporary move to a site that does not exist', () =>
  updateDoc(doc(sa, 'users', 'new2'), { tempSiteId: 'nowhere', tempEndsAt: future }))
await allow('PERMANENT move of a Haifa worker to Tel Aviv', () => updateDoc(doc(sa, 'users', 'new2'), { siteId: 'tlv' }))
await deny('...and afterwards that worker is no longer theirs to manage', () =>
  updateDoc(doc(sa, 'users', 'new2'), { role: 'x' }))
await deny('permanent move that keeps site-admin rights (planting an admin)', () =>
  updateDoc(doc(sa, 'users', 'new3'), { siteId: 'tlv' }))
await allow('permanent move of a site admin that drops the rights', () =>
  updateDoc(doc(sa, 'users', 'new3'), { siteId: 'tlv', siteAdmin: false }))
await deny('grant a worker GLOBAL admin', () => updateDoc(doc(sa, 'users', 'm'), { isGlobalAdmin: true }))
await deny('change the global admin', () => updateDoc(doc(sa, 'users', 'g'), { siteAdmin: false }))
await deny('move the global admin', () => updateDoc(doc(sa, 'users', 'g'), { tempSiteId: 'tlv', tempEndsAt: future }))
await deny('change own profile', () => updateDoc(doc(sa, 'users', 'sa'), { role: 'Boss' }))
await deny('change a Tel Aviv worker', () => updateDoc(doc(sa, 'users', 'mt'), { role: 'x' }))
await deny('change a Tel Aviv visitor working at Haifa', () => updateDoc(doc(sa, 'users', 'vis'), { active: false }))
await allow('revoke a Haifa worker', () => deleteDoc(doc(sa, 'users', 'sa2')))
await deny('revoke the global admin', () => deleteDoc(doc(sa, 'users', 'g')))
await deny('revoke self', () => deleteDoc(doc(sa, 'users', 'sa')))
await deny('revoke a Tel Aviv worker', () => deleteDoc(doc(sa, 'users', 'mt')))
await allow('clean up superseded worker documents', () => deleteDoc(doc(sa, 'sites', 'haifa', ...FQ, 'workers', 'old')))
await deny('create a site', () => setDoc(doc(sa, 'sites', 'beer'), { name: 'Beer Sheva' }))
await deny('rename a site', () => updateDoc(doc(sa, 'sites', 'haifa'), { name: 'X' }))

// ---------------------------------------------------------------------------
console.log('\n--- Haifa site admin lent to Tel Aviv this week ---')
const away = as('away')
await allow('still administers the HOME site accounts', () => usersAt(away, 'siteId', 'haifa'))
await allow('still manages a Haifa worker', () => updateDoc(doc(away, 'users', 'm'), { role: 'Senior' }))
await allow('works on the Tel Aviv board meanwhile', () => getDoc(doc(away, ...stateOf('tlv'))))
await deny('but not on the Haifa board', () => getDoc(doc(away, ...stateOf('haifa'))))
await deny('and administers nothing at Tel Aviv', () => updateDoc(doc(away, 'users', 'mt'), { role: 'x' }))

// ---------------------------------------------------------------------------
console.log('\n--- global admin ---')
const g = as('g')
await allow('list every account', () => getDocs(collection(g, 'users')))
await allow('list sites', () => getDocs(collection(g, 'sites')))
await allow('create a site', () => setDoc(doc(g, 'sites', 'beer'), { name: 'Beer Sheva', location: 'South' }))
await deny('create a site with junk fields', () => setDoc(doc(g, 'sites', 'x'), { name: 'X', evil: 1 }))
await deny('create a site with no name', () => setDoc(doc(g, 'sites', 'y'), { name: '' }))
await allow('create a global admin at Eilat', () => setDoc(doc(g, 'users', 'ga2'), person({ siteId: 'eilat', siteAdmin: true, isGlobalAdmin: true })))
await allow('move a site admin permanently, keeping rights', () => updateDoc(doc(g, 'users', 'satlv'), { siteId: 'eilat' }))
await allow('read and write any site queue', () =>
  setDoc(doc(g, ...stateOf('tlv')), stamp('g', { dayQueues: { 2: [] } }), { merge: true }))
await allow('revoke another global admin', () => deleteDoc(doc(g, 'users', 'ga2')))
await deny('revoke self', () => deleteDoc(doc(g, 'users', 'g')))
await deny('rewrite the bootstrap marker', () => updateDoc(doc(g, 'config', 'bootstrap'), { claimedBy: 'g' }))
await deny('delete the bootstrap marker (reopening setup)', () => deleteDoc(doc(g, 'config', 'bootstrap')))
await allow('delete a site', () => deleteDoc(doc(g, 'sites', 'beer')))

// ---------------------------------------------------------------------------
console.log('\n--- pre-sites global admin (isAdmin, no siteId) migrating ---')
const legacy = as('legacy')
await allow('read pre-sites data', () => getDocs(collection(legacy, 'features', 'dispatch-queue', 'workers')))
await deny('a member cannot read pre-sites data', () => getDocs(collection(as('m'), 'features', 'dispatch-queue', 'workers')))
await allow('migration batch: new site + own profile, plaintext WWID stripped', () => {
  const batch = writeBatch(legacy)
  batch.set(doc(legacy, 'sites', 'jerusalem'), { name: 'Jerusalem' })
  batch.update(doc(legacy, 'users', 'legacy'), {
    siteId: 'jerusalem', siteAdmin: true, isGlobalAdmin: true, active: true,
    wwid: deleteField(), isAdmin: deleteField()
  })
  return batch.commit()
})
await allow('delete pre-sites data', () => deleteDoc(doc(legacy, 'features', 'dispatch-queue', 'workers', 'pre')))

// ---------------------------------------------------------------------------
console.log('\n--- jobs ---')
// Fresh actors: earlier sections promote, move and revoke the shared ones.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', 'w1'), person({ siteId: 'haifa' }))           // plain worker
  await setDoc(doc(db, 'users', 'w2'), person({ siteId: 'haifa' }))           // plain worker
  await setDoc(doc(db, 'users', 'wa'), person({ siteId: 'haifa', siteAdmin: true }))
  await setDoc(doc(db, 'users', 'wt'), person({ siteId: 'tlv' }))             // other site
  await setDoc(doc(db, 'users', 'wv'), person({ siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: future }))
  await setDoc(doc(db, 'users', 'wr'), person({ siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: past }))
})
const jobsOf = (site) => ['sites', site, ...FQ, 'jobs']
const newJob = (by, to, extra) => ({
  type: 'pc-refresh', note: 'Room 204', assigneeId: to, assigneeName: 'Someone',
  createdBy: by, createdByName: 'Me', createdAt: serverTimestamp(), status: 'open', ...extra
})
const close = (by) => ({ status: 'done', doneBy: by, doneAt: serverTimestamp() })
const w1 = as('w1')
const w2 = as('w2')
const wa = as('wa')

await allow('a worker assigns a job to a colleague', () => setDoc(doc(w1, ...jobsOf('haifa'), 'j1'), newJob('w1', 'w2')))
await allow('assign to a visitor working here this week', () => setDoc(doc(w1, ...jobsOf('haifa'), 'j2'), newJob('w1', 'wv')))
await allow('assign to yourself', () => setDoc(doc(w1, ...jobsOf('haifa'), 'j3'), newJob('w1', 'w1')))
for (const type of ['pc-refresh', 'otr', 'pc-supply', 'incident', 'quick-it', 'ssd-upgrade', 'ram-upgrade', 'av-incident', 'av-task']) {
  await allow(`type "${type}" is accepted`, () => setDoc(doc(w1, ...jobsOf('haifa'), `t-${type}`), newJob('w1', 'w2', { type })))
}
await deny('assign to a worker at another site', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x1'), newJob('w1', 'wt')))
await deny('assign to someone whose stint here has ended', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x2'), newJob('w1', 'wr')))
await deny('assign to an account that does not exist', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x3'), newJob('w1', 'ghost')))
await deny('an unknown job type', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x4'), newJob('w1', 'w2', { type: 'coffee' })))
await deny('forge who created it', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x5'), newJob('w2', 'w2')))
await deny('backdate it with a client clock', () =>
  setDoc(doc(w1, ...jobsOf('haifa'), 'x6'), newJob('w1', 'w2', { createdAt: Timestamp.fromDate(new Date(2020, 0, 1)) })))
await deny('create it already done', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x7'), newJob('w1', 'w2', { status: 'done' })))
await deny('smuggle an extra field', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x8'), newJob('w1', 'w2', { priority: 'urgent' })))
await deny('a note over 200 characters', () => setDoc(doc(w1, ...jobsOf('haifa'), 'x9'), newJob('w1', 'w2', { note: 'x'.repeat(201) })))
await deny('log a job at another site', () => setDoc(doc(w1, ...jobsOf('tlv'), 'x10'), newJob('w1', 'wt')))
await deny('log a job under another feature', () =>
  setDoc(doc(w1, 'sites', 'haifa', 'features', 'other', 'jobs', 'x11'), newJob('w1', 'w2')))

await allow('everyone at the site sees the open jobs', () => getDocs(collection(w2, ...jobsOf('haifa'))))
await allow('a visitor at the site sees them too', () => getDocs(collection(as('wv'), ...jobsOf('haifa'))))
await deny('a worker at another site does not', () => getDocs(collection(as('wt'), ...jobsOf('haifa'))))
await deny('a stranger does not', () => getDocs(collection(as('stranger'), ...jobsOf('haifa'))))

await deny('a bystander cannot mark it done', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'j2'), close('w2')))
await deny('forge who closed it', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), close('w1')))
await deny('close it and change its type at once', () =>
  updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), { ...close('w2'), type: 'otr' }))
await deny('close it with a client clock', () =>
  updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), { status: 'done', doneBy: 'w2', doneAt: Timestamp.fromDate(new Date(2020, 0, 1)) }))
await deny('edit an open job instead of closing it', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), { note: 'changed' }))
await allow('the assignee marks it done', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), close('w2')))
await deny('a done job cannot be reopened', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'j1'), { status: 'open' }))
await deny('...or closed a second time', () => updateDoc(doc(w1, ...jobsOf('haifa'), 'j1'), close('w1')))
await allow('the creator may mark it done', () => updateDoc(doc(w1, ...jobsOf('haifa'), 'j2'), close('w1')))
await allow('a site admin may mark any job done', () => updateDoc(doc(wa, ...jobsOf('haifa'), 't-otr'), close('wa')))

await deny('the assignee cannot delete a job', () => deleteDoc(doc(w2, ...jobsOf('haifa'), 't-incident')))
await allow('the creator deletes a mistake while open', () => deleteDoc(doc(w1, ...jobsOf('haifa'), 't-incident')))
await deny('the creator cannot delete once done', () => deleteDoc(doc(w1, ...jobsOf('haifa'), 'j2')))
await allow('a site admin can delete any job', () => deleteDoc(doc(wa, ...jobsOf('haifa'), 'j2')))

// ---------------------------------------------------------------------------
console.log('\n--- work processes ---')
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users', 'pg'), person({ siteId: 'tlv', siteAdmin: true, isGlobalAdmin: true }))
  await setDoc(doc(db, 'users', 'pa'), person({ siteId: 'haifa', siteAdmin: true, tempSiteId: 'tlv', tempEndsAt: future }))
  await setDoc(doc(db, 'users', 'pt'), person({ siteId: 'tlv', siteAdmin: true }))
  await setDoc(doc(db, 'sites', 'tlv', 'features', 'work-processes', 'processes', 'tp'),
    { title: 'Tel Aviv only', steps: ['One'], updatedBy: 'pt' })
})
const WP = ['features', 'work-processes', 'processes']
const procOf = (site) => ['sites', site, ...WP]
const proc = (by, extra) => ({
  title: 'SSD upgrade', jobType: 'ssd-upgrade', steps: ['Back up the user data', 'Swap the drive', 'Restore and test'],
  notes: 'Use the cloning dock.', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: by, ...extra
})

await allow('a site admin writes a process for their site', () => setDoc(doc(wa, ...procOf('haifa'), 'p1'), proc('wa')))
await allow('a global admin writes one for any site', () =>
  setDoc(doc(as('pg'), ...procOf('haifa'), 'p2'), proc('pg', { title: 'General', jobType: '' })))
await allow('a site admin lent elsewhere still keeps home processes', () =>
  updateDoc(doc(as('pa'), ...procOf('haifa'), 'p2'), { notes: 'Edited from Tel Aviv', updatedAt: serverTimestamp(), updatedBy: 'pa' }))
await deny('a member cannot write processes', () => setDoc(doc(w1, ...procOf('haifa'), 'x1'), proc('w1')))
await deny("another site's admin cannot either", () => setDoc(doc(as('pt'), ...procOf('haifa'), 'x2'), proc('pt')))
await deny('an unknown job type', () => setDoc(doc(wa, ...procOf('haifa'), 'x3'), proc('wa', { jobType: 'coffee' })))
await deny('a process with no steps', () => setDoc(doc(wa, ...procOf('haifa'), 'x4'), proc('wa', { steps: [] })))
await deny('more than 30 steps', () => setDoc(doc(wa, ...procOf('haifa'), 'x5'), proc('wa', { steps: Array(31).fill('Step') })))
await deny('a title over 80 characters', () => setDoc(doc(wa, ...procOf('haifa'), 'x6'), proc('wa', { title: 'x'.repeat(81) })))
await deny('forge who changed it', () => setDoc(doc(wa, ...procOf('haifa'), 'x7'), proc('w1')))
await deny('stamp it with a client clock', () =>
  setDoc(doc(wa, ...procOf('haifa'), 'x8'), proc('wa', { updatedAt: Timestamp.fromDate(new Date(2020, 0, 1)) })))
await deny('smuggle an extra field', () => setDoc(doc(wa, ...procOf('haifa'), 'x9'), proc('wa', { owner: 'wa' })))
await deny('write under another feature', () =>
  setDoc(doc(wa, 'sites', 'haifa', ...FQ, 'processes', 'x10'), proc('wa')))

await allow('everyone at the site reads them', () => getDocs(collection(w1, ...procOf('haifa'))))
await allow('a visitor at the site reads them', () => getDocs(collection(as('wv'), ...procOf('haifa'))))
await allow('the lent site admin reads home processes', () => getDocs(collection(as('pa'), ...procOf('haifa'))))
await deny('a worker at another site does not', () => getDocs(collection(as('wt'), ...procOf('haifa'))))
await deny('a stranger does not', () => getDocs(collection(as('stranger'), ...procOf('haifa'))))
await deny('a member cannot delete one', () => deleteDoc(doc(w1, ...procOf('haifa'), 'p2')))

console.log('\n--- jobs with a work process ---')
const STEPS = ['Back up the user data', 'Swap the drive', 'Restore and test']
const withProc = (extra) => newJob('w1', 'w2', {
  type: 'ssd-upgrade', processId: 'p1', processTitle: 'SSD upgrade', steps: STEPS, checks: [false, false, false], ...extra
})
await allow('log a job carrying its process as a checklist', () => setDoc(doc(w1, ...jobsOf('haifa'), 'pj1'), withProc()))
await deny('steps that differ from the process', () =>
  setDoc(doc(w1, ...jobsOf('haifa'), 'px1'), withProc({ steps: ['Just swap it'], checks: [false] })))
await deny('a title that differs from the process', () => setDoc(doc(w1, ...jobsOf('haifa'), 'px2'), withProc({ processTitle: 'Other' })))
await deny('steps already ticked', () => setDoc(doc(w1, ...jobsOf('haifa'), 'px3'), withProc({ checks: [true, true, true] })))
await deny('a checklist of the wrong length', () => setDoc(doc(w1, ...jobsOf('haifa'), 'px4'), withProc({ checks: [false] })))
await deny('a process that does not exist', () => setDoc(doc(w1, ...jobsOf('haifa'), 'px5'), withProc({ processId: 'nope' })))
await deny("another site's process", () =>
  setDoc(doc(w1, ...jobsOf('haifa'), 'px6'), withProc({ processId: 'tp', processTitle: 'Tel Aviv only', steps: ['One'], checks: [false] })))
await deny('steps without a process', () =>
  setDoc(doc(w1, ...jobsOf('haifa'), 'px7'), newJob('w1', 'w2', { steps: STEPS, checks: [false, false, false] })))

await deny('cannot be marked done with steps left', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), close('w2')))
await deny('...not even by a site admin', () => updateDoc(doc(wa, ...jobsOf('haifa'), 'pj1'), close('wa')))
await allow('the assignee ticks a step', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [true, false, false] }))
await deny('a bystander cannot tick', () => updateDoc(doc(as('wv'), ...jobsOf('haifa'), 'pj1'), { checks: [true, true, false] }))
await deny('a checklist of the wrong length', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [true, true] }))
await deny('ticks that are not true/false', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [true, 'yes', false] }))
await deny('rewrite the steps', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { steps: ['Done'], checks: [true] }))
await deny('tick and edit the note at once', () =>
  updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [true, true, false], note: 'changed' }))
await deny('tick a job that has no process', () => updateDoc(doc(w2, ...jobsOf('haifa'), 't-otr'), { checks: [] }))
await allow('the creator may tick too', () => updateDoc(doc(w1, ...jobsOf('haifa'), 'pj1'), { checks: [true, true, false] }))
await allow('the assignee ticks the last step', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [true, true, true] }))
await allow('...and then marks it done', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), close('w2')))
await deny('no ticking once done', () => updateDoc(doc(w2, ...jobsOf('haifa'), 'pj1'), { checks: [false, true, true] }))
await allow('a site admin deletes a process; jobs keep their copy', () => deleteDoc(doc(wa, ...procOf('haifa'), 'p2')))

// ---------------------------------------------------------------------------
console.log('\n--- dispatch automation ---')
const DA = ['features', 'dispatch-automation', 'automations']
const autoOf = (site) => ['sites', site, ...DA]
const automation = (by, extra) => ({
  name: 'Grab & Go return', enabled: true, keywords: ['Grab & Go', 'Return'], fileTypes: ['pdf'],
  printFile: true, fileCopies: 1, documents: [{ file: 'LDO.pdf', copies: 1 }],
  sticker: true, stickerLines: ['{ticket}', 'Asset {asset}'], stickerFields: [{ name: 'asset', label: 'Asset tag' }],
  notes: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: by, ...extra
})
await allow('a site admin writes an automation for their site', () => setDoc(doc(wa, ...autoOf('haifa'), 'a1'), automation('wa')))
await allow('a global admin writes one for any site', () => setDoc(doc(as('pg'), ...autoOf('haifa'), 'a2'), automation('pg', { name: 'Other' })))
await allow('a site admin lent elsewhere still keeps home automations', () =>
  updateDoc(doc(as('pa'), ...autoOf('haifa'), 'a2'), { enabled: false, updatedAt: serverTimestamp(), updatedBy: 'pa' }))
await deny('a member cannot write automations', () => setDoc(doc(w1, ...autoOf('haifa'), 'x1'), automation('w1')))
await deny("another site's admin cannot either", () => setDoc(doc(as('pt'), ...autoOf('haifa'), 'x2'), automation('pt')))
await deny('an automation with no keywords', () => setDoc(doc(wa, ...autoOf('haifa'), 'x3'), automation('wa', { keywords: [] })))
await deny('more than 5 copies', () => setDoc(doc(wa, ...autoOf('haifa'), 'x4'), automation('wa', { fileCopies: 6 })))
await deny('copies that are not a whole number', () => setDoc(doc(wa, ...autoOf('haifa'), 'x5'), automation('wa', { fileCopies: 1.5 })))
await deny('more than 10 documents', () => setDoc(doc(wa, ...autoOf('haifa'), 'x6'), automation('wa', { documents: Array(11).fill({ file: 'a.pdf', copies: 1 }) })))
await deny('a name over 80 characters', () => setDoc(doc(wa, ...autoOf('haifa'), 'x7'), automation('wa', { name: 'x'.repeat(81) })))
await deny('forge who changed it', () => setDoc(doc(wa, ...autoOf('haifa'), 'x8'), automation('w1')))
await deny('stamp it with a client clock', () =>
  setDoc(doc(wa, ...autoOf('haifa'), 'x9'), automation('wa', { updatedAt: Timestamp.fromDate(new Date(2020, 0, 1)) })))
await deny('smuggle an extra field', () => setDoc(doc(wa, ...autoOf('haifa'), 'x10'), automation('wa', { script: 'del C:\\' })))
await deny('write under another feature', () => setDoc(doc(wa, 'sites', 'haifa', ...FQ, 'automations', 'x11'), automation('wa')))
await allow('everyone at the site reads them', () => getDocs(collection(w1, ...autoOf('haifa'))))
await allow('a visitor at the site reads them', () => getDocs(collection(as('wv'), ...autoOf('haifa'))))
await deny('a worker at another site does not', () => getDocs(collection(as('wt'), ...autoOf('haifa'))))
await deny('a stranger does not', () => getDocs(collection(as('stranger'), ...autoOf('haifa'))))
await deny('a member cannot delete one', () => deleteDoc(doc(w1, ...autoOf('haifa'), 'a2')))
await allow('a site admin deletes one', () => deleteDoc(doc(wa, ...autoOf('haifa'), 'a2')))

// ---------------------------------------------------------------------------
console.log('\n--- dispatch automation settings (built in now) ---')
const ggPath = (site, id = 'automation') => ['sites', site, 'features', 'dispatch-automation', 'settings', id]
const grabAndGo = (by) => ({
  keywords: ['Grab & Go'], fileTypes: [], types: [], other: { receipt: true, receiptCopies: 1, documents: [], sticker: true },
  stickerFields: [], stickerLines: ['{type}'], watchFolder: '%USERPROFILE%\\Downloads', filesFolder: '%USERPROFILE%\\Documents\\NBLAB print files',
  autoPrint: true, updatedAt: serverTimestamp(), updatedBy: by
})
await deny('nobody stores an automation: it is built into the website', () => setDoc(doc(wa, ...ggPath('haifa')), grabAndGo('wa')))
await deny('not a global admin either', () => setDoc(doc(as('pg'), ...ggPath('haifa')), grabAndGo('pg')))
await deny('nor the old PC settings', () => setDoc(doc(wa, ...ggPath('haifa', 'agent')), { watchFolder: 'C:\\x', filesFolder: 'C:\\y', dryRun: false, updatedAt: serverTimestamp(), updatedBy: 'wa' }))
await deny('what earlier versions stored is not read', () => getDoc(doc(w1, ...ggPath('haifa'))))
await allow('a site admin removes it, with the site', () => deleteDoc(doc(wa, ...ggPath('haifa'))))
await deny('a member does not', () => deleteDoc(doc(w1, ...ggPath('haifa', 'agent'))))

// ---------------------------------------------------------------------------
console.log('\n--- first-time setup on an empty database ---')
await env.clearFirestore()
const first = as('first')
const setupBatch = (db, uid, { marker = true, profile = true, site = true, globalFlag = true, claimedBy } = {}) => {
  const batch = writeBatch(db)
  if (site) batch.set(doc(db, 'sites', 'haifa'), { name: 'Haifa' })
  if (profile) batch.set(doc(db, 'users', uid), person({ name: 'First', role: 'Administrator', siteId: 'haifa', siteAdmin: true, isGlobalAdmin: globalFlag }))
  if (marker) batch.set(doc(db, 'config', 'bootstrap'), { claimedBy: claimedBy || uid })
  return batch.commit()
}
await deny('profile without the marker', () => setupBatch(first, 'first', { marker: false }))
await deny('marker without the profile', () => setupBatch(first, 'first', { profile: false }))
await deny('marker claimed on behalf of someone else', () => setupBatch(first, 'first', { claimedBy: 'someone' }))
await deny('setup as a non-global profile', () => setupBatch(first, 'first', { globalFlag: false }))
await allow('complete setup batch (site + global admin + marker)', () => setupBatch(first, 'first'))
await deny('a second person replays setup afterwards', () => setupBatch(as('second'), 'second'))
await deny('the first admin cannot reopen setup', () => deleteDoc(doc(first, 'config', 'bootstrap')))

// ---------------------------------------------------------------------------
await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  - ' + failures.join('\n  - '))
process.exit(fail ? 1 : 0)
