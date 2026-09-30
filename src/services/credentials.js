/**
 * WWID -> Firebase email/password credentials.
 *
 * People type one field: their WWID. Behind it sits a real Firebase
 * Email/Password account, which means a real UID and — unlike the previous
 * work-ID gate — Firestore rules that can actually enforce who is signed in.
 *
 * THE TRADE-OFF, STATED PLAINLY
 * The password is derived from the WWID, so anyone who knows a WWID can sign
 * in as that person. The derivation is in this file and ships in the bundle;
 * it is obfuscation, not a secret. WWIDs must therefore be treated like
 * passwords: not printed on a whiteboard, not guessable in sequence.
 *
 * What it does buy, which the old scheme could not:
 *   - every write carries a real authenticated identity
 *   - rules enforce request.auth != null server-side
 *   - admin rights live in Firestore and are checked by rules, not the UI
 */

/** The email domain is internal and never receives mail. */
export const EMAIL_DOMAIN = 'nblab.local'

/** Trim and upper-case so " a12 " and "A12" are one identity. */
export const normaliseWwid = (value) => String(value ?? '').trim().toUpperCase()

/** WWID -> the account's email address. */
export const wwidToEmail = (wwid) => {
  const normalised = normaliseWwid(wwid)
  if (!normalised) return null
  return `${normalised.toLowerCase()}@${EMAIL_DOMAIN}`
}

/**
 * WWID -> the account's password.
 *
 * SHA-256 of a namespaced WWID, hex, truncated. Hashing rather than using the
 * WWID directly means the stored Firebase credential is not the WWID itself,
 * and guarantees the length and character mix Firebase requires regardless of
 * how short a WWID is.
 */
export const wwidToPassword = async (wwid) => {
  const normalised = normaliseWwid(wwid)
  if (!normalised) return null
  const bytes = new TextEncoder().encode(`nblab-dispatch-credential:${normalised}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

/** Both halves at once. Returns null if the WWID is empty. */
export const wwidToCredentials = async (wwid) => {
  const email = wwidToEmail(wwid)
  if (!email) return null
  return { email, password: await wwidToPassword(wwid) }
}

/**
 * A display-only hint for a WWID, e.g. "4471" -> "••71".
 *
 * The WWID is the whole credential, so it is never stored in Firestore — an
 * administrator only needs to tell accounts apart, not read the credential.
 * Storing it in plaintext previously let anyone holding any token list the
 * users collection and sign in as an administrator.
 */
export const maskWwid = (wwid) => {
  const normalised = normaliseWwid(wwid)
  if (!normalised) return ''
  const visible = normalised.length <= 3 ? 1 : 2
  return `${'•'.repeat(Math.max(2, normalised.length - visible))}${normalised.slice(-visible)}`
}

/** Minimum length for a usable WWID. */
export const MIN_WWID_LENGTH = 3

export const validateWwid = (wwid) => {
  const normalised = normaliseWwid(wwid)
  if (!normalised) return 'Enter your work ID.'
  if (normalised.length < MIN_WWID_LENGTH) return `The work ID must be at least ${MIN_WWID_LENGTH} characters.`
  // The WWID becomes the local part of an email address.
  if (!/^[A-Z0-9._-]+$/.test(normalised)) return 'Use only letters, numbers, dots, dashes or underscores.'
  return null
}
