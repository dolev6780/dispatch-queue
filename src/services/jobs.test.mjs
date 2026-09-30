import {
  JOB_TYPES, JOB_TYPE_IDS, jobTypeOf, validateNewJob, sortOpenJobs,
  detectNewJobs, alertKindFor, canCompleteJob, canDeleteJob, waitingFor, startOfDay,
  checklistOf, toggleCheck, processFields, canTickJob, canFinishJob
} from './jobs.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- job types ---')
eq('the nine requested types, in order', JOB_TYPES.map(t => t.label),
  ['PC Refresh', 'OTR', 'PC Supply', 'Incident', 'Quick IT', 'SSD Upgrade', 'RAM Upgrade', 'AV Incident', 'AV Task'])
eq('ids are unique', new Set(JOB_TYPE_IDS).size, JOB_TYPES.length)
eq('ids are rule-safe slugs', JOB_TYPE_IDS.every(id => /^[a-z0-9-]+$/.test(id)), true)
eq('lookup by id', jobTypeOf('otr').label, 'OTR')
eq('unknown id still renders', jobTypeOf('mystery').label, 'mystery')

console.log('--- validation ---')
eq('valid job', validateNewJob({ type: 'incident', assigneeId: 'u1', note: 'Room 4' }), null)
eq('note is optional', validateNewJob({ type: 'otr', assigneeId: 'u1' }), null)
eq('unknown type', validateNewJob({ type: 'coffee', assigneeId: 'u1' }), 'Choose a job type.')
eq('no assignee', validateNewJob({ type: 'otr', assigneeId: '' }), 'Choose who the job is for.')
eq('note too long', validateNewJob({ type: 'otr', assigneeId: 'u', note: 'x'.repeat(201) }),
  'Keep the note under 200 characters.')

console.log('--- ordering: longest-waiting first ---')
const t = (ms) => ({ toMillis: () => ms })
eq('oldest on top; pending server time last',
  sortOpenJobs([{ id: 'b', createdAt: t(200) }, { id: 'pending', createdAt: null }, { id: 'a', createdAt: t(100) }]).map(j => j.id),
  ['a', 'b', 'pending'])

console.log('--- new-job detection ---')
let known = new Set()
let r = detectNewJobs(known, [{ id: 'j1' }, { id: 'j2' }], true)
eq('first snapshot never rings (jobs already open at start-up)', r.fresh, [])
known = r.nextKnown
r = detectNewJobs(known, [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }], false)
eq('a job appearing later rings once', r.fresh.map(j => j.id), ['j3'])
known = r.nextKnown
r = detectNewJobs(known, [{ id: 'j1' }, { id: 'j3' }], false)
eq('a job closing elsewhere does not ring', r.fresh, [])
known = r.nextKnown
r = detectNewJobs(known, [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }], false)
eq('re-delivery after a reconnect does not ring again', r.fresh, [])

console.log('--- who gets which alert ---')
eq('assigned to me', alertKindFor({ assigneeId: 'me', createdBy: 'x' }, 'me'), 'mine')
eq('I assigned it to myself: still mine', alertKindFor({ assigneeId: 'me', createdBy: 'me' }, 'me'), 'mine')
eq('I assigned it to someone else: silent for me', alertKindFor({ assigneeId: 'x', createdBy: 'me' }, 'me'), 'self')
eq('someone else\'s job', alertKindFor({ assigneeId: 'x', createdBy: 'y' }, 'me'), 'other')

console.log('--- completing and deleting ---')
const job = { status: 'open', assigneeId: 'a', createdBy: 'c' }
eq('assignee may complete', canCompleteJob(job, 'a', false), true)
eq('creator may complete', canCompleteJob(job, 'c', false), true)
eq('site admin may complete', canCompleteJob(job, 'z', true), true)
eq('a bystander may not', canCompleteJob(job, 'z', false), false)
eq('a done job cannot be completed again', canCompleteJob({ ...job, status: 'done' }, 'a', false), false)
eq('creator may delete while open', canDeleteJob(job, 'c', false), true)
eq('creator may not delete once done', canDeleteJob({ ...job, status: 'done' }, 'c', false), false)
eq('assignee may not delete', canDeleteJob(job, 'a', false), false)
eq('admin may delete', canDeleteJob({ ...job, status: 'done' }, 'z', true), true)

console.log('--- work-process checklists ---')
const proc = { id: 'p1', title: 'SSD upgrade', steps: ['Back up', 'Swap', 'Test'], jobType: 'ssd-upgrade' }
const fields = processFields(proc)
eq('a new job copies the process, nothing ticked', fields,
  { processId: 'p1', processTitle: 'SSD upgrade', steps: ['Back up', 'Swap', 'Test'], checks: [false, false, false] })
eq('the copy does not share the process array', fields.steps !== proc.steps, true)
eq('no process, no fields', processFields(null), {})
const pj = { ...job, ...fields }
eq('progress of a fresh checklist', [checklistOf(pj).done, checklistOf(pj).total, checklistOf(pj).complete], [0, 3, false])
eq('tick a step', toggleCheck(pj, 1), [false, true, false])
eq('untick it again', toggleCheck({ ...pj, checks: [false, true, false] }, 1), [false, false, false])
eq('short or missing checks are padded to the steps', toggleCheck({ ...pj, checks: [true] }, 2), [true, false, true])
eq('all ticked is complete', checklistOf({ ...pj, checks: [true, true, true] }).complete, true)
eq('a job without a process is complete', checklistOf(job).complete, true)
eq('assignee may tick', canTickJob(pj, 'a', false), true)
eq('a bystander may not tick', canTickJob(pj, 'z', false), false)
eq('nothing to tick without a process', canTickJob(job, 'a', false), false)
eq('cannot finish with steps left', canFinishJob(pj, 'a', false), false)
eq('...not even an admin', canFinishJob(pj, 'z', true), false)
eq('can finish when all are ticked', canFinishJob({ ...pj, checks: [true, true, true] }, 'a', false), true)
eq('a job without a process finishes as before', canFinishJob(job, 'a', false), true)

console.log('--- waiting time ---')
const now = new Date(2026, 8, 28, 12, 0)
eq('pending server time', waitingFor(null, now), 'just now')
eq('under a minute', waitingFor(new Date(2026, 8, 28, 11, 59, 30), now), 'just now')
eq('minutes', waitingFor(new Date(2026, 8, 28, 11, 56), now), '4 min')
eq('hours and minutes', waitingFor(new Date(2026, 8, 28, 9, 55), now), '2 h 5 min')
eq('whole hours', waitingFor(new Date(2026, 8, 28, 10, 0), now), '2 h')
eq('start of day', startOfDay(now).getTime(), new Date(2026, 8, 28).getTime())

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
