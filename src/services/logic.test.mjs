/**
 * Tests for roles, queue operations, the WWID mask and the daily-reset date
 * comparison. Each block pins down a defect found in review, so a regression
 * shows up here rather than on the live board.
 */
import {
  isGlobalAdmin, isSiteAdminOf, canUseSite, needsSiteSetup,
  canManageAccount, grantableFlags, isTempMoveActive, currentSiteOf,
  adminSiteOf, siteAdminAfterPermanentMove, endOfLastDay, lastDayOf, workersAt
} from './roles.js'
import { toggleId, moveById, addMissing, removeFromAllDays, toSlug } from './queueOps.js'
import { maskWwid } from './credentials.js'
import { resolveDailyReset } from './dailyReset.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const member = { uid: 'm', siteId: 'haifa' }
const siteAdmin = { uid: 'sa', siteId: 'haifa', siteAdmin: true }
const otherSiteAdmin = { uid: 'oa', siteId: 'tlv', siteAdmin: true }
const global = { uid: 'g', siteId: 'haifa', isGlobalAdmin: true }
const legacyAdmin = { uid: 'l', isAdmin: true } // pre-sites profile

console.log('--- roles: levels ---')
eq('member is not global', isGlobalAdmin(member), false)
eq('global flag', isGlobalAdmin(global), true)
eq('legacy isAdmin counts as global until migrated', isGlobalAdmin(legacyAdmin), true)
eq('site admin of own site', isSiteAdminOf(siteAdmin, 'haifa'), true)
eq('site admin NOT of another site', isSiteAdminOf(siteAdmin, 'tlv'), false)
eq('global admin administers every site', isSiteAdminOf(global, 'tlv'), true)
eq('member is not a site admin', isSiteAdminOf(member, 'haifa'), false)

console.log('--- roles: site access ---')
eq('member uses own site', canUseSite(member, 'haifa'), true)
eq('member cannot use another site', canUseSite(member, 'tlv'), false)
eq('global uses any site', canUseSite(global, 'tlv'), true)
eq('no profile, no site', canUseSite(null, 'haifa'), false)
eq('legacy profile needs site setup', needsSiteSetup(legacyAdmin), true)
eq('sited profile does not', needsSiteSetup(member), false)

console.log('--- roles: account management ---')
eq('site admin manages a member at own site', canManageAccount(siteAdmin, member), true)
eq('site admin cannot manage another site', canManageAccount(siteAdmin, { uid: 'x', siteId: 'tlv' }), false)
eq('site admin cannot touch a global admin', canManageAccount(siteAdmin, global), false)
eq('site admin cannot manage themselves', canManageAccount(siteAdmin, siteAdmin), false)
eq('member manages nobody', canManageAccount(member, { uid: 'y', siteId: 'haifa' }), false)
eq('global manages anyone else', canManageAccount(global, otherSiteAdmin), true)
eq('global cannot manage themselves', canManageAccount(global, global), false)
eq('site admin may grant site admin, not global', grantableFlags(siteAdmin), { siteAdmin: true, globalAdmin: false })
eq('global may grant both', grantableFlags(global), { siteAdmin: true, globalAdmin: true })
eq('member may grant nothing', grantableFlags(member), { siteAdmin: false, globalAdmin: false })

console.log('--- temporary moves ---')
const NOW = new Date(2026, 8, 28, 12, 0)
const future = new Date(2026, 9, 6)          // ends Oct 6 00:00
const past = new Date(2026, 8, 27)
const visitor = { uid: 'v', siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: future }
const returned = { uid: 'r', siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: past }
const awayAdmin = { uid: 'aa', siteId: 'haifa', siteAdmin: true, tempSiteId: 'tlv', tempEndsAt: future }
eq('active move', isTempMoveActive(visitor, NOW), true)
eq('expired move', isTempMoveActive(returned, NOW), false)
eq('Firestore Timestamp shape works', isTempMoveActive({ tempSiteId: 'x', tempEndsAt: { toMillis: () => future.getTime() } }, NOW), true)
eq('seconds-only shape works', isTempMoveActive({ tempSiteId: 'x', tempEndsAt: { seconds: future.getTime() / 1000 } }, NOW), true)
eq('no end date is not a move', isTempMoveActive({ tempSiteId: 'x' }, NOW), false)
eq('visitor works at the temporary site', currentSiteOf(visitor, NOW), 'haifa')
eq('after the end date, back home', currentSiteOf(returned, NOW), 'tlv')
eq('ends exactly at midnight after the last day',
  [currentSiteOf(visitor, new Date(2026, 9, 5, 23, 59)), currentSiteOf(visitor, new Date(2026, 9, 6, 0, 0))], ['haifa', 'tlv'])
eq('visitor may use the temporary site', canUseSite(visitor, 'haifa', NOW), true)
eq('visitor may NOT use home meanwhile (fully relocated)', canUseSite(visitor, 'tlv', NOW), false)
eq('lent site admin still administers home', isSiteAdminOf(awayAdmin, 'haifa'), true)
eq('lent site admin does not administer the host', isSiteAdminOf(awayAdmin, 'tlv'), false)
eq('lent site admin works at the host', currentSiteOf(awayAdmin, NOW), 'tlv')
eq('admin page site: site admin -> home', adminSiteOf(awayAdmin, 'tlv'), 'haifa')
eq('admin page site: global -> active', adminSiteOf(global, 'tlv'), 'tlv')
eq('admin page site: member -> none', adminSiteOf(member, 'haifa'), null)
eq('site admin cannot manage a visitor from another site', canManageAccount(siteAdmin, visitor), false)
eq('site admin permanent move drops rights', siteAdminAfterPermanentMove(siteAdmin, { siteAdmin: true }), false)
eq('global permanent move keeps rights', siteAdminAfterPermanentMove(global, { siteAdmin: true }), true)

