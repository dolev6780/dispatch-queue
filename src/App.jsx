import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import './App.css'

import { AppBar } from './components/AppBar'
import { ConnectionGate } from './components/ConnectionGate'
import { WallDisplay } from './components/WallDisplay'
import { HoursDialog } from './components/HoursDialog'
import { JobDialog } from './components/JobDialog'
import { JobsStrip } from './components/JobsStrip'
import { JobChecklistDialog } from './components/JobChecklistDialog'
import { ServiceNowStrip } from './components/ServiceNowStrip'
import { Toast } from './components/Toast'
import { HomePage } from './pages/HomePage'
import { QueuePage } from './pages/QueuePage'
import { SignInPage } from './pages/SignInPage'
import { SiteSetupPage } from './pages/SiteSetupPage'
import { AdminPage } from './pages/AdminPage'
import { ProcessesPage } from './pages/ProcessesPage'
import { AssistantPage } from './pages/AssistantPage'
import { SettingsPage } from './pages/SettingsPage'
import { AutomationPage } from './pages/AutomationPage'

import { useHashRoute } from './hooks/useHashRoute'
import { useAuth } from './hooks/useAuth'
import { useDispatchQueue } from './hooks/useDispatchQueue'
import { useJobs } from './hooks/useJobs'
import { useProcesses } from './hooks/useProcesses'
import { useLocalAgent } from './hooks/useLocalAgent'
import { GRAB_AND_GO, GRAB_AND_GO_REVISION } from './services/automation'
import { useServiceNowBridge } from './hooks/useServiceNowBridge'
import { useServiceNowRelay } from './hooks/useServiceNowRelay'
import { useRelayInfo } from './hooks/useRelayInfo'
import { useIsNarrow } from './hooks/useMediaQuery'
import { playShiftSound } from './services/soundEffects'
import { isFirebaseConfigured } from './services/firebase'
import { watchSites, watchSite } from './services/db'
import { alertKindFor, jobTypeOf, processFields, toggleCheck } from './services/jobs'
import { notificationPermission, requestNotificationPermission } from './services/notify'
import { toDateKey } from './services/dailyReset'
import { DISPATCH_QUEUE, WORK_PROCESSES, DISPATCH_AUTOMATION } from './services/features'
import { askAssistant } from './services/assistantApi'
import { firstNameOf, formatClockHM, formatShortDate } from './services/format'
import {
  isGlobalAdmin, isSiteAdminOf, isAnyAdmin, canUseSite, needsSiteSetup,
  currentSiteOf, adminSiteOf, isTempMoveActive, lastDayOf
} from './services/roles'
import {
  BASE_DAYS_META,
  DEFAULT_DAY_SCHEDULES,
  buildDaysOfWeek,
  buildSchedule,
  minutesSinceMidnight
} from './services/schedule'

// Per-device preferences. A global admin's chosen site is remembered so a
// wall display signed in with an admin account keeps showing the site it was
// set to; a muted wall display stays muted across a reboot.
const SITE_KEY = 'nblab.activeSite.v1'
const THEME_KEY = 'nblab.theme.v1'
const SOUND_KEY = 'nblab.sound.v1'
const readStored = (key) => {
  try { return localStorage.getItem(key) } catch { return null }
}
const store = (key, value) => {
  try { localStorage.setItem(key, value) } catch { /* storage blocked */ }
}

/** People queued on one day, in stored order, skipping hidden or deleted ids. */
const peopleForDay = (dayQueues, day, workerById) =>
  ((dayQueues && dayQueues[day]) || []).map(id => workerById.get(id)).filter(Boolean)

const perPersonMinutes = (day, people) =>
  (people.length > 0 && day?.isWorkDay ? day.totalMinutes / people.length : 0)

const now = () => formatClockHM(new Date())

