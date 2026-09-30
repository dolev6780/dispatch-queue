/**
 * Work processes — pure definitions and logic (no React, no Firebase).
 *
 * A process is a site's step-by-step guide for a kind of work. Linked to a job
 * type, it is copied into every new job of that type as a checklist the
 * assignee ticks off before the job can be closed. The limits here are also
 * enforced by firestore.rules.
 */

export const MAX_TITLE_LENGTH = 80
export const MAX_STEPS = 30
export const MAX_STEP_LENGTH = 200
export const MAX_NOTES_LENGTH = 2000

/** Trimmed steps with the blank ones dropped. */
export const cleanSteps = (steps) =>
  (steps || []).map(step => String(step ?? '').trim()).filter(Boolean)

/** Check a process before saving it; returns an error message or null. */
export const validateProcess = ({ title, steps, notes }) => {
  const name = String(title || '').trim()
  if (!name) return 'Give the process a title.'
  if (name.length > MAX_TITLE_LENGTH) return `Keep the title under ${MAX_TITLE_LENGTH} characters.`
  const list = cleanSteps(steps)
  if (list.length === 0) return 'Add at least one step.'
  if (list.length > MAX_STEPS) return `A process can have at most ${MAX_STEPS} steps.`
  if (list.some(step => step.length > MAX_STEP_LENGTH)) return `Keep each step under ${MAX_STEP_LENGTH} characters.`
  if (String(notes || '').length > MAX_NOTES_LENGTH) return `Keep the notes under ${MAX_NOTES_LENGTH} characters.`
  return null
}

/** Alphabetical by title. */
export const sortProcesses = (processes) =>
  [...processes].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))

/** The process linked to a job type, if any (the first by title). */
export const processForType = (processes, type) =>
  (type && sortProcesses(processes).find(process => process.jobType === type)) || null

/** Job types already linked to a process other than `exceptId`. */
export const linkedTypes = (processes, exceptId) =>
  new Set(processes.filter(process => process.id !== exceptId && process.jobType).map(process => process.jobType))

/** Move one step up (-1) or down (+1); out-of-range moves change nothing. */
export const moveStep = (steps, index, direction) => {
  const target = index + direction
  if (target < 0 || target >= steps.length) return steps
  const next = [...steps]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
