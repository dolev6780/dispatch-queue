/**
 * Work-ID sign-in.
 *
 * WHAT THIS IS
 * A soft gate plus attribution: it records who changed the queue and keeps
 * casual passers-by from editing the board. Nothing more.
 *
 * WHAT THIS IS NOT
 * Real authentication. There is no server check, so Firestore rules cannot
 * verify a work ID and the admin flag is enforced in the UI only. Anyone
 * willing to open devtools can get past it. If the board ever needs real
 * protection, this has to be replaced with Firebase Auth (Google or
 * email/password) and rules requiring `request.auth != null`.
 *
 * Work IDs are stored as SHA-256 hashes rather than plaintext, because the
 * shared Firestore document is publicly readable and plaintext IDs would be
 * harvestable by anyone. Hashing stops harvesting; it does not stop a
 * determined offline guess against a short numeric ID.
 */

const SESSION_KEY = 'dispatch_session_v1'
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12h, so a shared office PC
                                               // does not stay signed in

/** Trim and upper-case so "a12" and " A12 " are the same ID. */
export const normaliseWorkId = (value) => String(value ?? '').trim().toUpperCase()

/**
 * SHA-256 of the normalised work ID, hex encoded.
 * Returns null for an empty ID. Requires a secure context (crypto.subtle),
 * which GitHub Pages and localhost both provide.
 */
export const hashWorkId = async (workId) => {
  const normalised = normaliseWorkId(workId)
  if (!normalised) return null
  const bytes = new TextEncoder().encode(`nblab-dispatch:${normalised}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** The roster member whose stored hash matches this work ID, or null. */
export const findMemberByWorkId = async (roster, workId) => {
  const hash = await hashWorkId(workId)
  if (!hash) return null
  return (roster || []).find(person => person.workIdHash === hash) || null
}

/** Has anyone been set up as an administrator yet? */
export const hasAnyAdmin = (roster) =>
  (roster || []).some(person => person.isAdmin && person.workIdHash)

/** Is this work ID already taken by someone other than `exceptId`? */
export const isWorkIdTaken = async (roster, workId, exceptId = null) => {
  const hash = await hashWorkId(workId)
  if (!hash) return false
  return (roster || []).some(person => person.workIdHash === hash && person.id !== exceptId)
}

// ---------------------------------------------------------------------------
// Session
//
// Only the member id is persisted. Name and admin rights are re-derived from
// the live roster on every render, so editing localStorage cannot invent an
// administrator on its own.
// ---------------------------------------------------------------------------

export const readSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (!session || !session.id || !session.signedInAt) return null
    if (Date.now() - session.signedInAt > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export const writeSession = (memberId) => {
  const session = { id: memberId, signedInAt: Date.now() }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Private browsing or blocked storage: the session simply will not persist.
  }
  return session
}

export const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore
  }
}

/**
 * Resolve a stored session against the current roster.
 * Returns null if the member has since been removed.
 */
export const resolveSession = (session, roster) => {
  if (!session) return null
  const member = (roster || []).find(person => person.id === session.id)
  if (!member) return null
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    isAdmin: !!member.isAdmin,
    signedInAt: session.signedInAt
  }
}
