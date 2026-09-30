import { readSnapshot, snapshotState, openedTime, isUrgent, STALE_AFTER_MS } from './servicenow.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const message = (snapshot) => ({ source: 'nblab-servicenow-watcher', snapshot })
// In the order readSnapshot builds it, since eq compares JSON text.
const good = {
  count: 2,
  tasks: [{ id: 's1', number: 'SCTASK1', title: 'Laptop swap', priority: '2 - High', opened: '2026-09-30 10:41:05', url: 'https://x.service-now.com/nav_to.do?uri=sc_task.do%3Fsys_id%3Ds1' }],
  groups: ['NBLAB Support'],
  listUrl: 'https://x.service-now.com/nav_to.do?uri=sc_task_list.do',
  checkedAt: 1000, okAt: 1000, error: null
}

console.log('--- reading what the watcher posts ---')
eq('a good snapshot comes through', readSnapshot(message(good)), good)
eq('other messages are ignored', readSnapshot({ source: 'something-else', snapshot: good }), null)
eq('no snapshot, nothing', readSnapshot({ source: 'nblab-servicenow-watcher' }), null)
eq('not an object', readSnapshot(null), null)
eq('javascript: links are dropped', readSnapshot(message({ ...good, tasks: [{ ...good.tasks[0], url: 'javascript:alert(1)' }] })).tasks[0].url, null)
eq('plain http links are dropped', readSnapshot(message({ ...good, listUrl: 'http://x.service-now.com/' })).listUrl, null)
eq('long text is cut', readSnapshot(message({ ...good, tasks: [{ title: 'x'.repeat(500) }] })).tasks[0].title.length, 200)
eq('at most 50 tasks', readSnapshot(message({ ...good, tasks: Array(80).fill({}) })).tasks.length, 50)
eq('a bad count falls back to the list', readSnapshot(message({ ...good, count: 'lots' })).count, 1)
eq('missing fields become empty', readSnapshot(message({ tasks: [{}] })).tasks[0], { id: '', number: '', title: '', priority: '', opened: '', url: null })

console.log('--- live, error, stale ---')
eq('fresh and fine', snapshotState(good, 1000 + 60000), 'live')
eq('the watcher reports a problem', snapshotState({ ...good, error: 'Cannot reach' }, 2000), 'error')
eq('no news for too long', snapshotState(good, 1000 + STALE_AFTER_MS + 1), 'stale')
eq('never heard from', snapshotState(null, 0), 'none')

console.log('--- display ---')
eq('time from a ServiceNow date', openedTime('2026-09-30 10:41:05'), '10:41')
eq('time from a US-style date', openedTime('09/30/2026 9:05:00 AM'), '09:05')
eq('no time, no text', openedTime(''), '')
eq('priority 1 is urgent', isUrgent('1 - Critical'), true)
eq('priority 2 is urgent', isUrgent('2 - High'), true)
eq('priority 3 is not', isUrgent('3 - Moderate'), false)
eq('priority 12 is not 1', isUrgent('12 - Other'), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
