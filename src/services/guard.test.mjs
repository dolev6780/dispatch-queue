/**
 * Regression tests for the save circuit breaker.
 *
 * On 2026-09-27 the shared board was blanked: a station pushed freshly-mounted
 * state (empty roster, empty dayQueues map) over the live document, and every
 * other station picked it up. These assertions pin down the difference between
 * "never loaded" and "deliberately emptied".
 *
 * looksUninitialised is re-implemented here rather than imported, because
 * importing services/firebase.js would pull in the Firebase SDK and a browser
 * environment. The two must stay in step — the shapes are asserted below.
 */
const looksUninitialised = (patch) => {
  if (!patch) return true
  if (Array.isArray(patch.roster) && patch.roster.length === 0) return true
  if (
    patch.dayQueues &&
    typeof patch.dayQueues === 'object' &&
    Object.keys(patch.dayQueues).length === 0
  ) return true
  return false
}

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = got === want
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got ${got}, want ${want}`)
}

const roster = [{ id: '1', name: 'Dolev' }]
const sevenEmptyQueues = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }

console.log('--- blocks state that was never loaded ---')
eq('exact shape that blanked the board', looksUninitialised({ roster: [], dayQueues: {} }), true)
eq('empty roster alone', looksUninitialised({ roster: [], dayQueues: sevenEmptyQueues }), true)
eq('empty dayQueues map alone', looksUninitialised({ roster, dayQueues: {} }), true)
eq('nothing at all', looksUninitialised(null), true)
eq('undefined', looksUninitialised(undefined), true)

console.log('--- allows legitimate boards ---')
eq('a normal save', looksUninitialised({ roster, dayQueues: { 0: ['1'] } }), false)
eq('"clear all queues" writes SEVEN empty lists, not an empty map',
  looksUninitialised({ roster, dayQueues: sevenEmptyQueues }), false)
eq('a single cleared day', looksUninitialised({ roster, dayQueues: { 4: [] } }), false)
eq('patch that omits dayQueues entirely', looksUninitialised({ roster }), false)
eq('patch carrying only schedules', looksUninitialised({ daySchedules: {} }), false)

console.log('--- the distinction that matters ---')
// Both of these "look empty" to a careless check. Only the first is a bug.
eq('empty map  -> blocked', looksUninitialised({ roster, dayQueues: {} }), true)
eq('empty lists -> allowed', looksUninitialised({ roster, dayQueues: sevenEmptyQueues }), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
