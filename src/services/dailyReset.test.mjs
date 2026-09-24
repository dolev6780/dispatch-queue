import { toDateKey, resolveDailyReset } from './dailyReset.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- toDateKey uses LOCAL date, not UTC ---')
// 23:30 local on the 5th. toISOString() in a UTC+3 zone would say the 5th too,
// but at 01:00 local on the 6th it would still say the 5th. Check local parts.
eq('pads month and day', toDateKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
eq('midnight is the new day', toDateKey(new Date(2026, 0, 6, 0, 0, 1)), '2026-01-06')
eq('23:59:59 is still old day', toDateKey(new Date(2026, 0, 5, 23, 59, 59)), '2026-01-05')
eq('december rollover', toDateKey(new Date(2026, 11, 31, 12, 0)), '2026-12-31')

console.log('--- policy ---')
const T = '2026-01-06'
const Y = '2026-01-05'

eq('waits until state has loaded',
  resolveDailyReset({ isStateLoaded: false, lastResetDate: Y, todayDateKey: T }),
  { action: 'wait' })

eq('waits even when never reset (fresh station, no sync yet)',
  resolveDailyReset({ isStateLoaded: false, lastResetDate: null, todayDateKey: T }),
  { action: 'wait' })

eq('first ever run adopts today WITHOUT clearing',
  resolveDailyReset({ isStateLoaded: true, lastResetDate: null, todayDateKey: T }),
  { action: 'adopt', date: T })

eq('undefined (field absent in Firestore) also adopts',
  resolveDailyReset({ isStateLoaded: true, lastResetDate: undefined, todayDateKey: T }),
  { action: 'adopt', date: T })

eq('new day clears the queue',
  resolveDailyReset({ isStateLoaded: true, lastResetDate: Y, todayDateKey: T }),
  { action: 'reset', date: T })

eq('already reset today does nothing',
  resolveDailyReset({ isStateLoaded: true, lastResetDate: T, todayDateKey: T }),
  { action: 'none' })

console.log('--- scenario: station opens mid-morning after another already built the queue ---')
// Station B boots. Before sync lands it must NOT clear.
let s = resolveDailyReset({ isStateLoaded: false, lastResetDate: null, todayDateKey: T })
eq('before sync -> wait (queue is safe)', s, { action: 'wait' })
// Sync arrives carrying lastResetDate = today, set by station A at midnight.
s = resolveDailyReset({ isStateLoaded: true, lastResetDate: T, todayDateKey: T })
eq('after sync -> none (does not wipe station A work)', s, { action: 'none' })

console.log('--- scenario: two stations both open when the clock turns ---')
const a = resolveDailyReset({ isStateLoaded: true, lastResetDate: Y, todayDateKey: T })
const b = resolveDailyReset({ isStateLoaded: true, lastResetDate: Y, todayDateKey: T })
eq('both decide reset (idempotent, converges)', [a, b], [{ action: 'reset', date: T }, { action: 'reset', date: T }])
// After the first write propagates, the second station re-evaluates:
eq('second station then settles to none',
  resolveDailyReset({ isStateLoaded: true, lastResetDate: T, todayDateKey: T }),
  { action: 'none' })

console.log('--- scenario: display left running across midnight ---')
let state = { isStateLoaded: true, lastResetDate: '2026-01-05' }
const tick = (d) => {
  const key = toDateKey(d)
  const r = resolveDailyReset({ ...state, todayDateKey: key })
  if (r.date) state.lastResetDate = r.date
  return r.action
}
eq('23:59:59 -> none', tick(new Date(2026, 0, 5, 23, 59, 59)), 'none')
eq('00:00:01 -> reset', tick(new Date(2026, 0, 6, 0, 0, 1)), 'reset')
eq('00:00:02 -> none (does not re-fire every tick)', tick(new Date(2026, 0, 6, 0, 0, 2)), 'none')
eq('09:00 same day -> none', tick(new Date(2026, 0, 6, 9, 0)), 'none')
eq('next midnight -> reset again', tick(new Date(2026, 0, 7, 0, 0, 1)), 'reset')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
