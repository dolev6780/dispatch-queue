import { useCallback, useEffect, useRef, useState } from 'react'
import { watchOpenJobs, watchJobsDoneSince, createJob, completeJob, deleteJob, setJobChecks } from '../services/db'
import { detectNewJobs, sortOpenJobs, startOfDay } from '../services/jobs'
import { showDesktopNotification } from '../services/notify'

/**
 * Live jobs for one site: the open list every screen shows, today's finished
 * jobs, and the alert for each NEW job.
 *
 * `onNewJob(job)` is called once per job that appears while this station is
 * running — never for jobs already open when it starts, and never again after
 * a reconnect. The seed is taken from the first SERVER snapshot, not a cached
 * one, otherwise every open job would ring the moment the server answered.
 *
 * Desktop notifications opened through `notifyDesktop` are closed
 * automatically when their job leaves the open list.
 */
export const useJobs = ({ siteId, canUse, dayKey, onNewJob }) => {
  const [openJobs, setOpenJobs] = useState([])
  const [doneToday, setDoneToday] = useState([])
  const [error, setError] = useState(null)

  const knownRef = useRef(new Set())
  const seededRef = useRef(false)
  const notificationsRef = useRef(new Map())
  const onNewJobRef = useRef(onNewJob)
  useEffect(() => { onNewJobRef.current = onNewJob })

  // ---- Open jobs ---------------------------------------------------------------
  //
  // The set-state-in-effect rule is disabled deliberately: this synchronises
  // with a Firestore listener and must drop one site's jobs when the site or
  // session changes, or they would show under another site's name.
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    setOpenJobs([])
    setError(null)
    knownRef.current = new Set()
    seededRef.current = false
    if (!canUse || !siteId) return undefined

    const notifications = notificationsRef.current
    const stop = watchOpenJobs(siteId,
      (jobs, { fromCache }) => {
        setOpenJobs(sortOpenJobs(jobs))

        // Close desktop notifications for jobs that are no longer open.
        const openIds = new Set(jobs.map(job => job.id))
        for (const [jobId, notification] of notifications) {
          if (!openIds.has(jobId)) {
            notification.close()
            notifications.delete(jobId)
          }
        }

        if (fromCache && !seededRef.current) return
        const { fresh, nextKnown } = detectNewJobs(knownRef.current, jobs, !seededRef.current)
        seededRef.current = true
        knownRef.current = nextKnown
        fresh.forEach(job => onNewJobRef.current?.(job))
      },
      (err) => setError(err?.message || 'Could not read the jobs.'))

    return () => {
      stop()
      notifications.forEach(notification => notification.close())
      notifications.clear()
    }
  }, [siteId, canUse])

  // ---- Finished today (resubscribes at midnight) -----------------------------------
  useEffect(() => {
    setDoneToday([])
    if (!canUse || !siteId) return undefined
    return watchJobsDoneSince(siteId, startOfDay(new Date()), setDoneToday, () => {})
  }, [siteId, canUse, dayKey])
  /* oxlint-enable react/set-state-in-effect */

  const notifyDesktop = useCallback((job, payload) => {
    const notification = showDesktopNotification({ ...payload, tag: job.id })
    if (notification) notificationsRef.current.set(job.id, notification)
  }, [])

  const run = useCallback(async (work) => {
    setError(null)
    try {
      await work()
      return true
    } catch (err) {
      setError(err?.message || 'That did not work.')
      return false
    }
  }, [])

  return {
    openJobs,
    doneToday: [...doneToday].sort((a, b) => (b.doneAt?.toMillis?.() || 0) - (a.doneAt?.toMillis?.() || 0)),
    error,
    clearError: () => setError(null),
    notifyDesktop,
    create: (job) => run(() => createJob(siteId, job)),
    complete: (jobId, uid) => run(() => completeJob(siteId, jobId, uid)),
    tick: (jobId, checks) => run(() => setJobChecks(siteId, jobId, checks)),
    remove: (jobId) => run(() => deleteJob(siteId, jobId))
  }
}
