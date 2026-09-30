import {
  formatHM, formatLongDate, formatMediumDate, formatShortDate, formatClockHM, formatClockHMS,
  siteLabel, initialsOf, firstNameOf
} from './format.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const mon = new Date(2026, 8, 28, 11, 4)
eq('time left 71 min -> 1:11', formatHM(71), '1:11')
eq('under an hour -> 0:45', formatHM(45), '0:45')
eq('rounds up partial minutes', formatHM(70.2), '1:11')
eq('never negative', formatHM(-5), '0:00')
eq('long date', formatLongDate(mon), 'Monday 28 September')
eq('medium date', formatMediumDate(mon), 'Mon 28 Sep')
eq('short date from a Date', formatShortDate(new Date(2026, 9, 1)), 'Thu 1 Oct')
eq('short date from YYYY-MM-DD', formatShortDate('2026-10-04'), 'Sun 4 Oct')
eq('short date from a Timestamp shape', formatShortDate({ toMillis: () => new Date(2026, 9, 1).getTime() }), 'Thu 1 Oct')
eq('short date of nothing', formatShortDate(null), '')
eq('clock', formatClockHM(mon), '11:04')
eq('clock pads', formatClockHM(new Date(2026, 8, 28, 9, 5)), '09:05')
eq('clock of nothing', formatClockHM(null), '--:--')
eq('clock with seconds', formatClockHMS(new Date(2026, 8, 28, 9, 5, 7)), '09:05:07')
eq('clock with seconds of nothing', formatClockHMS(null), '--:--:--')
eq('site label with description', siteLabel({ name: 'L12', location: 'Main lab' }), 'L12 · Main lab')
eq('site label without', siteLabel({ name: 'L9' }), 'L9')
eq('site label of nothing', siteLabel(null), '')
eq('initials', initialsOf('Dana Levi'), 'DL')
eq('initials, one name', initialsOf('Noa'), 'N')
eq('initials, three names', initialsOf('Noa Ben David'), 'NB')
eq('initials of nothing', initialsOf(''), '?')
eq('first name', firstNameOf('Yossi Katz'), 'Yossi')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
