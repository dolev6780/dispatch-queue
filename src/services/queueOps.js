/**
 * Pure queue-list operations.
 *
 * A stored day's queue can hold ids that are not currently shown — people an
 * admin deactivated or deleted. Operations therefore work by id, never by the
 * visible row index, which previously swapped the wrong people as soon as a
 * hidden id sat between two visible ones.
 */

/** Add if absent, remove if present. */
export const toggleId = (list, id) =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id]

/**
 * Move `id` one step up (-1) or down (+1) among the VISIBLE entries, swapping
 * it with its visible neighbour in the stored list. Hidden ids keep their
 * positions untouched.
 */
export const moveById = (list, visibleIds, id, direction) => {
  const visibleSet = new Set(visibleIds)
  const visibleOrder = list.filter(x => visibleSet.has(x))
  const at = visibleOrder.indexOf(id)
  const neighbour = visibleOrder[at + direction]
  if (at < 0 || neighbour === undefined) return list

  const next = [...list]
  const a = next.indexOf(id)
  const b = next.indexOf(neighbour)
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

/**
 * Append every id in `ids` that is not already queued, keeping the existing
 * hand-set order. "Add everyone" used to replace the queue in roster order,
 * which reshuffled the day and could change who was on duty.
 */
export const addMissing = (list, ids) => [...list, ...ids.filter(id => !list.includes(id))]

/** Remove an id from every day, e.g. when that person is deleted. */
export const removeFromAllDays = (dayQueues, id) =>
  Object.fromEntries(
    Object.entries(dayQueues || {}).map(([day, list]) => [day, (list || []).filter(x => x !== id)])
  )

/** Turn a display name into a stable document id. */
export const toSlug = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
