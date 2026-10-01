/**
 * Email templates — pure definitions and logic (no React, no Firebase).
 *
 * A template is an email the site sends often: a fixed recipient, a subject
 * and a body with {blanks} the sender fills in. Sending opens it, ready, in
 * Outlook on the web (or the PC's mail app); the sender presses Send. Nothing
 * is sent by the website itself.
 */

export const EMAIL_LIMITS = {
  name: 80,
  recipients: 10,
  address: 254,
  subject: 200,
  body: 4000,
  blank: 30,
  value: 500
}

/** Blanks that fill themselves: today's date and time, the sender, the site. */
export const BUILTIN_BLANKS = ['date', 'time', 'name', 'site']

/** Past this, a link may be cut short by the browser or Outlook: copy instead. */
export const LINK_LIMIT = 8000

export const emptyTemplate = () => ({ name: '', to: [], cc: [], subject: '', body: '' })

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/
export const isEmailAddress = (text) => ADDRESS.test(String(text || '')) && String(text).length <= EMAIL_LIMITS.address

/** "a@x.com; b@x.com\nc@x.com" -> ['a@x.com', 'b@x.com', 'c@x.com'] */
export const splitAddresses = (text) =>
  [...new Set(String(text || '').split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))]

const cleanList = (list) => [...new Set((list || []).map(item => String(item).trim()).filter(Boolean))].slice(0, EMAIL_LIMITS.recipients)

/** A draft from the editor, trimmed and cut to the limits — what gets saved. */
export const cleanTemplate = (draft) => ({
  name: String(draft?.name || '').trim().slice(0, EMAIL_LIMITS.name),
  to: cleanList(draft?.to),
  cc: cleanList(draft?.cc),
  subject: String(draft?.subject || '').trim().slice(0, EMAIL_LIMITS.subject),
  body: String(draft?.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, EMAIL_LIMITS.body)
})

/** Check a template before saving; returns an error message or null. */
export const validateTemplate = (draft) => {
  const t = cleanTemplate(draft)
  if (!t.name) return 'Give the template a name.'
  if (t.to.length === 0) return 'Add the address it goes to.'
  const wrong = [...t.to, ...t.cc].find(address => !isEmailAddress(address))
  if (wrong) return `"${wrong}" is not an email address.`
  if (!t.subject) return 'Write the subject.'
  if (!t.body.trim()) return 'Write the email.'
  return null
}

const BLANK = /\{([^{}\n]{1,30})\}/g
const keyOf = (blank) => blank.trim().toLowerCase()

/**
 * The blanks a sender fills in, in the order they first appear — the
 * subject's, then the body's. Built-in ones fill themselves and are left out.
 */
export const blanksIn = (template) => {
  const seen = new Map()
  for (const text of [template?.subject, template?.body]) {
    for (const match of String(text || '').matchAll(BLANK)) {
      const key = keyOf(match[1])
      if (key && !BUILTIN_BLANKS.includes(key) && !seen.has(key)) seen.set(key, match[1].trim())
    }
  }
  return [...seen].map(([key, label]) => ({ key, label: label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, ' ') }))
}

/** {date} {time} {name} {site} for an email written at `now`. */
export const builtinValues = ({ now, name, site }) => {
  const pad = (n) => String(n).padStart(2, '0')
  return {
    date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    name: name || '',
    site: site || ''
  }
}

/** Text with its {blanks} filled; a blank with no value is left empty. */
export const fillBlanks = (text, values) =>
  String(text || '').replace(BLANK, (_, blank) => String(values[keyOf(blank)] ?? '').slice(0, EMAIL_LIMITS.value))

/** The email itself: the template with the sender's values and the built-in ones. */
export const composeEmail = (template, values) => {
  const t = cleanTemplate(template)
  return {
    to: t.to,
    cc: t.cc,
    subject: fillBlanks(t.subject, values).replace(/\s*\n\s*/g, ' ').trim(),
    body: fillBlanks(t.body, values)
  }
}

const encode = (text) => encodeURIComponent(text).replace(/%0A/g, '%0D%0A')

/** Opens Outlook on the web with the email written; the sender presses Send. */
export const outlookWebLink = (email) => {
  const parts = [`to=${encodeURIComponent(email.to.join(','))}`]
  if (email.cc.length) parts.push(`cc=${encodeURIComponent(email.cc.join(','))}`)
  parts.push(`subject=${encode(email.subject)}`, `body=${encode(email.body)}`)
  return `https://outlook.office.com/mail/deeplink/compose?${parts.join('&')}`
}

/** The same email for the PC's own mail app (the new Outlook, when it is the default). */
export const mailtoLink = (email) => {
  const parts = []
  if (email.cc.length) parts.push(`cc=${encodeURIComponent(email.cc.join(','))}`)
  parts.push(`subject=${encode(email.subject)}`, `body=${encode(email.body)}`)
  return `mailto:${email.to.map(encodeURIComponent).join(',')}?${parts.join('&')}`
}

/** By name, as people look for them. */
export const sortTemplates = (list) =>
  [...(list || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))
