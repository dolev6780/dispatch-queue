import {
  buildDaysOfWeek,
  buildSchedule,
  timeStringToMinutes,
  formatTime,
  formatDuration,
  minutesSinceMidnight,
  DEFAULT_DAY_SCHEDULES
} from './schedule.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const people = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), role: 'Dispatch' }))
const days = buildDaysOfWeek(DEFAULT_DAY_SCHEDULES)
const sunday = days[0]   // 08:00–15:30 = 450 min
const monday = days[1]   // 08:00–16:30 = 510 min
const friday = days[5]   // day off

console.log('--- time helpers ---')
eq('timeStringToMinutes 08:00', timeStringToMinutes('08:00'), 480)
eq('timeStringToMinutes 16:30', timeStringToMinutes('16:30'), 990)
eq('timeStringToMinutes empty', timeStringToMinutes(''), 0)
eq('formatTime pads', formatTime(485), '08:05')
eq('formatDuration', formatDuration(150), '2h 30m')
eq('minutesSinceMidnight', minutesSinceMidnight(new Date(2026, 0, 5, 9, 30, 0)), 570)

console.log('--- buildDaysOfWeek ---')
eq('sunday total is 450 min', sunday.totalMinutes, 450)
eq('monday total is 510 min', monday.totalMinutes, 510)
eq('friday is off', [friday.isWorkDay, friday.totalMinutes], [false, 0])
eq('defaults are not flagged custom', days.map(d => d.isCustom), [false, false, false, false, false, false, false])
eq('changed hours flag as custom',
  buildDaysOfWeek({ ...DEFAULT_DAY_SCHEDULES, 1: { isWorkDay: true, startTime: '07:00', endTime: '16:30' } })[1].isCustom,
  true)

console.log('--- buildSchedule: splitting ---')
let s = buildSchedule({ day: monday, people, nowMinutes: 0, isToday: false })
eq('one slot per person', s.length, 3)
eq('positions are 1-based', s.map(p => p.position), [1, 2, 3])
eq('slots are contiguous', [s[0].endMins, s[1].startMins], [s[1].startMins, s[1].startMins])
eq('first slot starts at shift start', s[0].startTimeStr, '08:00')
eq('LAST slot is pinned to shift end (no rounding drift)', s[2].endTimeStr, '16:30')
eq('510 / 3 = 170 min each', s.map(p => p.endMins - p.startMins), [170, 170, 170])

console.log('--- buildSchedule: uneven split still ends exactly on time ---')
const seven = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `P${i}` }))
s = buildSchedule({ day: sunday, people: seven, nowMinutes: 0, isToday: false })
eq('7 people over 450 min -> last slot ends at 15:30', s[6].endTimeStr, '15:30')
eq('no gaps between any slots',
  s.slice(1).every((slot, i) => slot.startMins === s[i].endMins), true)
eq('total covered equals the shift length',
  s[s.length - 1].endMins - s[0].startMins, 450)

console.log('--- buildSchedule: live statuses on the current day ---')
// Monday, 3 people, 170 min each: 08:00-10:50, 10:50-13:40, 13:40-16:30
const at = (h, m) => buildSchedule({ day: monday, people, nowMinutes: h * 60 + m, isToday: true })
eq('before the shift -> first is up-next', at(7, 0).map(p => p.status), ['up-next', 'scheduled', 'scheduled'])
eq('09:00 -> first serving', at(9, 0).map(p => p.status), ['serving', 'up-next', 'scheduled'])
eq('11:00 -> second serving', at(11, 0).map(p => p.status), ['completed', 'serving', 'up-next'])
eq('15:00 -> third serving', at(15, 0).map(p => p.status), ['completed', 'completed', 'serving'])
eq('after the shift -> all completed', at(17, 0).map(p => p.status), ['completed', 'completed', 'completed'])

console.log('--- buildSchedule: progress and remaining ---')
const mid = at(9, 25)[0]  // 85 min into a 170 min slot
eq('halfway through reports ~50%', Math.round(mid.progressPercent), 50)
eq('halfway through reports 85 min left', mid.remainingMinutes, 85)
const startOfSlot = at(8, 0)[0]
eq('slot start reports 0%', Math.round(startOfSlot.progressPercent), 0)

console.log('--- buildSchedule: guards ---')
eq('non-working day yields nothing', buildSchedule({ day: friday, people, nowMinutes: 600, isToday: true }), [])
eq('no people yields nothing', buildSchedule({ day: monday, people: [], nowMinutes: 600, isToday: true }), [])
eq('missing day yields nothing', buildSchedule({ day: null, people, nowMinutes: 600, isToday: true }), [])
eq('other days never show serving',
  buildSchedule({ day: monday, people, nowMinutes: 9 * 60, isToday: false }).map(p => p.status),
  ['up-next', 'scheduled', 'scheduled'])

console.log('--- buildSchedule: single person takes the whole shift ---')
s = buildSchedule({ day: monday, people: [people[0]], nowMinutes: 9 * 60, isToday: true })
eq('one slot covering the full day', [s[0].startTimeStr, s[0].endTimeStr], ['08:00', '16:30'])
eq('and it is serving', s[0].status, 'serving')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
