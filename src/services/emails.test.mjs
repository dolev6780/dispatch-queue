import {
  EMAIL_LIMITS, BUILTIN_BLANKS, emptyTemplate, isEmailAddress, splitAddresses, cleanTemplate, validateTemplate,
  blanksIn, builtinValues, fillBlanks, composeEmail, outlookWebLink, mailtoLink, sortTemplates
} from './emails.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const pickup = {
  name: 'Vendor pickup',
  to: ['vendor@example.com'],
  cc: ['lab-team@example.com'],
  subject: 'Pickup for {Ticket} - {site}',
  body: 'Hello,\n\nPlease pick up asset {asset tag} for ticket {ticket}.\nNotes: {notes}\n\nThanks,\n{name}\n{date} {time}'
}

console.log('--- addresses ---')
eq('a plain address', isEmailAddress('dana.levi@intel.com'), true)
eq('no @ is not an address', isEmailAddress('dana.levi'), false)
eq('spaces are not allowed', isEmailAddress('dana levi@intel.com'), false)
eq('a domain needs a dot', isEmailAddress('dana@intel'), false)
eq('split on commas, semicolons, spaces and lines, once each', splitAddresses('a@x.com; b@x.com,\nc@x.com  a@x.com'), ['a@x.com', 'b@x.com', 'c@x.com'])
eq('nothing gives nothing', splitAddresses(''), [])

console.log('--- cleaning and checking ---')
eq('an empty template', emptyTemplate(), { name: '', to: [], cc: [], subject: '', body: '' })
const messy = cleanTemplate({ name: '  Pickup ', to: [' a@x.com ', 'a@x.com', ''], cc: undefined, subject: ' Hi ', body: 'Line\r\nNext\n\n  ' })
eq('trimmed, once each, Windows line ends made plain', messy, { name: 'Pickup', to: ['a@x.com'], cc: [], subject: 'Hi', body: 'Line\nNext' })
eq('no more than 10 recipients', cleanTemplate({ to: Array.from({ length: 12 }, (_, i) => `p${i}@x.com`) }).to.length, EMAIL_LIMITS.recipients)
eq('a long body is cut', cleanTemplate({ body: 'x'.repeat(5000) }).body.length, EMAIL_LIMITS.body)
eq('a good template', validateTemplate(pickup), null)
eq('needs a name', validateTemplate({ ...pickup, name: ' ' }), 'Give the template a name.')
eq('needs an address to go to', validateTemplate({ ...pickup, to: [] }), 'Add the address it goes to.')
eq('every address must be one', validateTemplate({ ...pickup, cc: ['team'] }), '"team" is not an email address.')
eq('needs a subject', validateTemplate({ ...pickup, subject: '' }), 'Write the subject.')
eq('needs a body', validateTemplate({ ...pickup, body: '  \n ' }), 'Write the email.')

console.log('--- blanks ---')
eq('the blanks, in order, once each, any case', blanksIn(pickup), [
  { key: 'ticket', label: 'Ticket' }, { key: 'asset tag', label: 'Asset tag' }, { key: 'notes', label: 'Notes' }
])
eq('built-in blanks are not asked for', BUILTIN_BLANKS.every(name => !blanksIn(pickup).some(b => b.key === name)), true)
eq('underscores read as spaces in the label', blanksIn({ subject: '{serial_number}', body: '' }), [{ key: 'serial_number', label: 'Serial number' }])
eq('blanks in Hebrew work too', blanksIn({ subject: '', body: 'מספר: {מספר קריאה}' }), [{ key: 'מספר קריאה', label: 'מספר קריאה' }])
eq('braces across lines are not a blank', blanksIn({ subject: '', body: '{not\na blank}' }), [])
const now = new Date(2026, 9, 1, 9, 5)
eq('the built-in values', builtinValues({ now, name: 'Dana Levi', site: 'L12' }), { date: '01/10/2026', time: '09:05', name: 'Dana Levi', site: 'L12' })
eq('filled, any case; an empty blank stays empty', fillBlanks('A {Ticket} B {missing} C', { ticket: 'RITM1' }), 'A RITM1 B  C')
eq('a value is cut at its limit', fillBlanks('{x}', { x: 'y'.repeat(900) }).length, EMAIL_LIMITS.value)

console.log('--- the email ---')
const values = { ticket: 'RITM0012345', 'asset tag': 'NB-48213', notes: 'Box at the front desk', ...builtinValues({ now, name: 'Dana Levi', site: 'L12' }) }
const email = composeEmail(pickup, values)
eq('to and cc as written', [email.to, email.cc], [['vendor@example.com'], ['lab-team@example.com']])
eq('the subject, filled', email.subject, 'Pickup for RITM0012345 - L12')
eq('the body, filled', email.body, 'Hello,\n\nPlease pick up asset NB-48213 for ticket RITM0012345.\nNotes: Box at the front desk\n\nThanks,\nDana Levi\n01/10/2026 09:05')
eq('a line break in a value never breaks the subject', composeEmail({ ...pickup, subject: 'A {notes}' }, { notes: 'x\ny' }).subject, 'A x y')
const web = outlookWebLink(email)
eq('Outlook on the web: the compose page', web.startsWith('https://outlook.office.com/mail/deeplink/compose?to=vendor%40example.com&cc=lab-team%40example.com&subject=Pickup%20for%20RITM0012345%20-%20L12&body=Hello%2C%0D%0A%0D%0APlease'), true)
const back = new URL(web).searchParams
eq('...which reads back as the same email', [back.get('to'), back.get('cc'), back.get('subject'), back.get('body').replace(/\r\n/g, '\n')], ['vendor@example.com', 'lab-team@example.com', email.subject, email.body])
eq('...without a CC when there is none', outlookWebLink({ ...email, cc: [] }).includes('cc='), false)
eq('several recipients, comma-separated', new URL(outlookWebLink({ ...email, to: ['a@x.com', 'b@x.com'] })).searchParams.get('to'), 'a@x.com,b@x.com')
eq('Hebrew survives the link', new URL(outlookWebLink({ ...email, subject: 'החזרה' })).searchParams.get('subject'), 'החזרה')
const mail = mailtoLink(email)
eq('the mail app: mailto with the same email', mail.startsWith('mailto:vendor%40example.com?cc=lab-team%40example.com&subject=Pickup%20for%20RITM0012345'), true)
eq('...line breaks as the mail standard wants them', mail.includes('body=Hello%2C%0D%0A%0D%0APlease'), true)

console.log('--- the list ---')
eq('by name, any case', sortTemplates([{ name: 'vendor' }, { name: 'Asset' }, { name: 'IT help' }]).map(t => t.name), ['Asset', 'IT help', 'vendor'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
