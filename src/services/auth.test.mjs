import {
  normaliseWorkId,
  hashWorkId,
  findMemberByWorkId,
  hasAnyAdmin,
  isWorkIdTaken,
  resolveSession
} from './auth.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- normaliseWorkId ---')
eq('trims', normaliseWorkId('  A12  '), 'A12')
eq('upper-cases', normaliseWorkId('a12'), 'A12')
eq('null is empty', normaliseWorkId(null), '')
eq('undefined is empty', normaliseWorkId(undefined), '')
eq('number works', normaliseWorkId(4471), '4471')

console.log('--- hashWorkId ---')
const h1 = await hashWorkId('4471')
const h2 = await hashWorkId(' 4471 ')
const h3 = await hashWorkId('4472')
eq('is 64 hex chars (sha-256)', /^[0-9a-f]{64}$/.test(h1), true)
eq('is stable across whitespace', h1, h2)
eq('differs for a different id', h1 === h3, false)
eq('empty id gives null', await hashWorkId(''), null)
eq('whitespace-only gives null', await hashWorkId('   '), null)
eq('does NOT contain the plaintext id', h1.includes('4471'), false)

console.log('--- findMemberByWorkId ---')
const roster = [
  { id: '1', name: 'Komer', workIdHash: await hashWorkId('1001') },
  { id: '2', name: 'Alen', workIdHash: await hashWorkId('1002'), isAdmin: true },
  { id: '3', name: 'Dani' } // never set a work id
]
eq('matches the right member', (await findMemberByWorkId(roster, '1001')).name, 'Komer')
eq('is case and space insensitive', (await findMemberByWorkId(roster, ' 1002 ')).name, 'Alen')
eq('unknown id gives null', await findMemberByWorkId(roster, '9999'), null)
eq('empty id gives null', await findMemberByWorkId(roster, ''), null)
eq('member without a work id is unreachable', await findMemberByWorkId(roster, undefined), null)
eq('empty roster gives null', await findMemberByWorkId([], '1001'), null)

console.log('--- hasAnyAdmin ---')
eq('true when an admin has an id', hasAnyAdmin(roster), true)
eq('false when nobody is admin', hasAnyAdmin([{ id: '1', workIdHash: 'x' }]), false)
eq('false when the admin has no id set', hasAnyAdmin([{ id: '1', isAdmin: true }]), false)
eq('false for an empty roster', hasAnyAdmin([]), false)

console.log('--- isWorkIdTaken ---')
eq('taken by someone else', await isWorkIdTaken(roster, '1001'), true)
eq('not taken', await isWorkIdTaken(roster, '5555'), false)
eq('own id is not a clash', await isWorkIdTaken(roster, '1001', '1'), false)
eq('someone else keeping it is a clash', await isWorkIdTaken(roster, '1001', '2'), true)

console.log('--- resolveSession ---')
const live = [{ id: '2', name: 'Alen', role: 'Dispatch', isAdmin: true }]
eq('derives name and admin from the LIVE roster',
  resolveSession({ id: '2', signedInAt: 1 }, live),
  { id: '2', name: 'Alen', role: 'Dispatch', isAdmin: true, signedInAt: 1 })
eq('null session resolves to null', resolveSession(null, live), null)
eq('removed member resolves to null', resolveSession({ id: '99', signedInAt: 1 }, live), null)
// The session cannot grant admin on its own: a tampered localStorage claiming
// isAdmin is ignored because rights come from the roster.
eq('session cannot invent admin rights',
  resolveSession({ id: '2', signedInAt: 1, isAdmin: true }, [{ id: '2', name: 'Alen', role: 'D' }]).isAdmin,
  false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