console.log('--- end-of-day arithmetic ---')
eq('last day Oct 5 ends at local Oct 6 00:00', endOfLastDay('2026-10-05').getTime(), new Date(2026, 9, 6).getTime())
eq('month rollover', endOfLastDay('2026-10-31').getTime(), new Date(2026, 10, 1).getTime())
eq('year rollover', endOfLastDay('2026-12-31').getTime(), new Date(2027, 0, 1).getTime())
eq('garbage gives null', endOfLastDay('nope'), null)
eq('lastDayOf round-trips', lastDayOf(endOfLastDay('2026-10-05')), '2026-10-05')
eq('lastDayOf of nothing', lastDayOf(null), null)

console.log('--- workers at a site ---')
const homeResidents = [
  { uid: 'a', name: 'Dani', siteId: 'haifa' },
  { uid: 'b', name: 'Chen', siteId: 'haifa', active: false },
  { uid: 'c', name: 'Alen', siteId: 'haifa', tempSiteId: 'tlv', tempEndsAt: future }
]
const visitors = [
  { uid: 'v', name: 'Yair', siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: future },
  { uid: 'r', name: 'Old', siteId: 'tlv', tempSiteId: 'haifa', tempEndsAt: past }
]
eq('home residents + active visitors, minus hidden, away and expired',
  workersAt('haifa', homeResidents, visitors, NOW).map(p => p.name), ['Dani', 'Yair'])
eq('the same person in both lists appears once',
  workersAt('haifa', [visitors[0]], [visitors[0]], NOW).length, 1)

console.log('--- queueOps ---')
eq('toggle adds', toggleId(['a'], 'b'), ['a', 'b'])
eq('toggle removes', toggleId(['a', 'b'], 'a'), ['b'])
// stored: a, X(hidden), b, c — the arrows must skip X, not swap with it
const stored = ['a', 'X', 'b', 'c']
const visible = ['a', 'b', 'c']
eq('move down skips a hidden id', moveById(stored, visible, 'a', 1), ['b', 'X', 'a', 'c'])
eq('move up skips a hidden id', moveById(stored, visible, 'b', -1), ['b', 'X', 'a', 'c'])
eq('hidden id keeps its slot', moveById(stored, visible, 'c', -1)[1], 'X')
eq('cannot move top up', moveById(stored, visible, 'a', -1), stored)
eq('cannot move bottom down', moveById(stored, visible, 'c', 1), stored)
eq('unknown id is a no-op', moveById(stored, visible, 'zz', 1), stored)
eq('add missing keeps hand-set order', addMissing(['c', 'a'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd'])
eq('add missing when all present', addMissing(['a'], ['a']), ['a'])
eq('remove from all days',
  removeFromAllDays({ 0: ['a', 'b'], 1: ['b'], 2: [] }, 'b'), { 0: ['a'], 1: [], 2: [] })
eq('slug', toSlug('  Haifa Lab #2 '), 'haifa-lab-2')
eq('slug of symbols is empty', toSlug('!!!'), '')

console.log('--- maskWwid: never reveals the credential ---')
eq('4 chars', maskWwid('4471'), '••71')
eq('3 chars shows one', maskWwid('A12'), '••2')
eq('long id', maskWwid('ABCDEFG'), '•••••FG')
eq('normalises first', maskWwid(' a12b '), '••2B')
eq('empty', maskWwid(''), '')
eq('mask does not contain the full id', maskWwid('4471').includes('4471'), false)

console.log('--- daily reset: clock skew between stations ---')
const loaded = { isStateLoaded: true }
eq('earlier stored date resets', resolveDailyReset({ ...loaded, lastResetDate: '2026-09-26', todayDateKey: '2026-09-27' }).action, 'reset')
eq('same date is a no-op', resolveDailyReset({ ...loaded, lastResetDate: '2026-09-27', todayDateKey: '2026-09-27' }).action, 'none')
eq('a date in the FUTURE is a no-op, not a reset',
  resolveDailyReset({ ...loaded, lastResetDate: '2026-09-28', todayDateKey: '2026-09-27' }).action, 'none')
eq('month boundary compares as strings', resolveDailyReset({ ...loaded, lastResetDate: '2026-09-30', todayDateKey: '2026-10-01' }).action, 'reset')
eq('year boundary compares as strings', resolveDailyReset({ ...loaded, lastResetDate: '2026-12-31', todayDateKey: '2027-01-01' }).action, 'reset')
// Simulate two stations whose clocks straddle midnight.
let stored2 = '2026-09-27'
const stationA = '2026-09-28' // clock already past midnight
const stationB = '2026-09-27' // a few seconds behind
const a = resolveDailyReset({ ...loaded, lastResetDate: stored2, todayDateKey: stationA })
if (a.date) stored2 = a.date
const b = resolveDailyReset({ ...loaded, lastResetDate: stored2, todayDateKey: stationB })
eq('station A resets once at its midnight', a.action, 'reset')
eq('station B, still yesterday, does NOT bounce it back', b.action, 'none')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
