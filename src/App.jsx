import React, { useState, useEffect, useRef } from 'react'
import {
  Radio,
  Clock,
  Sun,
  Moon,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Calendar,
  CheckCircle,
  AlertCircle,
  Play,
  GripVertical,
  Users,
  UserPlus,
  Sparkles,
  Coffee,
  Maximize2,
  Minimize2,
  Bell,
  BellOff
} from 'lucide-react'
import './App.css'

// Synthesize an authentic multi-tone service bell ring using Web Audio API
const playBellRing = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const now = ctx.currentTime

    const strikeBell = (freq, time, decay, gainLevel = 0.38) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, time)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.994, time + decay)

      gain.gain.setValueAtTime(0.0001, time)
      gain.gain.exponentialRampToValueAtTime(gainLevel, time + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, time + decay)

      // Harmonic overtone for crisp metallic bell chime
      const overtone = ctx.createOscillator()
      const overtoneGain = ctx.createGain()
      overtone.type = 'sine'
      overtone.frequency.setValueAtTime(freq * 2.76, time)
      overtoneGain.gain.setValueAtTime(gainLevel * 0.28, time + 0.01)
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, time + decay * 0.6)

      osc.connect(gain)
      gain.connect(ctx.destination)
      overtone.connect(overtoneGain)
      overtoneGain.connect(ctx.destination)

      osc.start(time)
      overtone.start(time)
      osc.stop(time + decay + 0.1)
      overtone.stop(time + decay + 0.1)
    }

    // Melodic bell chime sequence (Ding - Dong - Chime)
    strikeBell(1046.5, now, 1.5, 0.4)          // Ding (High C6)
    strikeBell(1318.51, now + 0.22, 2.2, 0.45)    // Dong (High E6)
    strikeBell(1567.98, now + 0.44, 2.6, 0.35)    // Chime (High G6)
  } catch (err) {
    console.warn('Audio Context error:', err)
  }
}

// 7-day configuration with work day rules:
// Sunday: 08:00 – 15:30 (450 minutes)
// Monday – Thursday: 08:00 – 16:30 (510 minutes)
// Friday & Saturday: Not work days (Weekend / Off)
const DAYS_OF_WEEK = [
  { key: 0, name: 'Sunday', short: 'Sun', hours: '08:00 – 15:30', totalMinutes: 450, isSunday: true, isWorkDay: true },
  { key: 1, name: 'Monday', short: 'Mon', hours: '08:00 – 16:30', totalMinutes: 510, isSunday: false, isWorkDay: true },
  { key: 2, name: 'Tuesday', short: 'Tue', hours: '08:00 – 16:30', totalMinutes: 510, isSunday: false, isWorkDay: true },
  { key: 3, name: 'Wednesday', short: 'Wed', hours: '08:00 – 16:30', totalMinutes: 510, isSunday: false, isWorkDay: true },
  { key: 4, name: 'Thursday', short: 'Thu', hours: '08:00 – 16:30', totalMinutes: 510, isSunday: false, isWorkDay: true },
  { key: 5, name: 'Friday', short: 'Fri', hours: 'Non-Working Day', totalMinutes: 0, isSunday: false, isWorkDay: false },
  { key: 6, name: 'Saturday', short: 'Sat', hours: 'Non-Working Day', totalMinutes: 0, isSunday: false, isWorkDay: false }
]

// Master team roster in Blue, White & Gray tones
const INITIAL_ROSTER = [
  { id: '1', name: 'Komer', role: 'Dispatch Specialist', color: '#2563eb' },
  { id: '2', name: 'Alen', role: 'Dispatch Specialist', color: '#0284c7' },
  { id: '3', name: 'Dani', role: 'Dispatch Specialist', color: '#38bdf8' },
  { id: '4', name: 'Yair', role: 'Dispatch Specialist', color: '#1d4ed8' },
  { id: '5', name: 'Chen', role: 'Dispatch Specialist', color: '#475569' },
  { id: '6', name: 'Dolev', role: 'Dispatch Specialist', color: '#0ea5e9' }
]

// Default day assignments (Sunday - Thursday work days with all 6 workers; Friday & Saturday off)
const INITIAL_DAY_QUEUES = {
  0: ['1', '2', '3', '4', '5', '6'], // Sunday crew (6 people)
  1: ['1', '2', '3', '4', '5', '6'], // Monday crew
  2: ['1', '2', '3', '4', '5', '6'], // Tuesday crew
  3: ['1', '2', '3', '4', '5', '6'], // Wednesday crew
  4: ['1', '2', '3', '4', '5', '6'], // Thursday crew (today)
  5: [],                             // Friday (Not a work day)
  6: []                              // Saturday (Not a work day)
}

