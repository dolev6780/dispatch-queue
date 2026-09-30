import {
  normaliseWwid,
  wwidToEmail,
  wwidToPassword,
  wwidToCredentials,
  validateWwid,
  EMAIL_DOMAIN
} from './credentials.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- normaliseWwid ---')
eq('trims', normaliseWwid('  4471 '), '4471')
eq('upper-cases', normaliseWwid('a12b'), 'A12B')
eq('null is empty', normaliseWwid(null), '')
eq('number works', normaliseWwid(4471), '4471')

console.log('--- wwidToEmail ---')
eq('builds the internal address', wwidToEmail('4471'), `4471@${EMAIL_DOMAIN}`)
eq('lower-cases the local part', wwidToEmail('A12B'), `a12b@${EMAIL_DOMAIN}`)
eq('is stable across spacing/case', wwidToEmail(' a12b '), wwidToEmail('A12B'))
eq('empty gives null', wwidToEmail('  '), null)

console.log('--- wwidToPassword ---')
const p1 = await wwidToPassword('4471')
const p2 = await wwidToPassword(' 4471 ')
const p3 = await wwidToPassword('4472')
eq('is 32 hex chars', /^[0-9a-f]{32}$/.test(p1), true)
eq('meets Firebase minimum length of 6', p1.length >= 6, true)
eq('stable across spacing', p1, p2)
eq('differs per WWID', p1 === p3, false)
eq('is NOT the WWID itself', p1.includes('4471'), false)
eq('empty gives null', await wwidToPassword(''), null)

console.log('--- wwidToCredentials ---')
const creds = await wwidToCredentials('A12')
eq('returns both halves', Object.keys(creds).sort(), ['email', 'password'])
eq('email matches', creds.email, `a12@${EMAIL_DOMAIN}`)
eq('password matches', creds.password, await wwidToPassword('A12'))
eq('empty gives null', await wwidToCredentials(''), null)

console.log('--- validateWwid ---')
eq('accepts digits', validateWwid('4471'), null)
eq('accepts letters and digits', validateWwid('AB12'), null)
eq('accepts dots dashes underscores', validateWwid('a.b-c_1'), null)
eq('rejects empty', validateWwid(''), 'Enter your work ID.')
eq('rejects too short', validateWwid('12'), 'The work ID must be at least 3 characters.')
eq('rejects spaces inside',
  validateWwid('44 71'), 'Use only letters, numbers, dots, dashes or underscores.')
eq('rejects @ (would break the address)',
  validateWwid('a@b'), 'Use only letters, numbers, dots, dashes or underscores.')

console.log('--- two people never collide ---')
const many = ['1', '4471', '4472', 'A12', 'a12', 'AB-1', 'AB_1']
const emails = await Promise.all(many.map(w => wwidToEmail(w)))
const distinctInputs = new Set(many.map(normaliseWwid))
eq('distinct WWIDs give distinct emails',
  new Set(emails.filter(Boolean)).size, distinctInputs.size)

// Pages served over plain http (the main PC's relay) have no crypto.subtle.
{
  const subtleValues = await Promise.all(['4471', 'A12', 'wwid.with-dots_1'].map(wwidToPassword))
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  const fallbackValues = await Promise.all(['4471', 'A12', 'wwid.with-dots_1'].map(wwidToPassword))
  Object.defineProperty(globalThis, 'crypto', saved)
  eq('without crypto.subtle the password is identical', fallbackValues, subtleValues)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