function App() {
  const [theme, setTheme] = useState(() => (readStored(THEME_KEY) === 'dark' ? 'dark' : 'light'))
  const [route, navigate] = useHashRoute('home')
  const isNarrow = useIsNarrow()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  const changeTheme = (next) => {
    store(THEME_KEY, next)
    setTheme(next)
  }
  const toggleTheme = () => changeTheme(theme === 'dark' ? 'light' : 'dark')

  // ---- Session ---------------------------------------------------------------
  const auth = useAuth()
  const profile = auth.profile
  const session = auth.user && auth.hasProfile ? { ...profile, uid: auth.user.uid } : null
  const global = isGlobalAdmin(profile)

  // ---- Clock -------------------------------------------------------------------
  // Everything time-derived hangs off this — the current site (temporary moves
  // end at midnight), the day, who is on duty — so a display left running
  // overnight rolls over by itself.
  const [currentTime, setCurrentTime] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // ---- Sites -------------------------------------------------------------------
  // Admins may list sites: global admins to switch between them, site admins
  // to choose where to move someone. Only global admins get the switcher.
  const [sitesState, setSitesState] = useState({ loaded: false, list: [] })
  const canListSites = !!session && isAnyAdmin(profile)
  useEffect(() => {
    if (!canListSites) return undefined
    return watchSites(
      list => setSitesState({ loaded: true, list }),
      () => setSitesState(prev => ({ ...prev, loaded: true }))
    )
  }, [canListSites])
  const sites = canListSites ? sitesState.list : []

  const [chosenSiteId, setChosenSiteId] = useState(() => readStored(SITE_KEY))
  const homeSiteId = profile?.siteId || null
  // Where this person works today: home, or a temporary site while a move is
  // in force. Global admins may instead look at any site they choose.
  const workSiteId = currentSiteOf(profile, currentTime)
  const chosenIsValid = !!chosenSiteId && (!sitesState.loaded || sites.some(s => s.id === chosenSiteId))
  const activeSiteId = global && chosenIsValid ? chosenSiteId : workSiteId

  const canUse = !!session && canUseSite(session, activeSiteId, currentTime)
  // The site whose accounts the Admin page manages: a site admin's HOME site,
  // even while they are temporarily working somewhere else.
  const adminSiteId = session ? adminSiteOf(session, activeSiteId) : null
  const canAdminister = !!adminSiteId && isSiteAdminOf(session, adminSiteId)

  // The site document, tagged with the id it belongs to so a site switch can
  // never show one site's name over another site's board.
  const [siteState, setSiteState] = useState({ id: null, site: null })
  useEffect(() => {
    if (!canUse || !activeSiteId) return undefined
    return watchSite(activeSiteId, site => setSiteState({ id: activeSiteId, site }), () => {})
  }, [canUse, activeSiteId])
  const site = siteState.id === activeSiteId ? siteState.site : undefined // undefined = loading

  // A site admin temporarily away administers their home site, which is not
  // the site on screen — so it needs its own document.
  const [adminSiteState, setAdminSiteState] = useState({ id: null, site: null })
  const needsAdminSite = canAdminister && adminSiteId !== activeSiteId
  useEffect(() => {
    if (!needsAdminSite) return undefined
    return watchSite(adminSiteId, s => setAdminSiteState({ id: adminSiteId, site: s }), () => {})
  }, [needsAdminSite, adminSiteId])
  const adminSite = !canAdminister ? null
    : adminSiteId === activeSiteId ? site
      : adminSiteState.id === adminSiteId ? adminSiteState.site : undefined

  // ---- Board data --------------------------------------------------------------
  const dq = useDispatchQueue({ siteId: activeSiteId, canUse, uid: auth.user?.uid, now: currentTime })
  const { todayDayIndex, workers, dayQueues, daySchedules, isLoaded, isStale } = dq
  const connection = isStale ? 'stale' : isLoaded ? 'live' : 'connecting'

  // ---- Day selection, following the calendar -------------------------------
  const [selectedDayKey, setSelectedDayKey] = useState(() => new Date().getDay())
  const previousTodayRef = useRef(todayDayIndex)
  useEffect(() => {
    if (previousTodayRef.current === todayDayIndex) return
    const previousToday = previousTodayRef.current
    previousTodayRef.current = todayDayIndex
    setSelectedDayKey(current => (current === previousToday ? todayDayIndex : current))
  }, [todayDayIndex])

  // ---- Derived schedules --------------------------------------------------------
  const daysOfWeek = useMemo(() => buildDaysOfWeek(daySchedules || DEFAULT_DAY_SCHEDULES), [daySchedules])
  const activeDay = daysOfWeek[selectedDayKey] || daysOfWeek[todayDayIndex]
  const todayDay = daysOfWeek[todayDayIndex]
  const isSelectedDayToday = selectedDayKey === todayDayIndex
  const nowMinutes = minutesSinceMidnight(currentTime)

  const workerById = useMemo(() => new Map(workers.map(w => [w.id, w])), [workers])

  const selectedPeople = useMemo(
    () => peopleForDay(dayQueues, selectedDayKey, workerById),
    [dayQueues, selectedDayKey, workerById]
  )
  const todayPeople = useMemo(
    () => peopleForDay(dayQueues, todayDayIndex, workerById),
    [dayQueues, todayDayIndex, workerById]
  )

  const selectedSchedule = useMemo(
    () => buildSchedule({ day: activeDay, people: selectedPeople, nowMinutes, isToday: isSelectedDayToday }),
    [activeDay, selectedPeople, nowMinutes, isSelectedDayToday]
  )
  // Turnover, the wall display and the home summary are always about TODAY,
  // whatever day the Queue page happens to be browsing. Driving them from the
  // selected day rang a false "shift over" bell just from flipping days.
  const todaySchedule = useMemo(
    () => buildSchedule({ day: todayDay, people: todayPeople, nowMinutes, isToday: true }),
    [todayDay, todayPeople, nowMinutes]
  )

  // Every queued person, with shift times where the day has them — so people
  // added on a day off stay visible and removable.
  const queuedRows = useMemo(() => {
    const times = new Map(selectedSchedule.map(p => [p.id, p]))
    return selectedPeople.map((person, index) => ({ ...person, position: index + 1, ...(times.get(person.id) || {}) }))
  }, [selectedPeople, selectedSchedule])

  const queuedIds = selectedPeople.map(p => p.id)
  const availablePeople = workers.filter(w => !queuedIds.includes(w.id))
  const todayServing = todaySchedule.find(p => p.status === 'serving')

  // "Visiting from L9 until Thu 1 Oct" — people lent to this site. Only admins
  // can read other sites' names; everyone else sees when the visit ends.
  const visitorNote = (person) => {
    if (!isTempMoveActive(person, currentTime) || person.tempSiteId !== activeSiteId || person.siteId === activeSiteId) return null
    const home = sites.find(s => s.id === person.siteId)
    const until = formatShortDate(lastDayOf(person.tempEndsAt))
    return home ? `Visiting from ${home.name} until ${until}` : `Visiting until ${until}`
  }

  // ---- Sound & turnover ---------------------------------------------------------
  const [soundEnabled, setSoundEnabled] = useState(() => readStored(SOUND_KEY) !== 'off')
  const toggleSound = () => setSoundEnabled(on => {
    store(SOUND_KEY, on ? 'off' : 'on')
    return !on
  })
  const [toast, setToast] = useState(null)
  const turnoverRef = useRef({ key: null, previous: null })

  useEffect(() => {
    if (!isLoaded || !todayDay?.isWorkDay) return

    const currentId = todayServing
      ? todayServing.id
      : (nowMinutes >= todayDay.endMins ? 'SHIFT_COMPLETED' : 'BEFORE_START')

    // A new session, site or day starts a fresh baseline: never chime just
    // because someone signed in or switched site mid-shift.
    const key = `${auth.user?.uid}|${activeSiteId}|${todayDayIndex}`
    if (turnoverRef.current.key !== key) {
      turnoverRef.current = { key, previous: currentId }
      return
    }

    const previousId = turnoverRef.current.previous
    turnoverRef.current.previous = currentId
    if (!previousId || previousId === currentId) return
    if (previousId === 'BEFORE_START' || previousId === 'SHIFT_COMPLETED') return

    if (soundEnabled) playShiftSound()
    const previous = workers.find(w => w.id === previousId)
    const isDayDone = currentId === 'SHIFT_COMPLETED'
    setToast({
      title: isDayDone ? 'Day completed' : 'Shift change',
      message: isDayDone
        ? `Every shift is done for ${todayDay.name}.`
        : `${previous ? previous.name : 'The last shift'} is done. On duty now: ${todayServing ? todayServing.name : 'next in queue'}.`,
      time: now()
    })
  }, [todayServing, nowMinutes, todayDay, isLoaded, soundEnabled, workers, auth.user?.uid, activeSiteId, todayDayIndex])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [toast])

  const handleTestChime = () => {
    playShiftSound()
    setToast({ title: 'Chime test', message: 'This plays on every station here when the shift changes.', time: now() })
  }

  // ---- Jobs -----------------------------------------------------------------------
  // Open jobs show on the queue and the wall display until they are done. A NEW
  // job rings: loudly, with a desktop notification, on the assignee's station;
  // softly, with a toast, everywhere else; not at all for whoever created it.
  const [notificationState, setNotificationState] = useState(notificationPermission)
  const [isJobDialogOpen, setIsJobDialogOpen] = useState(false)

  const handleNewJob = (job) => {
    const kind = alertKindFor(job, auth.user?.uid)
    if (kind === 'self') return
    const label = jobTypeOf(job.type).label
    const steps = job.steps?.length ? ` · ${job.steps.length} steps` : ''
    const detail = `${job.note ? ` — ${job.note}` : ''}${steps}`
    if (kind === 'mine') {
      if (soundEnabled) playShiftSound('digital_radar')
      jobs.notifyDesktop(job, {
        title: `New job for you: ${label}`,
        body: `${job.note || 'No note'} · from ${job.createdByName}${steps}`
      })
      setToast({ title: `New job for you: ${label}`, message: `From ${job.createdByName}${detail}`, time: now(), tone: 'accent' })
    } else {
      if (soundEnabled) playShiftSound('subtle_blip')
      setToast({ title: `New job: ${label}`, message: `For ${job.assigneeName}${detail}`, time: now() })
    }
  }

  const jobs = useJobs({ siteId: activeSiteId, canUse, dayKey: toDateKey(currentTime), onNewJob: handleNewJob })

  const handleCreateJob = ({ type, assigneeId, note, process }) => {
    const assignee = workers.find(w => w.id === assigneeId)
    return jobs.create({
      type,
      note,
      assigneeId,
      assigneeName: assignee?.name || 'Worker',
      createdBy: auth.user.uid,
      createdByName: session?.name || 'Someone',
      process: processFields(process)
    })
  }

  // ---- Work processes -------------------------------------------------------------
  // A job of a type with a process carries its steps; the checklist dialog
  // follows the live job, so ticks from another station show up here too.
  const workProcesses = useProcesses({ siteId: activeSiteId, canRead: canUse })
  // The automation agent on this PC: checked on the Automation page, and kept
  // up to date from any page where it has answered before.
  const localAgent = useLocalAgent({
    active: route === 'automation' && canUse,
    automation: canUse ? GRAB_AND_GO : null,
    revision: GRAB_AND_GO_REVISION,
    siteId: activeSiteId,
    siteName: site?.name || ''
  })

  // Unassigned ServiceNow tasks: from the main PC's relay when this page was
  // opened from it, otherwise from the watcher in this browser (if any).
  const relayInfo = useRelayInfo()
  const serviceNowBridge = useServiceNowBridge()
  const serviceNowRelay = useServiceNowRelay(auth.user, relayInfo.isRelay)

  // The AI tech assistant: only through the main PC's relay, which holds the
  // Gemini key. A job's "Ask AI" opens it with that job (the seed).
  const aiAvailable = relayInfo.ai && !!auth.user
  const [assistantSeed, setAssistantSeed] = useState(null)
  const askAiAbout = aiAvailable ? (job) => {
    setChecklistJobId(null)
    setAssistantSeed({ job })
    navigate('assistant')
  } : undefined
  const clearAssistantSeed = useCallback(() => setAssistantSeed(null), [])
  const draftProcess = aiAvailable
    ? async ({ title, jobType, steps }) => (await askAssistant({
        user: auth.user, mode: 'draft-process', context: { draft: { title, jobType, steps } }
      })).draft
    : undefined
  const serviceNow = serviceNowRelay.present ? serviceNowRelay : serviceNowBridge
  const [checklistJobId, setChecklistJobId] = useState(null)
  const checklistJob = jobs.openJobs.find(job => job.id === checklistJobId) || null

  const enableDesktopAlerts = async () => {
    setNotificationState(await requestNotificationPermission())
  }

  // ---- Wall display ---------------------------------------------------------------
  const [isWall, setIsWall] = useState(false)

  const enterWall = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
    setIsWall(true)
  }
  const exitWall = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    setIsWall(false)
  }

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement && isWall) setIsWall(false) }
    const onKey = (e) => { if (e.key === 'Escape' && isWall) setIsWall(false) }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [isWall])

  // ---- Shift hours ------------------------------------------------------------------
  const [hoursFocus, setHoursFocus] = useState(null) // day key, or null when closed

  const handleSaveHours = async (changes) => {
    // One write per changed day — see services/db.js.
    for (const { day, schedule } of changes) {
      await dq.actions.setDaySchedule(day, { ...schedule })
    }
    setToast({
      title: 'Hours updated',
      message: changes.length === 1
        ? `${BASE_DAYS_META[changes[0].day].name} is now ${changes[0].schedule.isWorkDay ? `${changes[0].schedule.startTime} – ${changes[0].schedule.endTime}` : 'a day off'}.`
        : `${changes.length} days changed.`,
      time: now()
    })
  }

  // ---- Session actions ----------------------------------------------------------------
  const resetView = () => {
    setToast(null)
    setHoursFocus(null)
    setIsJobDialogOpen(false)
    setChecklistJobId(null)
    if (isWall) exitWall()
    setSelectedDayKey(new Date().getDay())
  }

  const handleSignOut = async () => {
    resetView()
    await auth.signOut()
    navigate('home')
  }

  const handleSwitchSite = (siteId) => {
    resetView()
    setChosenSiteId(siteId)
    store(SITE_KEY, siteId)
  }

  // ---- Gates ----------------------------------------------------------------------------
  const gate = (content) => <div className="app is-gated"><main className="gate-wrap">{content}</main></div>
  const signOutAction = { label: 'Sign out', onClick: handleSignOut }
  const reloadAction = { label: 'Try again', onClick: () => window.location.reload(), primary: true }

  if (!isFirebaseConfigured()) {
    return gate(<ConnectionGate kind="error" title="Not configured"
      message="This build is missing its Firebase configuration, so there is no board to connect to." />)
  }

  // Waiting for Firebase to report whether a session was restored. Showing the
  // sign-in page here would flash it on every wall-display reboot.
  if (!auth.authReady) {
    return gate(<ConnectionGate kind="working" title="Starting…" />)
  }

  if (!auth.isSignedIn) {
    return <SignInPage theme={theme} onToggleTheme={toggleTheme} />
  }

  if (auth.profileStatus === 'idle' || auth.profileStatus === 'loading') {
    return gate(<ConnectionGate kind="working" title="Loading your account…" />)
  }

  if (auth.profileStatus === 'error' && !profile) {
    return gate(<ConnectionGate kind="offline" title="Cannot load your account"
      message="The server could not be reached. This retries on its own — the board appears as soon as the connection is back."
      detail={auth.profileError}
      actions={[reloadAction, signOutAction]} />)
  }

  if (auth.profileStatus === 'missing') {
    return gate(<ConnectionGate kind="account" title="This account is not set up"
      message="You are signed in, but there is no profile for this account — it may have been revoked. An administrator can set it up again."
      actions={[signOutAction]} />)
  }

  if (needsSiteSetup(profile)) {
    return global
      ? <SiteSetupPage uid={auth.user.uid} name={profile.name} onSignOut={handleSignOut} theme={theme} onToggleTheme={toggleTheme} />
      : gate(<ConnectionGate kind="account" title="No site assigned"
          message="Your account is not assigned to a site yet. Ask an administrator to assign one."
          actions={[signOutAction]} />)
  }

  if (site === null) {
    return gate(<ConnectionGate kind="account" title="Site not found"
      message={global
        ? 'This site no longer exists. Go back to your home site, or pick another.'
        : 'Your site no longer exists. Ask an administrator to move your account to another site.'}
      actions={global && homeSiteId !== activeSiteId
        ? [{ label: 'Go to my home site', onClick: () => handleSwitchSite(homeSiteId), primary: true }, signOutAction]
        : [signOutAction]} />)
  }

  const needsBoard = route === 'queue' || isWall

  if (site === undefined || (needsBoard && !isLoaded)) {
    return gate(dq.error
      ? <ConnectionGate kind="offline" title="Cannot reach the board"
          message="The queue lives in the cloud and there is no offline copy. This retries on its own."
          detail={dq.error} actions={[reloadAction, signOutAction]} />
      : <ConnectionGate kind="working" title="Loading the board…" />)
  }

  if (isWall) {
    return (
      <WallDisplay
        site={site}
        currentTime={currentTime}
        day={todayDay}
        schedule={todaySchedule}
        nowMinutes={nowMinutes}
        jobs={jobs.openJobs}
        serviceNow={serviceNow}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        onExit={exitWall}
        isStale={isStale}
      />
    )
  }

  // ---- Pages ------------------------------------------------------------------------------
  const isSiteAdminHere = isSiteAdminOf(session, activeSiteId)
  const openJobDialog = () => setIsJobDialogOpen(true)

  let content
  if (route === 'admin') {
    if (!canAdminister) {
      content = (
        <ConnectionGate kind="forbidden" title="Administrators only"
          message="This page is for site and global administrators."
          actions={[{ label: 'Go home', onClick: () => navigate('home'), primary: true }]} />
      )
    } else if (adminSite === undefined) {
      content = <ConnectionGate kind="working" title="Loading…" />
    } else {
      content = (
        <AdminPage
          key={adminSiteId}
          session={session}
          site={{ id: adminSiteId, ...(adminSite || {}) }}
          sites={sites}
          now={currentTime}
          onSelectSite={handleSwitchSite}
          daySchedules={daySchedules}
          hoursAvailable={adminSiteId === activeSiteId && isLoaded && !isStale}
          onEditHours={() => setHoursFocus(todayDayIndex)}
        />
      )
    }
  } else if (route === 'processes') {
    content = (
      <ProcessesPage
        key={activeSiteId}
        site={site}
        processes={workProcesses.processes}
        loaded={workProcesses.loaded}
        error={workProcesses.error}
        canEdit={isSiteAdminHere}
        uid={auth.user.uid}
        isNarrow={isNarrow}
        onDraft={draftProcess}
      />
    )
  } else if (route === 'automation') {
    content = (
      <AutomationPage
        key={activeSiteId}
        site={site}
        automation={GRAB_AND_GO}
        agent={localAgent}
      />
    )
  } else if (route === 'settings') {
    content = (
      <SettingsPage
        currentTime={currentTime}
        theme={theme}
        onThemeChange={changeTheme}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        onTestChime={handleTestChime}
        notificationState={notificationState}
        onEnableNotifications={enableDesktopAlerts}
        serviceNow={serviceNow}
        relayInfo={relayInfo}
      />
    )
  } else if (route === 'assistant') {
    content = (
      <AssistantPage
        available={aiAvailable}
        user={auth.user}
        processes={workProcesses.processes}
        seed={assistantSeed}
        onSeedUsed={clearAssistantSeed}
      />
    )
  } else if (route === 'queue') {
    content = (
      <QueuePage
        isNarrow={isNarrow}
        isStale={isStale}
        currentTime={currentTime}
        daysOfWeek={daysOfWeek}
        activeDay={activeDay}
        selectedDayKey={selectedDayKey}
        onSelectDay={setSelectedDayKey}
        todayDayIndex={todayDayIndex}
        isSelectedDayToday={isSelectedDayToday}
        rows={queuedRows}
        schedule={selectedSchedule}
        availablePeople={availablePeople}
        hasWorkers={workers.length > 0}
        minutesPerPerson={perPersonMinutes(activeDay, selectedPeople)}
        nowMinutes={nowMinutes}
        doneToday={jobs.doneToday}
        visitorNote={visitorNote}
        logLabel={todayServing ? `Log a job for ${firstNameOf(todayServing.name)}` : 'Log a job'}
        onLogJob={openJobDialog}
        onTestChime={handleTestChime}
        onEditHours={() => setHoursFocus(selectedDayKey)}
        onWallDisplay={enterWall}
        onToggle={(id) => dq.actions.toggle(selectedDayKey, id)}
        onMove={(id, direction) => dq.actions.move(selectedDayKey, id, direction, queuedIds)}
        onAddAll={() => dq.actions.addAll(selectedDayKey, availablePeople.map(p => p.id))}
        onClear={() => dq.actions.clear(selectedDayKey)}
      />
    )
  } else {
    const todayCount = todayPeople.length
    content = (
      <HomePage
        site={site}
        currentTime={currentTime}
        todayDay={todayDay}
        todaySchedule={todaySchedule}
        nowMinutes={nowMinutes}
        openJobsCount={jobs.openJobs.length}
        summaries={{
          [DISPATCH_QUEUE]: !todayDay.isWorkDay ? 'Day off today' : todayCount > 0 ? `${todayCount} in queue today` : 'Queue empty today',
          [WORK_PROCESSES]: `${workProcesses.processes.length} ${workProcesses.processes.length === 1 ? 'process' : 'processes'}`,
          [DISPATCH_AUTOMATION]: 'Grab & Go returns'
        }}
        tempUntil={!global && isTempMoveActive(profile, currentTime) ? formatShortDate(lastDayOf(profile.tempEndsAt)) : null}
        onNavigate={navigate}
      />
    )
  }

  const errors = [
    dq.error && isLoaded && !isStale && { key: 'dq', text: dq.error, clear: dq.clearError },
    jobs.error && { key: 'jobs', text: jobs.error, clear: jobs.clearError }
  ].filter(Boolean)

  return (
    <div className={`app ${route === 'queue' && isNarrow ? 'has-bottom-bar' : ''}`}>
      <AppBar
        route={route}
        onNavigate={navigate}
        theme={theme}
        onToggleTheme={toggleTheme}
        currentTime={currentTime}
        session={session}
        isGlobal={global}
        canAdminister={canAdminister}
        site={{ id: activeSiteId, ...site }}
        sites={global ? sites : []}
        onSwitchSite={handleSwitchSite}
        onSignOut={handleSignOut}
        connection={connection}
        isNarrow={isNarrow}
        showAssistant={aiAvailable}
      />

      {route === 'queue' && (
        <JobsStrip
          jobs={jobs.openJobs}
          uid={auth.user?.uid}
          isSiteAdmin={isSiteAdminHere}
          now={currentTime}
          isNarrow={isNarrow}
          onNew={isStale ? undefined : openJobDialog}
          onComplete={(jobId) => jobs.complete(jobId, auth.user.uid)}
          onDelete={(jobId) => jobs.remove(jobId)}
          onOpenChecklist={setChecklistJobId}
          onAskAi={askAiAbout}
        />
      )}
      {route === 'queue' && <ServiceNowStrip bridge={serviceNow} now={currentTime} limit={isNarrow ? 3 : 6} />}

      <main className="main">
        {errors.map(error => (
          <p key={error.key} className="alert page-alert" role="alert">
            <AlertCircle size={16} /><span>{error.text}</span>
            <button className="icon-btn is-sm" onClick={error.clear} aria-label="Dismiss"><X size={14} /></button>
          </p>
        ))}
        {content}
      </main>

      {hoursFocus !== null && (
        <HoursDialog
          daySchedules={daySchedules}
          focusDay={hoursFocus}
          queueCounts={Object.fromEntries(BASE_DAYS_META.map(m => [m.key, peopleForDay(dayQueues, m.key, workerById).length]))}
          onSave={handleSaveHours}
          onClose={() => setHoursFocus(null)}
        />
      )}

      {isJobDialogOpen && (
        <JobDialog
          workers={workers}
          onDutyId={todayServing?.id}
          processes={workProcesses.processes}
          onSubmit={handleCreateJob}
          onClose={() => setIsJobDialogOpen(false)}
        />
      )}

      {checklistJob && (
        <JobChecklistDialog
          job={checklistJob}
          uid={auth.user?.uid}
          isSiteAdmin={isSiteAdminHere}
          onTick={(index) => jobs.tick(checklistJob.id, toggleCheck(checklistJob, index))}
          onComplete={() => jobs.complete(checklistJob.id, auth.user.uid)}
          onClose={() => setChecklistJobId(null)}
          onAskAi={askAiAbout}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export default App
