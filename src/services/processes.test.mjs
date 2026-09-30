import {
  cleanSteps, validateProcess, sortProcesses, processForType, linkedTypes, moveStep, MAX_STEPS
} from './processes.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- steps ---')
eq('trims and drops blank steps', cleanSteps(['  Back up ', '', '   ', 'Swap']), ['Back up', 'Swap'])
eq('nothing in, nothing out', cleanSteps(undefined), [])

console.log('--- validation ---')
const ok = { title: 'SSD upgrade', steps: ['Back up', 'Swap'], notes: '' }
eq('a valid process', validateProcess(ok), null)
eq('needs a title', validateProcess({ ...ok, title: '  ' }), 'Give the process a title.')
eq('title limit', validateProcess({ ...ok, title: 'x'.repeat(81) }), 'Keep the title under 80 characters.')
eq('needs a step', validateProcess({ ...ok, steps: ['', ' '] }), 'Add at least one step.')
eq('step count limit', validateProcess({ ...ok, steps: Array(MAX_STEPS + 1).fill('Step') }), 'A process can have at most 30 steps.')
eq('step length limit', validateProcess({ ...ok, steps: ['x'.repeat(201)] }), 'Keep each step under 200 characters.')
eq('notes limit', validateProcess({ ...ok, notes: 'x'.repeat(2001) }), 'Keep the notes under 2000 characters.')

console.log('--- linking to job types ---')
const list = [
  { id: 'b', title: 'SSD swap (old)', jobType: 'ssd-upgrade' },
  { id: 'a', title: 'SSD swap', jobType: 'ssd-upgrade' },
  { id: 'c', title: 'Onboarding', jobType: '' }
]
eq('sorted by title', sortProcesses(list).map(p => p.id), ['c', 'a', 'b'])
eq('the process for a type (first by title)', processForType(list, 'ssd-upgrade')?.id, 'a')
eq('no process for an unlinked type', processForType(list, 'otr'), null)
eq('no type, no process', processForType(list, ''), null)
eq('types taken by other processes', [...linkedTypes(list, 'a')], ['ssd-upgrade'])
eq('unlinked processes take no type', linkedTypes([{ id: 'c', jobType: '' }], null).size, 0)

console.log('--- reordering ---')
eq('move a step up', moveStep(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'])
eq('move a step down', moveStep(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b'])
eq('the first step cannot go up', moveStep(['a', 'b'], 0, -1), ['a', 'b'])
eq('the last step cannot go down', moveStep(['a', 'b'], 1, 1), ['a', 'b'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
