import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import './App.css'

import { AppBar } from './components/AppBar'
import { FirebaseModal } from './components/FirebaseModal'
import { SoundModal } from './components/SoundModal'
import { FullScreenBoard } from './components/FullScreenBoard'
import { DayScheduleDialog } from './components/DayScheduleDialog'
import { HomePage } from './pages/HomePage'
import { QueuePage } from './pages/QueuePage'

import { useHashRoute } from './hooks/useHashRoute'
import { useDispatchData } from './hooks/useDispatchData'
import { playShiftSound, getSavedSoundChoice, saveSoundChoice } from './services/soundEffects'
import { getConnectionState, onConnectionStatusChange } from './services/firebase'
import {
  DEFAULT_DAY_SCHEDULES,
  BASE_DAYS_META,
  buildDaysOfWeek,
  buildSchedule,
  minutesSinceMidnight,
  formatClockTime,
  formatDuration
} from './services/schedule'

function App() {
  const [theme, setTheme] = useState('dark')
  const [route, navigate] = useHashRoute('home')

  const {
    currentTime,
    todayDayIndex,
    roster,
    setRoster,
    dayQueues,
    setDayQueues,
    daySchedules,
    setDaySchedules,
    resubscribe
  } = useDispatchData()

  // ---- Theme -------------------------------------------------------------
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // ---- Day selection, following the calendar ------------------------------
  const [selectedDayKey, setSelectedDayKey] = useState(() => new Date().getDay())
  const previousTodayRef = useRef(todayDayIndex)

  // If the viewer is looking at "today" when the date changes, move them to
  // the new today; if they deliberately parked on another weekday, leave it.
  useEffect(() => {
    if (previousTodayRef.current === todayDayIndex) return
    const previousToday = previousTodayRef.current
    previousTodayRef.current = todayDayIndex
    setSelectedDayKey(current => (current === previousToday ? todayDayIndex : current))
  }, [todayDayIndex])

  // ---- Derived schedule ---------------------------------------------------
  const daysOfWeek = useMemo(() => buildDaysOfWeek(daySchedules), [daySchedules])
  const activeDay = daysOfWeek.find(day => day.key === selectedDayKey) || daysOfWeek[todayDayIndex]
  const isSelectedDayToday = selectedDayKey === todayDayIndex

  const currentDayQueueIds = useMemo(
    () => dayQueues[selectedDayKey] || [],
    [dayQueues, selectedDayKey]
  )

  const queuedPersonnel = useMemo(
    () => currentDayQueueIds.map(id => roster.find(p => p.id === id)).filter(Boolean),
    [currentDayQueueIds, roster]
  )

  const availablePeople = useMemo(
    () => roster.filter(person => !currentDayQueueIds.includes(person.id)),
    [roster, currentDayQueueIds]
  )

  const nowMinutes = minutesSinceMidnight(currentTime)

  const schedule = useMemo(
    () => buildSchedule({
      day: activeDay,
      people: queuedPersonnel,
      nowMinutes,
      isToday: isSelectedDayToday
    }),
    [activeDay, queuedPersonnel, nowMinutes, isSelectedDayToday]
  )

  const minutesPerPerson = queuedPersonnel.length > 0 && activeDay.isWorkDay
    ? activeDay.totalMinutes / queuedPersonnel.length
    : 0

  const currentServingPerson = schedule.find(person => person.status === 'serving')
  const nextInLinePerson = schedule.find(person => person.status === 'up-next')
  const currentServingIndex = schedule.findIndex(person => person.status === 'serving')

  // Collapse earlier completed officers on the wall display so the current and
  // previous officer stay large.
  let earlierCompletedCount = 0
  if (currentServingIndex > 1) {
    earlierCompletedCount = currentServingIndex - 1
  } else if (currentServingIndex === -1 && isSelectedDayToday) {
    const firstUpcoming = schedule.findIndex(p => p.status === 'up-next' || p.status === 'scheduled')
    if (firstUpcoming > 1) {
      earlierCompletedCount = firstUpcoming - 1
    } else if (firstUpcoming === -1 && schedule.length > 2) {
      earlierCompletedCount = schedule.length - 2
    }
  }

  // ---- Connection status --------------------------------------------------
  const [connectionState, setConnectionState] = useState(getConnectionState)
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false)
  useEffect(() => onConnectionStatusChange(setConnectionState), [])

  // ---- Sound & turnover notification --------------------------------------
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [selectedSoundId, setSelectedSoundId] = useState(getSavedSoundChoice)
  const [isSoundModalOpen, setIsSoundModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const previousServingIdRef = useRef(null)
  const isFirstTurnoverCheckRef = useRef(true)

  useEffect(() => {
    if (!activeDay.isWorkDay) return

    const currentId = currentServingPerson
      ? currentServingPerson.id
      : (nowMinutes >= activeDay.endMins ? 'SHIFT_COMPLETED' : 'BEFORE_START')

    // Never chime on the initial load.
    if (isFirstTurnoverCheckRef.current) {
      previousServingIdRef.current = currentId
      isFirstTurnoverCheckRef.current = false
      return
    }

    const previousId = previousServingIdRef.current
    previousServingIdRef.current = currentId

    if (!previousId || previousId === currentId) return
    if (previousId === 'BEFORE_START' || previousId === 'SHIFT_COMPLETED') return

    if (soundEnabled) playShiftSound(selectedSoundId)

    const previousOfficer = roster.find(person => person.id === previousId)
    const isDayDone = currentId === 'SHIFT_COMPLETED'

    setToast({
      title: isDayDone ? 'Day shift completed' : 'Shift over',
      message: isDayDone
        ? `All dispatch shifts have completed for ${activeDay.name}.`
        : `${previousOfficer ? previousOfficer.name : 'Officer'}'s shift is over. Now on duty: ${currentServingPerson ? currentServingPerson.name : 'next officer'}.`,
      time: formatClockTime(new Date())
    })
  }, [currentServingPerson, nowMinutes, soundEnabled, selectedSoundId, activeDay, roster])

  // Auto-dismiss lives in its own effect keyed on the toast. Setting the timer
  // inside the turnover effect above would not work: that effect re-runs every
  // second with the clock, so its cleanup would clear the pending timer and the
  // early-return path would never set a new one, leaving the toast up forever.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [toast])

  const handleTestBell = () => {
    playShiftSound(selectedSoundId)
    setToast({
      title: 'Turnover sound test',
      message: currentServingPerson
        ? `This is what plays when ${currentServingPerson.name}'s slot finishes.`
        : 'This is what plays when a dispatch shift concludes.',
      time: formatClockTime(new Date())
    })
  }

  // ---- Full screen --------------------------------------------------------
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [showAllInFullScreen, setShowAllInFullScreen] = useState(false)

  const enterFullScreen = () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {})
    }
    setShowAllInFullScreen(false)
    setIsFullScreen(true)
  }

  const exitFullScreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    }
    setIsFullScreen(false)
  }

  useEffect(() => {
    const handleFullScreenChange = () => {
      if (!document.fullscreenElement && isFullScreen) setIsFullScreen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isFullScreen) setIsFullScreen(false)
    }
    document.addEventListener('fullscreenchange', handleFullScreenChange)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullScreen])

  // ---- Day schedule dialog -------------------------------------------------
  const [editingDayKey, setEditingDayKey] = useState(null)
  const [editForm, setEditForm] = useState({ isWorkDay: true, startTime: '08:00', endTime: '16:30' })

  const openEditModal = (dayKey) => {
    const target = daySchedules[dayKey] || DEFAULT_DAY_SCHEDULES[dayKey]
    setEditingDayKey(dayKey)
    setEditForm({
      isWorkDay: target.isWorkDay,
      startTime: target.startTime,
      endTime: target.endTime
    })
  }

  const handleSaveDaySchedule = (event) => {
    if (event) event.preventDefault()
    if (editingDayKey === null) return

    setDaySchedules(previous => ({
      ...previous,
      [editingDayKey]: {
        isWorkDay: editForm.isWorkDay,
        startTime: editForm.startTime,
        endTime: editForm.endTime
      }
    }))

    setToast({
      title: 'Hours updated',
      message: `${BASE_DAYS_META[editingDayKey].name} set to ${editForm.isWorkDay ? `${editForm.startTime} – ${editForm.endTime}` : 'a day off'}.`,
      time: formatClockTime(new Date())
    })
    setEditingDayKey(null)
  }

  const handleResetDaySchedule = () => {
    if (editingDayKey === null) return
    const def = DEFAULT_DAY_SCHEDULES[editingDayKey]
    setEditForm({ isWorkDay: def.isWorkDay, startTime: def.startTime, endTime: def.endTime })
  }

  // ---- Queue mutations -----------------------------------------------------
  const updateQueue = (updater) => {
    setDayQueues(previous => ({
      ...previous,
      [selectedDayKey]: updater(previous[selectedDayKey] || [])
    }))
  }

  const handleToggle = (personId) => {
    updateQueue(list =>
      list.includes(personId) ? list.filter(id => id !== personId) : [...list, personId]
    )
  }

  const handleMove = (index, direction) => {
    updateQueue(list => {
      const target = index + direction
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleAddAll = () => updateQueue(() => roster.map(person => person.id))
  const handleClear = () => updateQueue(() => [])

  const handleAddPerson = (name) => {
    const colors = ['#818cf8', '#a78bfa', '#60a5fa', '#c084fc', '#e879f9', '#6366f1', '#f0abfc']
    const newPerson = {
      id: String(Date.now()),
      name,
      role: 'Dispatch Specialist',
      color: colors[roster.length % colors.length]
    }
    setRoster(previous => [...previous, newPerson])
    updateQueue(list => [...list, newPerson.id])
  }

  // Removing someone from the team pulls them out of every day's queue too,
  // otherwise they linger as an unresolvable id.
  const handleRemovePerson = (personId) => {
    setRoster(previous => previous.filter(person => person.id !== personId))
    setDayQueues(previous => {
      const next = {}
      for (const [key, list] of Object.entries(previous)) {
        next[key] = list.filter(id => id !== personId)
      }
      return next
    })
  }

  // ---- Render --------------------------------------------------------------
  const formattedDate = currentTime.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  const queueSummary = activeDay.isWorkDay && queuedPersonnel.length > 0
    ? `${queuedPersonnel.length} in today's queue · ${formatDuration(minutesPerPerson)} each`
    : null

  if (isFullScreen) {
    return (
      <FullScreenBoard
        activeDay={activeDay}
        formattedDate={formattedDate}
        currentTime={currentTime}
        schedule={schedule}
        earlierCompletedCount={earlierCompletedCount}
        showAll={showAllInFullScreen}
        onToggleShowAll={() => setShowAllInFullScreen(open => !open)}
        nowMinutes={nowMinutes}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(on => !on)}
        onTestBell={handleTestBell}
        onExit={exitFullScreen}
      />
    )
  }

  return (
    <div className="app-container">
      {toast && (
        <div className="md-bell-toast" role="alert">
          <div className="md-bell-toast-icon">
            <Bell size={20} className="bell-ringing" />
          </div>
          <div className="md-bell-toast-content">
            <strong>
              <span>{toast.title}</span>
              <span className="md-bell-toast-time">{toast.time}</span>
            </strong>
            <p>{toast.message}</p>
          </div>
          <button className="md-bell-toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <AppBar
        route={route}
        onNavigate={navigate}
        theme={theme}
        onToggleTheme={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))}
        connectionState={connectionState}
        onOpenFirebase={() => setIsFirebaseModalOpen(true)}
        currentTime={currentTime}
      />

      <main className="md-main-content">
        {route === 'queue' ? (
          <QueuePage
            daysOfWeek={daysOfWeek}
            activeDay={activeDay}
            selectedDayKey={selectedDayKey}
            onSelectDay={setSelectedDayKey}
            todayDayIndex={todayDayIndex}
            isSelectedDayToday={isSelectedDayToday}
            formattedDate={formattedDate}
            schedule={schedule}
            availablePeople={availablePeople}
            minutesPerPerson={minutesPerPerson}
            currentServingPerson={currentServingPerson}
            nextInLinePerson={nextInLinePerson}
            nowMinutes={nowMinutes}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(on => !on)}
            onTestBell={handleTestBell}
            onOpenSoundModal={() => setIsSoundModalOpen(true)}
            onOpenFullScreen={enterFullScreen}
            onEditHours={() => openEditModal(selectedDayKey)}
            onToggle={handleToggle}
            onMove={handleMove}
            onAddAll={handleAddAll}
            onClear={handleClear}
            onAddPerson={handleAddPerson}
            onRemovePerson={handleRemovePerson}
          />
        ) : (
          <HomePage
            onNavigate={navigate}
            currentTime={currentTime}
            queueSummary={queueSummary}
          />
        )}
      </main>

      {editingDayKey !== null && (
        <DayScheduleDialog
          dayName={BASE_DAYS_META[editingDayKey].name}
          form={editForm}
          onChange={setEditForm}
          officerCount={(dayQueues[editingDayKey] || []).length}
          onSubmit={handleSaveDaySchedule}
          onReset={handleResetDaySchedule}
          onClose={() => setEditingDayKey(null)}
        />
      )}

      <FirebaseModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
        connectionState={connectionState}
        onConfigChanged={resubscribe}
      />

      <SoundModal
        isOpen={isSoundModalOpen}
        onClose={() => setIsSoundModalOpen(false)}
        selectedSoundId={selectedSoundId}
        onSelectSound={(soundId) => {
          setSelectedSoundId(soundId)
          saveSoundChoice(soundId)
        }}
      />
    </div>
  )
}

export default App