function App() {
  const [theme, setTheme] = useState('dark')
  const [currentTime, setCurrentTime] = useState(new Date())

  // Real today day index (0 = Sunday, 1 = Monday, ..., 4 = Thursday)
  const todayDayIndex = new Date().getDay()
  const [selectedDayKey, setSelectedDayKey] = useState(todayDayIndex)

  // Roster and Day Queues state
  const [roster, setRoster] = useState(INITIAL_ROSTER)
  const [dayQueues, setDayQueues] = useState(INITIAL_DAY_QUEUES)
  const [newRosterName, setNewRosterName] = useState('')

  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragOverZone, setDragOverZone] = useState(null)
  const [dropTargetIndex, setDropTargetIndex] = useState(null)

  // Live real-time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Sync theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Full Screen Mode state
  const [isFullScreen, setIsFullScreen] = useState(false)

  const toggleFullScreen = () => {
    if (!isFullScreen) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {})
      }
      setIsFullScreen(true)
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
      setIsFullScreen(false)
    }
  }

  useEffect(() => {
    const handleFullScreenChange = () => {
      if (!document.fullscreenElement && isFullScreen) {
        setIsFullScreen(false)
      }
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullScreen) {
        setIsFullScreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullScreenChange)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullScreen])

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Active day config
  const activeDay = DAYS_OF_WEEK.find(d => d.key === selectedDayKey) || DAYS_OF_WEEK[todayDayIndex]
  const isSelectedDayToday = selectedDayKey === todayDayIndex

  // Shift calculation parameters
  const shiftStartMinutes = 8 * 60 // 08:00
  const shiftEndMinutes = activeDay.isSunday ? 15 * 60 + 30 : 16 * 60 + 30 // 15:30 (Sun) or 16:30 (Mon-Thu)
  const totalShiftMinutes = activeDay.isWorkDay ? shiftEndMinutes - shiftStartMinutes : 0

  // Current selected day's queue of person IDs
  const currentDayQueueIds = dayQueues[selectedDayKey] || []

  // Personnel in current day's queue
  const queuedPersonnel = currentDayQueueIds
    .map(id => roster.find(p => p.id === id))
    .filter(Boolean)

  // Personnel in roster pool (not currently assigned to selected day)
  const availableRosterPersonnel = roster.filter(
    p => !currentDayQueueIds.includes(p.id)
  )

  // Current real-time minutes from midnight
  const nowMinutes =
    currentTime.getHours() * 60 +
    currentTime.getMinutes() +
    currentTime.getSeconds() / 60

  // Divide shift equally among chosen team members
  const count = queuedPersonnel.length
  const minutesPerPerson = count > 0 && activeDay.isWorkDay ? totalShiftMinutes / count : 0

  // Helper: Format minutes into HH:MM
  const formatTime = (totalMins) => {
    const h = Math.floor(totalMins / 60)
    const m = Math.floor(totalMins % 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Helper: Format duration
  const formatDuration = (mins) => {
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
  }

  // Generate continuous schedule if it is a work day
  const schedule = activeDay.isWorkDay
    ? queuedPersonnel.map((person, index) => {
        const startMins = Math.round(shiftStartMinutes + index * minutesPerPerson)
        const endMins =
          index === count - 1
            ? shiftEndMinutes
            : Math.round(shiftStartMinutes + (index + 1) * minutesPerPerson)

        const durationMins = endMins - startMins

        let status = 'scheduled'
        let progressPercent = 0
        let remainingMinutes = 0

        if (isSelectedDayToday) {
          if (nowMinutes >= startMins && nowMinutes < endMins) {
            status = 'serving'
            progressPercent = Math.min(
              100,
              Math.max(0, ((nowMinutes - startMins) / durationMins) * 100)
            )
            remainingMinutes = Math.max(0, Math.ceil(endMins - nowMinutes))
          } else if (nowMinutes >= endMins) {
            status = 'completed'
            progressPercent = 100
          } else if (nowMinutes < startMins) {
            if (nowMinutes < shiftStartMinutes && index === 0) {
              status = 'up-next'
            } else if (index > 0 && nowMinutes >= Math.round(shiftStartMinutes + (index - 1) * minutesPerPerson)) {
              status = 'up-next'
            } else {
              status = 'scheduled'
            }
          }
        } else {
          status = index === 0 ? 'up-next' : 'scheduled'
        }

        return {
          ...person,
          position: index + 1,
          startMins,
          endMins,
          startTimeStr: formatTime(startMins),
          endTimeStr: formatTime(endMins),
          durationStr: formatDuration(durationMins),
          status,
          progressPercent,
          remainingMinutes
        }
      })
    : []

  // Find person currently serving
  const currentServingPerson = schedule.find(p => p.status === 'serving')
  const nextInLinePerson = schedule.find(p => p.status === 'up-next')

  // Bell Sound and Shift Turnover Notification
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [toastNotification, setToastNotification] = useState(null)
  const previousServingIdRef = useRef(null)
  const isInitialMountRef = useRef(true)

  // Monitor shift turnover and trigger bell ring
  useEffect(() => {
    if (!activeDay.isWorkDay) return

    const currentId = currentServingPerson
      ? currentServingPerson.id
      : (nowMinutes >= shiftEndMinutes ? 'SHIFT_COMPLETED' : 'BEFORE_START')

    // Do not trigger bell on initial page load
    if (isInitialMountRef.current) {
      previousServingIdRef.current = currentId
      isInitialMountRef.current = false
      return
    }

    // Trigger bell when a shift concludes
    if (previousServingIdRef.current && previousServingIdRef.current !== currentId) {
      const prevOfficer = roster.find(p => p.id === previousServingIdRef.current)

      if (previousServingIdRef.current !== 'BEFORE_START' && previousServingIdRef.current !== 'SHIFT_COMPLETED') {
        if (soundEnabled) {
          playBellRing()
        }

        const isDayDone = currentId === 'SHIFT_COMPLETED'
        const title = isDayDone ? 'Day Shift Completed' : 'Shift Over'
        const message = isDayDone
          ? `All dispatch shifts have completed for ${activeDay.name}!`
          : `${prevOfficer ? prevOfficer.name : 'Officer'}'s dispatch shift is over! Next in service: ${currentServingPerson ? currentServingPerson.name : 'Next officer'}.`

        setToastNotification({
          title,
          message,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        })

        const timer = setTimeout(() => setToastNotification(null), 8000)
        previousServingIdRef.current = currentId
        return () => clearTimeout(timer)
      }
    }

    previousServingIdRef.current = currentId
  }, [currentServingPerson, nowMinutes, shiftEndMinutes, soundEnabled, activeDay.isWorkDay, activeDay.name, roster])

  const toggleSound = () => {
    setSoundEnabled(prev => !prev)
  }

  const handleTestBell = () => {
    playBellRing()
    setToastNotification({
      title: 'Shift Over Bell Alert',
      message: currentServingPerson
        ? `Bell notification test: Signals when ${currentServingPerson.name}'s slot finishes.`
        : 'Bell notification test: Signals when dispatch shifts conclude.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    })
  }

  // =========================================================================
  // Drag and Drop Handlers
  // =========================================================================

  const handleDragStart = (e, item) => {
    setDraggedItem(item)
    e.dataTransfer.setData('text/plain', item.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOverQueueZone = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZone('queue')
  }

  const handleDragOverCard = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZone('queue')
    setDropTargetIndex(index)
  }

  const handleDragOverRosterZone = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZone('roster')
    setDropTargetIndex(null)
  }

  const handleDropOnQueue = (e) => {
    e.preventDefault()
    if (!draggedItem || !activeDay.isWorkDay) return

    const currentList = [...(dayQueues[selectedDayKey] || [])]

    if (draggedItem.source === 'roster') {
      if (!currentList.includes(draggedItem.id)) {
        if (dropTargetIndex !== null && dropTargetIndex >= 0) {
          currentList.splice(dropTargetIndex, 0, draggedItem.id)
        } else {
          currentList.push(draggedItem.id)
        }
        setDayQueues({ ...dayQueues, [selectedDayKey]: currentList })
      }
    } else if (draggedItem.source === 'queue') {
      if (dropTargetIndex !== null && dropTargetIndex !== draggedItem.index) {
        const [movedId] = currentList.splice(draggedItem.index, 1)
        currentList.splice(dropTargetIndex, 0, movedId)
        setDayQueues({ ...dayQueues, [selectedDayKey]: currentList })
      }
    }

    setDraggedItem(null)
    setDragOverZone(null)
    setDropTargetIndex(null)
  }

  const handleDropOnRoster = (e) => {
    e.preventDefault()
    if (!draggedItem) return

    if (draggedItem.source === 'queue') {
      const currentList = (dayQueues[selectedDayKey] || []).filter(id => id !== draggedItem.id)
      setDayQueues({ ...dayQueues, [selectedDayKey]: currentList })
    }

    setDraggedItem(null)
    setDragOverZone(null)
    setDropTargetIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
    setDragOverZone(null)
    setDropTargetIndex(null)
  }

  // Quick Action Buttons
  const handleAddToDay = (id) => {
    if (!activeDay.isWorkDay) return
    const currentList = [...(dayQueues[selectedDayKey] || [])]
    if (!currentList.includes(id)) {
      setDayQueues({ ...dayQueues, [selectedDayKey]: [...currentList, id] })
    }
  }

  const handleRemoveFromDay = (id) => {
    const currentList = (dayQueues[selectedDayKey] || []).filter(item => item !== id)
    setDayQueues({ ...dayQueues, [selectedDayKey]: currentList })
  }

  const handleMove = (index, direction) => {
    const targetIndex = index + direction
    const currentList = [...(dayQueues[selectedDayKey] || [])]
    if (targetIndex < 0 || targetIndex >= currentList.length) return
    const temp = currentList[index]
    currentList[index] = currentList[targetIndex]
    currentList[targetIndex] = temp
    setDayQueues({ ...dayQueues, [selectedDayKey]: currentList })
  }

  // Create new team member in roster
  const handleAddRosterPerson = (e) => {
    e.preventDefault()
    if (!newRosterName.trim()) return

    const colors = ['#2563eb', '#0284c7', '#38bdf8', '#1d4ed8', '#475569', '#0ea5e9', '#64748b']
    const newColor = colors[roster.length % colors.length]

    const newPerson = {
      id: String(Date.now()),
      name: newRosterName.trim(),
      role: 'Service Dispatcher',
      color: newColor
    }

    setRoster([...roster, newPerson])
    if (activeDay.isWorkDay) {
      const currentList = [...(dayQueues[selectedDayKey] || [])]
      setDayQueues({ ...dayQueues, [selectedDayKey]: [...currentList, newPerson.id] })
    }
    setNewRosterName('')
  }

  // Formatted date string for today
  const formattedTodayDate = currentTime.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <div className="app-container">
      {/* Shift Over Bell Toast Notification */}
      {toastNotification && (
        <div className="md-bell-toast" role="alert">
          <div className="md-bell-toast-icon">
            <Bell size={20} className="bell-ringing" />
          </div>
          <div className="md-bell-toast-content">
            <strong>
              <span>🔔 {toastNotification.title}</span>
              <span style={{ fontSize: '0.74rem', opacity: 0.75, fontFamily: 'var(--md-font-mono)' }}>
                {toastNotification.time}
              </span>
            </strong>
            <p>{toastNotification.message}</p>
          </div>
          <button
            className="md-bell-toast-close"
            onClick={() => setToastNotification(null)}
            title="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Material Top App Bar */}
      <header className="md-app-bar">
        <div className="md-app-bar-content">
          <div className="md-brand">
            <div className="md-brand-icon">
              <Radio size={20} />
            </div>
            <div className="md-brand-title">
              nblabl12 <span className="md-brand-subtitle">Dispatch HQ</span>
            </div>
          </div>

          <div className="md-app-bar-actions">
            <div className="md-clock-chip">
              <span className="md-pulse-dot" />
              <span>
                {currentTime.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
            </div>

            <button
              className={`md-sound-btn ${soundEnabled ? 'is-active' : ''}`}
              onClick={toggleSound}
              title={soundEnabled ? 'Bell sound is enabled (Click to mute)' : 'Bell sound is muted (Click to enable)'}
            >
              {soundEnabled ? <Bell size={15} color="var(--md-sys-color-primary)" /> : <BellOff size={15} />}
              <span>{soundEnabled ? 'Bell ON' : 'Muted'}</span>
            </button>

            <button
              className="md-button md-button-tonal"
              onClick={handleTestBell}
              title="Test bell ring sound for shift turnover"
            >
              <Bell size={15} />
              <span>Test Bell</span>
            </button>

            <button
              className="md-button md-button-tonal"
              onClick={toggleFullScreen}
              title="Full screen view of current day workers"
            >
              <Maximize2 size={16} />
              <span>Full Screen</span>
            </button>

            <button
              className="md-icon-button"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="md-main-content">
        {/* Prominent Current Day & Date Banner */}
        <section className="md-header-section">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
              <Calendar size={15} color="var(--md-sys-color-primary)" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--md-sys-color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Dispatch Schedule
              </span>
            </div>
            <h1 className="md-date-title">{formattedTodayDate}</h1>
          </div>

          <div className="md-shift-chip">
            <Clock size={15} color="var(--md-sys-color-primary)" />
            <span>
              {activeDay.name}:{' '}
              <strong>{activeDay.hours}</strong>{' '}
              ({activeDay.isSunday ? 'Sunday Hours' : activeDay.isWorkDay ? 'Work Day' : 'Weekend / Off'})
            </span>
          </div>
        </section>

        {/* 7-Day Material Filter Chips */}
        <section className="md-chip-group">
          {DAYS_OF_WEEK.map(day => {
            const isToday = day.key === todayDayIndex
            const isSelected = day.key === selectedDayKey
            const dayCount = (dayQueues[day.key] || []).length

            return (
              <button
                key={day.key}
                className={`md-filter-chip ${isSelected ? 'is-selected' : ''} ${!day.isWorkDay ? 'is-off' : ''}`}
                onClick={() => setSelectedDayKey(day.key)}
              >
                <div className="md-chip-name">
                  <span>{day.name}</span>
                  {isToday && <span className="md-chip-today-tag">TODAY</span>}
                </div>
                <span className="md-chip-sub">
                  {day.isWorkDay ? `${day.hours.split(' ')[0]} • ${dayCount} on duty` : 'OFF DAY'}
                </span>
              </button>
            )
          })}
        </section>

        {/* If Selected Day is Friday or Saturday (Non-Working Day) */}
        {!activeDay.isWorkDay ? (
          <section className="md-weekend-card">
            <Coffee size={44} color="var(--md-sys-color-primary)" />
            <h3>{activeDay.name} is a Non-Working Day</h3>
            <p style={{ maxWidth: '440px', lineHeight: 1.5 }}>
              Friday and Saturday are off days. Dispatch shifts run from <strong>Sunday (08:00 – 15:30)</strong> through <strong>Thursday (08:00 – 16:30)</strong>.
            </p>
            <button
              className="md-button md-button-filled"
              style={{ marginTop: '0.5rem' }}
              onClick={() => setSelectedDayKey(todayDayIndex < 5 ? todayDayIndex : 0)}
            >
              Switch to Active Work Day
            </button>
          </section>
        ) : (
          <>
            {/* Active Spotlight Card */}
            <section className="md-spotlight-card">
              <div className="md-spotlight-top">
                <span className="md-badge md-badge-primary">
                  <span className="md-pulse-dot" style={{ width: '6px', height: '6px' }} />
                  {isSelectedDayToday && currentServingPerson
                    ? 'Currently In Dispatch (Live)'
                    : `${activeDay.name} Dispatch Status`}
                </span>

                {currentServingPerson && (
                  <span className="md-shift-chip" style={{ height: '30px' }}>
                    <Clock size={14} color="var(--md-sys-color-primary)" />
                    {currentServingPerson.startTimeStr} – {currentServingPerson.endTimeStr}
                  </span>
                )}
              </div>

              <div className="md-spotlight-body">
                {currentServingPerson ? (
                  <>
                    <div className="md-officer-info">
                      <div className="md-avatar" style={{ background: currentServingPerson.color }}>
                        {currentServingPerson.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="md-officer-details">
                        <h2>{currentServingPerson.name}</h2>
                        <p>Position #{currentServingPerson.position} • {currentServingPerson.role}</p>
                      </div>
                    </div>

                    <div className="md-countdown-display">
                      <span className="md-countdown-label">Time Remaining</span>
                      <span className="md-countdown-value">
                        {currentServingPerson.remainingMinutes} min
                      </span>
                    </div>
                  </>
                ) : isSelectedDayToday && nowMinutes < shiftStartMinutes ? (
                  <div className="md-officer-info">
                    <div className="md-avatar" style={{ background: 'var(--status-queue)' }}>
                      <Clock size={24} />
                    </div>
                    <div className="md-officer-details">
                      <h2>Shift Starts at 08:00</h2>
                      <p>
                        {nextInLinePerson
                          ? `Up first today: ${nextInLinePerson.name} (${nextInLinePerson.startTimeStr} – ${nextInLinePerson.endTimeStr})`
                          : 'Drag personnel from the roster to schedule today.'}
                      </p>
                    </div>
                  </div>
                ) : isSelectedDayToday && nowMinutes >= shiftEndMinutes ? (
                  <div className="md-officer-info">
                    <div className="md-avatar" style={{ background: 'var(--status-completed)' }}>
                      <CheckCircle size={24} />
                    </div>
                    <div className="md-officer-details">
                      <h2>Day Work Shift Completed</h2>
                      <p>All service slots for today have finished.</p>
                    </div>
                  </div>
                ) : (
                  <div className="md-officer-info">
                    <div className="md-avatar" style={{ background: 'var(--md-sys-color-primary)' }}>
                      <Calendar size={24} />
                    </div>
                    <div className="md-officer-details">
                      <h2>{activeDay.name} Schedule View</h2>
                      <p>
                        {count > 0
                          ? `${count} people scheduled • ${formatDuration(minutesPerPerson)} each • First up: ${queuedPersonnel[0]?.name}`
                          : 'No people scheduled for this day yet. Drag from roster to assign.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Slot Progress Bar */}
              {currentServingPerson && (
                <div className="md-linear-progress">
                  <div className="md-linear-track">
                    <div
                      className="md-linear-bar"
                      style={{ width: `${currentServingPerson.progressPercent}%` }}
                    />
                  </div>
                  <div className="md-progress-meta">
                    <span>Slot Start: {currentServingPerson.startTimeStr}</span>
                    <span>{Math.round(currentServingPerson.progressPercent)}% elapsed</span>
                    <span>Slot End: {currentServingPerson.endTimeStr}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Visual Timeline Bar */}
            {count > 0 && (
              <section className="md-timeline-card">
                <div className="md-timeline-header">
                  <span className="md-timeline-title">
                    <Clock size={14} color="var(--md-sys-color-primary)" /> {activeDay.name} Timeline ({formatTime(shiftStartMinutes)} – {formatTime(shiftEndMinutes)})
                  </span>
                  <span className="md-timeline-sub">
                    {formatDuration(minutesPerPerson)} / person ({count} equal slots)
                  </span>
                </div>

                <div className="md-timeline-track">
                  {schedule.map(person => (
                    <div
                      key={person.id}
                      className={`md-timeline-segment ${person.status === 'serving' ? 'is-active' : ''}`}
                      style={{
                        flex: 1,
                        background: person.color,
                        opacity: person.status === 'completed' ? 0.35 : person.status === 'serving' ? 1 : 0.85
                      }}
                      title={`${person.name}: ${person.startTimeStr} – ${person.endTimeStr}`}
                    >
                      #{person.position} {person.name.split(' ')[0]} ({person.startTimeStr})
                    </div>
                  ))}
                </div>

                <div className="md-timeline-legend">
                  <span>{formatTime(shiftStartMinutes)}</span>
                  {isSelectedDayToday ? (
                    <span style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600 }}>
                      ▲ Current Time ({currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  ) : (
                    <span>{activeDay.name} Shift</span>
                  )}
                  <span>{formatTime(shiftEndMinutes)}</span>
                </div>
              </section>
            )}

            {/* Drag and Drop Workspace: Selected Day's Queue vs Team Roster */}
            <div className="md-workspace-grid">
              {/* Main Drop Zone: Day's Active Dispatch Queue */}
              <section
                className={`md-card ${dragOverZone === 'queue' ? 'drag-over-active' : ''}`}
                onDragOver={handleDragOverQueueZone}
                onDrop={handleDropOnQueue}
              >
                <div className="md-section-header">
                  <div className="md-section-title">
                    <Radio size={18} color="var(--md-sys-color-primary)" />
                    <span>{activeDay.name}'s Dispatch Queue</span>
                  </div>
                  <span className="md-pill-duration">
                    {count > 0 ? `${formatDuration(minutesPerPerson)} per person` : 'Queue Empty'}
                  </span>
                </div>

                <div className="md-drag-hint">
                  <Sparkles size={14} color="var(--md-sys-color-primary)" />
                  <span>Drag cards here from the Team Roster or drag to reorder positions</span>
                </div>

                {schedule.length === 0 ? (
                  <div className="md-empty-dropzone">
                    <Users size={32} />
                    <strong>Drop Team Members Here</strong>
                    <p>Drag people from the available roster to add them to {activeDay.name}'s schedule.</p>
                  </div>
                ) : (
                  <div className="md-list-stack">
                    {schedule.map((person, index) => (
                      <div
                        key={person.id}
                        draggable
                        onDragStart={e => handleDragStart(e, { id: person.id, source: 'queue', index })}
                        onDragOver={e => handleDragOverCard(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`md-queue-row ${
                          person.status === 'serving' ? 'is-active' : ''
                        } ${draggedItem?.id === person.id ? 'is-dragging' : ''} ${
                          dropTargetIndex === index && draggedItem?.id !== person.id
                            ? 'drop-target-above'
                            : ''
                        }`}
                      >
                        <div className="md-row-left">
                          <span className="md-grip-icon" title="Drag to reorder">
                            <GripVertical size={16} />
                          </span>
                          <div className="md-pos-label">#{person.position}</div>
                          <div className="md-person-meta">
                            <div className="md-name-text">
                              {person.name}
                              {person.status === 'serving' && (
                                <span className="md-status-pill md-status-serving">
                                  <span className="md-pulse-dot" style={{ width: '6px', height: '6px' }} />
                                  Serving Now
                                </span>
                              )}
                            </div>
                            <span className="md-person-role">{person.role}</span>
                          </div>
                        </div>

                        <div className="md-row-center">
                          <div className="md-time-tag">
                            <Clock size={13} color="var(--md-sys-color-on-surface-variant)" />
                            {person.startTimeStr} – {person.endTimeStr}
                          </div>

                          <span className="md-duration-tag">{person.durationStr}</span>

                          {person.status === 'completed' && (
                            <span className="md-status-pill md-status-finished">
                              <CheckCircle size={11} /> Finished
                            </span>
                          )}
                          {person.status === 'up-next' && (
                            <span className="md-status-pill md-status-upnext">
                              <Play size={10} /> Up Next
                            </span>
                          )}
                          {person.status === 'scheduled' && (
                            <span className="md-status-pill md-status-scheduled">Scheduled</span>
                          )}
                        </div>

                        <div className="md-row-actions">
                          <button
                            className="md-btn-action"
                            disabled={index === 0}
                            onClick={() => handleMove(index, -1)}
                            title="Move Up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            className="md-btn-action"
                            disabled={index === schedule.length - 1}
                            onClick={() => handleMove(index, 1)}
                            title="Move Down"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            className="md-btn-action btn-del"
                            onClick={() => handleRemoveFromDay(person.id)}
                            title="Remove from Today (return to roster)"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Roster Pool: Available Team Members */}
              <section
                className={`md-card ${dragOverZone === 'roster' ? 'drag-over-active' : ''}`}
                onDragOver={handleDragOverRosterZone}
                onDrop={handleDropOnRoster}
              >
                <div className="md-section-header">
                  <div className="md-section-title">
                    <Users size={18} color="var(--md-sys-color-primary)" />
                    <span>Available Team Roster</span>
                  </div>
                  <span className="md-pill-duration">
                    {availableRosterPersonnel.length} Available
                  </span>
                </div>

                <div className="md-drag-hint">
                  <span>Drag into {activeDay.name}'s queue or click "+ Add"</span>
                </div>

                <div className="md-list-stack">
                  {availableRosterPersonnel.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--md-sys-color-on-surface-variant)', fontSize: '0.85rem' }}>
                      All team members are scheduled for {activeDay.name}!
                    </div>
                  ) : (
                    availableRosterPersonnel.map(person => (
                      <div
                        key={person.id}
                        draggable
                        onDragStart={e => handleDragStart(e, { id: person.id, source: 'roster' })}
                        onDragEnd={handleDragEnd}
                        className={`md-roster-row ${
                          draggedItem?.id === person.id ? 'is-dragging' : ''
                        }`}
                      >
                        <div className="md-roster-meta">
                          <span className="md-grip-icon" title="Drag into queue">
                            <GripVertical size={14} />
                          </span>
                          <div className="md-roster-avatar" style={{ background: person.color }}>
                            {person.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div className="md-roster-text">
                            <span className="md-roster-name">{person.name}</span>
                            <span className="md-roster-role">{person.role}</span>
                          </div>
                        </div>

                        <button
                          className="md-btn-add-sm"
                          onClick={() => handleAddToDay(person.id)}
                          title={`Add ${person.name} to ${activeDay.name}`}
                        >
                          <Plus size={13} /> Add
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Quick Add New Person to Roster */}
                <form className="md-register-box" onSubmit={handleAddRosterPerson}>
                  <input
                    type="text"
                    className="md-input"
                    placeholder="Register new person (e.g. Leo Clark)..."
                    value={newRosterName}
                    onChange={e => setNewRosterName(e.target.value)}
                  />
                  <button type="submit" className="md-button md-button-filled" style={{ height: '36px', padding: '0 0.85rem' }}>
                    <UserPlus size={14} /> Add
                  </button>
                </form>
              </section>
            </div>
          </>
        )}
      </main>

      {/* Minimal Full Screen Mode: Workers, Date, Time, Start/End Times, Time Left */}
      {isFullScreen && (
        <div className="md-fullscreen-overlay">
          {/* Minimal Header */}
          <div className="md-fs-header">
            <div className="md-fs-date-block">
              <div className="md-fs-date">{formattedTodayDate}</div>
              <div className="md-fs-shift">
                <Clock size={16} />
                <span>
                  {activeDay.name} Shift: {activeDay.hours} ({count} Officers)
                </span>
              </div>
            </div>

            <div className="md-fs-clock-block">
              <div className="md-fs-time">
                <span className="md-pulse-dot" style={{ width: '10px', height: '10px' }} />
                <span>
                  {currentTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
              </div>

              <button
                className={`md-sound-btn ${soundEnabled ? 'is-active' : ''}`}
                onClick={toggleSound}
                title={soundEnabled ? 'Bell sound is enabled' : 'Bell sound is muted'}
              >
                {soundEnabled ? <Bell size={15} color="var(--md-sys-color-primary)" /> : <BellOff size={15} />}
                <span>{soundEnabled ? 'Bell ON' : 'Muted'}</span>
              </button>

              <button className="md-button md-button-tonal" onClick={handleTestBell} title="Test Bell Sound">
                <Bell size={15} />
                <span>Test Bell</span>
              </button>

              <button className="md-button md-button-tonal" onClick={toggleFullScreen}>
                <Minimize2 size={16} />
                <span>Exit</span>
              </button>
            </div>
          </div>

          {/* Minimal Workers List */}
          <div className="md-fs-list">
            {schedule.map(person => {
              const isServing = person.status === 'serving'
              const isCompleted = person.status === 'completed'
              const minsUntilStart = Math.max(0, Math.ceil(person.startMins - nowMinutes))

              return (
                <div
                  key={person.id}
                  className={`md-fs-row ${isServing ? 'is-active' : ''}`}
                >
                  {/* Left: Position & Name */}
                  <div className="md-fs-left">
                    <div className="md-fs-pos">#{person.position}</div>
                    <div className="md-fs-name">{person.name}</div>
                  </div>

                  {/* Center: Start & End Time */}
                  <div className="md-fs-center">
                    <div>
                      <span style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--md-sys-color-on-surface-variant)', fontWeight: 500 }}>Shift Window</span>
                      <span>
                        {person.startTimeStr} – {person.endTimeStr}
                      </span>
                    </div>
                  </div>

                  {/* Right: How Long Left */}
                  <div className="md-fs-right">
                    {isServing ? (
                      <div className="md-fs-time-left md-time-left-active">
                        <span className="md-pulse-dot" style={{ width: '7px', height: '7px' }} />
                        <span>{person.remainingMinutes} min left</span>
                      </div>
                    ) : isCompleted ? (
                      <div className="md-fs-time-left md-time-left-done">
                        <CheckCircle size={16} />
                        <span>Finished</span>
                      </div>
                    ) : (
                      <div className="md-fs-time-left md-time-left-upcoming">
                        <Clock size={16} />
                        <span>
                          {minsUntilStart < 60
                            ? `Starts in ${minsUntilStart}m`
                            : `Starts in ${formatDuration(minsUntilStart)}`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Progress Line for Serving Officer */}
                  {isServing && (
                    <div
                      className="md-fs-row-progress"
                      style={{ width: `${person.progressPercent}%` }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
