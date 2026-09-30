import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Load the userscript the way the tests need it: no `window`, so it only
// exposes its pure helpers instead of starting.
const source = readFileSync(new URL('./servicenow-watcher.user.js', import.meta.url), 'utf8')
const context = { URLSearchParams }
vm.createContext(context)
vm.runInContext(source, context)
const { unassignedQuery, tableUrl, recordUrl, listUrl, findNew, describe, summarize, parseGroups, testMessage } = context.nblabWatcher

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- what is asked for ---')
eq('active, unassigned, in the groups', unassignedQuery(['NBLAB Support', 'NBLAB AV']),
  'active=true^assigned_toISEMPTY^assignment_group.nameINNBLAB Support,NBLAB AV')
const url = new URL(tableUrl('sc_task', ['NBLAB Support'], ['priority', 'number']), 'https://x.service-now.com')
eq('the table API for the chosen table', url.pathname, '/api/now/table/sc_task')
eq('newest first', url.searchParams.get('sysparm_query').endsWith('^ORDERBYDESCsys_created_on'), true)
eq('only the fields shown, no duplicates', url.searchParams.get('sysparm_fields'),
  'sys_id,number,short_description,sys_created_on,priority')
eq('display values, not raw ids', url.searchParams.get('sysparm_display_value'), 'true')
eq('record link', recordUrl('incident', 'abc'), '/nav_to.do?uri=incident.do%3Fsys_id%3Dabc')
eq('list link keeps the filter', decodeURIComponent(listUrl('sc_task', ['G'])),
  '/nav_to.do?uri=sc_task_list.do?sysparm_query=active=true^assigned_toISEMPTY^assignment_group.nameING')

console.log('--- what counts as new ---')
const t = (id) => ({ sys_id: id, number: `SCTASK${id}`, short_description: `Task ${id}` })
let r = findNew(null, [t('1'), t('2')])
eq('first check only takes note of the backlog', r.fresh, [])
eq('...and remembers it', r.known, ['1', '2'])
r = findNew(r.known, [t('3'), t('1'), t('2')])
eq('a new task is announced', r.fresh.map(x => x.sys_id), ['3'])
r = findNew(r.known, [t('3'), t('1'), t('2')])
eq('...once', r.fresh, [])
r = findNew(r.known, [t('3')])
eq('assigned or closed tasks are forgotten', r.known, ['3'])
r = findNew(r.known, [t('3'), t('1')])
eq('a task that becomes unassigned again is announced again', r.fresh.map(x => x.sys_id), ['1'])
eq('nothing waiting, nothing announced', findNew([], []).fresh, [])

console.log('--- notification text ---')
const task = { number: 'SCTASK0012', short_description: 'Laptop swap, room 204', priority: '3 - Moderate', assignment_group: 'NBLAB Support', empty: ' ' }
eq('number in the title, description and details in the text', describe(task, ['priority', 'assignment_group', 'empty', 'missing']),
  { title: 'New unassigned task · SCTASK0012', text: 'Laptop swap, room 204\n3 - Moderate · NBLAB Support' })
eq('a task with no description', describe({ number: 'X1' }, []).text, '(no short description)')
const burst = [1, 2, 3, 4, 5].map(i => ({ number: `T${i}`, short_description: `Job ${i}` }))
eq('a burst becomes one summary', summarize(burst),
  { title: '5 new unassigned tasks', text: 'T1: Job 1\nT2: Job 2\nT3: Job 3\n…and 2 more' })

console.log('--- test button ---')
eq('shows the newest waiting task', testMessage([{ ...task, sys_id: 't12' }, { number: 'OLD' }], ['NBLAB Support'], ['priority']),
  { title: 'Test · SCTASK0012 (newest waiting)', text: 'Laptop swap, room 204\n3 - Moderate', taskId: 't12' })
eq('all clear when nothing is waiting', testMessage([], ['NBLAB Support', 'NBLAB AV'], []),
  { title: 'Watcher test · working', text: 'Nothing unassigned in NBLAB Support, NBLAB AV right now.', taskId: null })

console.log('--- settings ---')
eq('groups split on commas, semicolons or lines', parseGroups(' NBLAB Support ;NBLAB AV,\n  '), ['NBLAB Support', 'NBLAB AV'])
eq('cancelled prompt', parseGroups(null), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
