/**
 * Who may do what, and who works where — the client-side mirror of
 * firestore.rules.
 *
 * These helpers decide what the UI OFFERS. The Firestore rules make the same
 * decisions server-side; a check here that disagreed would only produce a
 * button that fails. The tests pin down the matrix.
 *
 * Accounts are workers. users/{uid}.siteId is the HOME site. A temporary move
 * (tempSiteId + tempEndsAt) relocates the person fully until tempEndsAt, after
 * which they are home again automatically — no job has to undo it.
 */

const toMillis = (value) => {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

/** Is a temporary move in force at `now`? */
export const isTempMoveActive = (profile, now = new Date()) => {
  if (!profile?.tempSiteId) return false
  const ends = toMillis(profile.tempEndsAt)
  return ends !== null && now.getTime() < ends
}

/** The site this person works at right now. */
export const currentSiteOf = (profile, now = new Date()) =>
  isTempMoveActive(profile, now) ? profile.tempSiteId : (profile?.siteId || null)

/** Global administrator. `isAdmin` is the pre-sites field. */
export const isGlobalAdmin = (profile) =>
  !!profile && (profile.isGlobalAdmin === true || profile.isAdmin === true)

/**
 * Administers this site: global admins everywhere; a site admin at their HOME
 * site — even while temporarily working somewhere else.
 */
export const isSiteAdminOf = (profile, siteId) =>
  !!profile && !!siteId &&
  (isGlobalAdmin(profile) || (profile.siteAdmin === true && profile.siteId === siteId))

/** Any administrative role at all. */
export const isAnyAdmin = (profile) => isGlobalAdmin(profile) || profile?.siteAdmin === true

/** May use this site's board right now? */
export const canUseSite = (profile, siteId, now = new Date()) =>
  !!profile && !!siteId && (isGlobalAdmin(profile) || currentSiteOf(profile, now) === siteId)

/** A profile from before sites existed has no siteId and must be set up. */
export const needsSiteSetup = (profile) => !!profile && !profile.siteId

/** The site whose accounts this person administers from the Admin page. */
export const adminSiteOf = (profile, activeSiteId) =>
  isGlobalAdmin(profile) ? activeSiteId : (profile?.siteAdmin === true ? profile.siteId : null)

/**
 * May `actor` edit, move or revoke `target`?
 *
 * The admin of the target's HOME site manages them — never a global admin,
 * never themselves.
 */
export const canManageAccount = (actor, target) => {
  if (!actor || !target) return false
  if (isGlobalAdmin(actor)) return actor.uid !== target.uid
  if (!isSiteAdminOf(actor, target.siteId)) return false
  if (isGlobalAdmin(target)) return false
  return actor.uid !== target.uid
}

/** Which flags may `actor` set on a new account? */
export const grantableFlags = (actor) => ({
  siteAdmin: !!actor && (isGlobalAdmin(actor) || actor.siteAdmin === true),
  globalAdmin: isGlobalAdmin(actor)
})

/**
 * A permanent move by a site admin must drop site-admin rights, so nobody can
 * plant an administrator in another site. Global admins may keep them.
 */
export const siteAdminAfterPermanentMove = (actor, target) =>
  isGlobalAdmin(actor) ? !!target.siteAdmin : false

/**
 * Local midnight after `lastDay` ("YYYY-MM-DD") — the moment a temporary move
 * ends. Computed in the administrator's time zone, which is the stations' time
 * zone, so "until Oct 5" means the person is home again at 00:00 on Oct 6.
 */
export const endOfLastDay = (lastDay) => {
  const [year, month, day] = String(lastDay).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day + 1, 0, 0, 0, 0)
}

/** "YYYY-MM-DD" of the last day covered by an end instant (display). */
export const lastDayOf = (tempEndsAt) => {
  const ends = toMillis(tempEndsAt)
  if (ends === null) return null
  const last = new Date(ends - 1)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

/**
 * The workers of a site right now, from the two queries the rules allow:
 * people whose home it is (minus anyone temporarily away) plus people
 * temporarily here. Hidden (inactive) workers are excluded.
 */
export const workersAt = (siteId, homeResidents, visitors, now = new Date()) => {
  const byId = new Map()
  for (const person of [...homeResidents, ...visitors]) byId.set(person.uid, person)
  return [...byId.values()]
    .filter(person => currentSiteOf(person, now) === siteId)
    .filter(person => person.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}
