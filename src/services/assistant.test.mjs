import { parseMarkdown, inlineRuns, jobQuestion, jobLabel, jobForAi, processesForAi, SUGGESTIONS } from './assistant.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- reading answers ---')
eq('paragraphs', parseMarkdown('First line\nsame paragraph\n\nSecond'), [
  { type: 'p', text: 'First line same paragraph' }, { type: 'p', text: 'Second' }
])
eq('a numbered list keeps its start', parseMarkdown('3. Three\n4. Four'), [{ type: 'ol', items: ['Three', 'Four'], start: 3 }])
eq('bullets', parseMarkdown('- one\n* two\n• three'), [{ type: 'ul', items: ['one', 'two', 'three'] }])
eq('a heading, then a list', parseMarkdown('## Steps\n1. Back up\n2. Swap'), [
  { type: 'h', text: 'Steps' }, { type: 'ol', items: ['Back up', 'Swap'], start: 1 }
])
eq('an indented line continues the item', parseMarkdown('1. Open Settings\n   then Update\n2. Restart'), [
  { type: 'ol', items: ['Open Settings then Update', 'Restart'], start: 1 }
])
eq('a code block is kept as is', parseMarkdown('Run:\n```\nmanage-bde -status\nipconfig /all\n```\nDone'), [
  { type: 'p', text: 'Run:' }, { type: 'code', text: 'manage-bde -status\nipconfig /all' }, { type: 'p', text: 'Done' }
])
eq('an unclosed code block runs to the end', parseMarkdown('```\nx'), [{ type: 'code', text: 'x' }])
eq('Windows line endings', parseMarkdown('a\r\n\r\nb'), [{ type: 'p', text: 'a' }, { type: 'p', text: 'b' }])
eq('nothing', parseMarkdown(''), [])
eq('HTML stays text', parseMarkdown('<script>alert(1)</script>'), [{ type: 'p', text: '<script>alert(1)</script>' }])
eq('bold and code runs', inlineRuns('Press **F2** and run `ipconfig` now'), [
  { type: 'text', text: 'Press ' }, { type: 'bold', text: 'F2' }, { type: 'text', text: ' and run ' },
  { type: 'code', text: 'ipconfig' }, { type: 'text', text: ' now' }
])
eq('plain text is one run', inlineRuns('just text'), [{ type: 'text', text: 'just text' }])
eq('italics', inlineRuns('Under *Boot*, move it'), [{ type: 'text', text: 'Under ' }, { type: 'em', text: 'Boot' }, { type: 'text', text: ', move it' }])
eq('a lone star stays text', inlineRuns('5 * 3 = 15'), [{ type: 'text', text: '5 * 3 = 15' }])

console.log('--- context ---')
const job = { id: 'j1', type: 'incident', note: 'Printer offline, floor 2', assigneeName: 'Yossi', createdByName: 'Maya', processTitle: 'Printer', steps: ['Power'], checks: [true] }
eq('a job question with its note', jobQuestion(job), 'I\'m working on this Incident job: "Printer offline, floor 2". What should I check first?')
eq('a job question without a note', jobQuestion({ type: 'otr' }), "I'm working on this OTR job. What should I check first?")
eq('a job label', jobLabel(job), 'Incident · Printer offline, floor 2')
eq('a job for the assistant carries no names', jobForAi(job), { type: 'incident', note: 'Printer offline, floor 2', processTitle: 'Printer', steps: ['Power'], checks: [true] })
eq('no job, nothing', jobForAi(null), null)
eq('processes for the assistant carry no ids or times', processesForAi([{ id: 'p1', title: 'SSD', jobType: 'ssd-upgrade', steps: ['a'], notes: 'n', updatedBy: 'u', updatedAt: 1 }]),
  [{ title: 'SSD', jobType: 'ssd-upgrade', steps: ['a'], notes: 'n' }])
eq('a few openers', SUGGESTIONS.length > 0, true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
