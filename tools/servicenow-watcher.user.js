// ==UserScript==
// @name         NBLAB · ServiceNow unassigned-task watcher
// @namespace    nblab
// @version      1.3.0
// @description  Chime and desktop notification when a new unassigned task reaches your group. Uses your own ServiceNow login; nothing leaves this browser.
// @homepageURL  https://dolev6780.github.io/dispatch-queue/
// @downloadURL  https://dolev6780.github.io/dispatch-queue/servicenow-watcher.user.js
// @updateURL    https://dolev6780.github.io/dispatch-queue/servicenow-watcher.user.js
// @match        https://*.service-now.com/*
// @match        https://dolev6780.github.io/dispatch-queue/*
// @match        http://localhost:*/*
// @noframes
// @run-at       document-idle
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==

/* global GM_notification, GM_setValue, GM_getValue, GM_addValueChangeListener, unsafeWindow */

/*
 * How it works
 * ------------
 * While a ServiceNow tab is open, this asks ServiceNow once a minute for the
 * ACTIVE tasks of your assignment group(s) that nobody is assigned to, using
 * the login already open in this browser. A task it has not seen before gets
 * a desktop notification with its number, short description and a few
 * details, plus a chime. Clicking the notification opens the task.
 *
 * Nothing is sent anywhere else and nothing is written to ServiceNow. The
 * only thing kept is, in this browser, the list of task ids already seen —
 * so a page reload does not announce the same tasks again — and your
 * settings.
 *
 * With several ServiceNow tabs open, only one of them watches.
 *
 * The badge's Test button checks ServiceNow right away and shows a real
 * notification for the newest waiting task (or says nothing is waiting), so
 * the whole chain — access, notifications, sound — can be checked on the spot.
 *
 * On the NBLAB website
 * --------------------
 * The same script also runs on the NBLAB site, where it does one thing: it
 * hands the latest unassigned tasks (number, short description, priority,
 * time) to the page, which shows them on the Queue page and the wall display.
 * The hand-over goes through Tampermonkey's own storage on this PC — never
 * through Firebase or any server — so it only works in this browser, and only
 * while a ServiceNow tab here is open and watching. On any other page on
 * localhost it does nothing.
 */

const DEFAULTS = {
  // 'sc_task' for catalog tasks, 'incident' for incidents.
  table: 'sc_task',
  // Your assignment group(s), exactly as named in ServiceNow. Set these from
  // the watcher badge (bottom-left of the ServiceNow page) — no need to edit.
  groups: [],
  // How often to check, in seconds.
  everySeconds: 60,
  // Extra fields shown in each notification. Dot-walked fields work,
  // e.g. 'request_item.cat_item' or 'caller_id'.
  details: ['priority', 'assignment_group'],
  chime: true
}

const MIN_SECONDS = 30
const MAX_SINGLE_NOTIFICATIONS = 4
const SNAPSHOT_KEY = 'nblab.sn.snapshot.v1'
const SNAPSHOT_TASKS = 20
const BRIDGE_SOURCE = 'nblab-servicenow-watcher'

// ---- Pure helpers (tested in tools/servicenow-watcher.test.mjs) -------------

/** The encoded query for active, unassigned tasks of these groups. */
const unassignedQuery = (groups) =>
  ['active=true', 'assigned_toISEMPTY', `assignment_group.nameIN${groups.join(',')}`].join('^')

/** Table API request for those tasks, newest first, display values only. */
const tableUrl = (table, groups, details) => {
  const fields = ['sys_id', 'number', 'short_description', 'sys_created_on', ...details]
  const params = new URLSearchParams({
    sysparm_query: `${unassignedQuery(groups)}^ORDERBYDESCsys_created_on`,
    sysparm_fields: [...new Set(fields)].join(','),
    sysparm_display_value: 'true',
    sysparm_exclude_reference_link: 'true',
    sysparm_limit: '100'
  })
  return `/api/now/table/${encodeURIComponent(table)}?${params}`
}

const recordUrl = (table, sysId) => `/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${sysId}`)}`
const listUrl = (table, groups) => `/nav_to.do?uri=${encodeURIComponent(`${table}_list.do?sysparm_query=${unassignedQuery(groups)}`)}`

/**
 * Which tasks are new? `known` is the ids seen last time, or null on the very
 * first check — which only takes note of what is already waiting, so turning
 * the watcher on does not announce the whole backlog. Tasks that were
 * assigned or closed drop out of `known`.
 */
const findNew = (known, tasks) => {
  const ids = tasks.map(task => task.sys_id)
  if (known === null) return { fresh: [], known: ids }
  const seen = new Set(known)
  return { fresh: tasks.filter(task => !seen.has(task.sys_id)), known: ids }
}

/** Title and text for one task's notification. */
const describe = (task, details) => {
  const extra = details.map(field => task[field]).filter(value => value && String(value).trim()).join(' · ')
  return {
    title: `New unassigned task · ${task.number || 'task'}`,
    text: [task.short_description || '(no short description)', extra].filter(Boolean).join('\n')
  }
}

/** One notification for a burst, so a mass import does not flood the screen. */
const summarize = (tasks) => ({
  title: `${tasks.length} new unassigned tasks`,
  text: tasks.slice(0, 3).map(task => `${task.number}: ${task.short_description || ''}`.trim()).join('\n') +
    (tasks.length > 3 ? `\n…and ${tasks.length - 3} more` : '')
})

/** The Test button's notification: the newest waiting task, or an all-clear. */
const testMessage = (tasks, groups, details) => {
  const newest = tasks[0]
  if (!newest) {
    return { title: 'Watcher test · working', text: `Nothing unassigned in ${groups.join(', ')} right now.`, taskId: null }
  }
  const { title, text } = describe(newest, details)
  return { title: `Test · ${title.replace('New unassigned task · ', '')} (newest waiting)`, text, taskId: newest.sys_id }
}

/**
 * What the NBLAB page is given after a successful check: the few fields it
 * shows, links back to ServiceNow, and when it was checked.
 */
const snapshotOf = ({ tasks, table, groups, origin, now }) => ({
  version: 1,
  groups,
  count: tasks.length,
  tasks: tasks.slice(0, SNAPSHOT_TASKS).map(task => ({
    id: task.sys_id,
    number: task.number || '',
    title: task.short_description || '',
    priority: task.priority || '',
    opened: task.sys_created_on || '',
    url: origin + recordUrl(table, task.sys_id)
  })),
  listUrl: origin + listUrl(table, groups),
  checkedAt: now,
  okAt: now,
  error: null
})

/** After a failed check: keep the last good list, say what went wrong. */
const failedSnapshot = (previous, { groups, error, now }) => ({
  version: 1,
  groups,
  count: previous?.count || 0,
  tasks: previous?.tasks || [],
  listUrl: previous?.listUrl || null,
  checkedAt: now,
  okAt: previous?.okAt || 0,
  error
})

/** Parse the groups typed into the settings prompt. */
const parseGroups = (text) =>
  String(text || '').split(/[,;\n]/).map(name => name.trim()).filter(Boolean)

// ---- Browser side -----------------------------------------------------------

const main = () => {
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  const SETTINGS_KEY = 'nblab.snWatcher.settings.v1'

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  }
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
  }

  let settings = { ...DEFAULTS, ...read(SETTINGS_KEY, {}) }
  const knownKey = () => `nblab.snWatcher.known.v1.${settings.table}.${settings.groups.join('|')}`

  // For the NBLAB page on this PC (see "On the NBLAB website" above).
  const canPublish = typeof GM_setValue === 'function' && typeof GM_getValue === 'function'
  const publish = (tasks) => {
    if (!canPublish) return
    GM_setValue(SNAPSHOT_KEY, snapshotOf({
      tasks, table: settings.table, groups: settings.groups, origin: page.location.origin, now: Date.now()
    }))
  }
  const publishFailure = (error) => {
    if (!canPublish) return
    GM_setValue(SNAPSHOT_KEY, failedSnapshot(GM_getValue(SNAPSHOT_KEY, null), { groups: settings.groups, error, now: Date.now() }))
  }

  // ---- Badge -----------------------------------------------------------------
  const badge = document.createElement('div')
  badge.setAttribute('role', 'status')
  Object.assign(badge.style, {
    position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647',
    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 6px 6px 12px',
    borderRadius: '999px', background: '#18191c', color: '#f4f2ed',
    font: '600 12px/1.2 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)',
    cursor: 'pointer', userSelect: 'none'
  })
  const dot = document.createElement('span')
  Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', background: '#75756f', flexShrink: '0' })
  const label = document.createElement('span')
  const gear = document.createElement('button')
  gear.textContent = '⚙'
  gear.title = 'Watcher settings'
  Object.assign(gear.style, {
    border: 'none', background: '#2e2f34', color: '#f4f2ed', borderRadius: '50%',
    width: '22px', height: '22px', cursor: 'pointer', font: '13px/1 system-ui'
  })
  const testButton = document.createElement('button')
  testButton.textContent = 'Test'
  testButton.title = 'Check ServiceNow now and show a notification'
  Object.assign(testButton.style, {
    border: 'none', background: '#f76b15', color: '#fff', borderRadius: '999px',
    height: '22px', padding: '0 9px', cursor: 'pointer', font: '600 11px/1 system-ui'
  })
  badge.append(dot, label, testButton, gear)
  document.body.appendChild(badge)

  const show = (text, color, title) => {
    label.textContent = text
    dot.style.background = color
    badge.title = title || text
  }

  // ---- Sound: browsers only allow it after a click on the page ---------------
  let audio = null
  const armAudio = () => {
    try {
      const Ctx = page.AudioContext || page.webkitAudioContext
      if (!audio && Ctx) audio = new Ctx()
      if (audio && audio.state === 'suspended') audio.resume()
    } catch { /* no audio */ }
  }
  document.addEventListener('pointerdown', armAudio, { once: true, capture: true })

  const chime = () => {
    if (!settings.chime || !audio || audio.state !== 'running') return
    const now = audio.currentTime
    ;[[698.46, 0], [523.25, 0.28]].forEach(([freq, delay]) => {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.3, now + delay + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.2)
      osc.connect(gain).connect(audio.destination)
      osc.start(now + delay)
      osc.stop(now + delay + 1.3)
    })
  }

  // ---- Notifications ------------------------------------------------------------
  const notify = ({ title, text }, openUrl) => {
    const open = () => { page.focus(); page.open(openUrl, '_blank') }
    if (typeof GM_notification === 'function') {
      GM_notification({ title, text, timeout: 0, onclick: open })
      return
    }
    if ('Notification' in page && page.Notification.permission === 'granted') {
      const n = new page.Notification(title, { body: text, requireInteraction: true })
      n.onclick = () => { open(); n.close() }
    }
  }

  // ---- Settings -------------------------------------------------------------------
  const configure = () => {
    const groups = parseGroups(page.prompt(
      'Assignment group(s) to watch, exactly as named in ServiceNow.\nSeparate several with commas.',
      settings.groups.join(', ')
    ) ?? settings.groups.join(','))
    const table = (page.prompt(
      "What to watch: 'sc_task' for catalog tasks, or 'incident' for incidents.",
      settings.table
    ) || settings.table).trim()
    settings = { ...settings, groups, table }
    write(SETTINGS_KEY, { groups, table })
    if ('Notification' in page && page.Notification.permission === 'default' && typeof GM_notification !== 'function') {
      page.Notification.requestPermission()
    }
    check()
  }
  gear.addEventListener('click', (event) => { event.stopPropagation(); armAudio(); configure() })
  badge.addEventListener('click', () => {
    armAudio()
    if (settings.groups.length) page.open(listUrl(settings.table, settings.groups), '_blank')
    else configure()
  })

  // ---- Checking ---------------------------------------------------------------------
  // ServiceNow wants the page's session token on API calls made from a page.
  const token = () => page.g_ck || document.querySelector('#gsft_main')?.contentWindow?.g_ck || null

  const fetchTasks = async () => {
    const headers = { Accept: 'application/json' }
    const userToken = token()
    if (userToken) headers['X-UserToken'] = userToken
    const response = await fetch(tableUrl(settings.table, settings.groups, settings.details),
      { headers, credentials: 'same-origin' })
    if (!response.ok) {
      const error = new Error(`ServiceNow answered ${response.status}`)
      error.status = response.status
      throw error
    }
    return (await response.json()).result || []
  }

  const showFailure = (err) => {
    if (err?.status === 401 || err?.status === 403) {
      show('Watcher: not allowed — reload ServiceNow', '#f87171',
        `ServiceNow answered ${err.status}. Reload the page if you were signed out; if it persists, your account may not be allowed to use the API.`)
      publishFailure('ServiceNow refused the watcher — reload ServiceNow')
    } else {
      show('Watcher: cannot reach ServiceNow', '#f87171', String(err?.message || err))
      publishFailure('The watcher cannot reach ServiceNow')
    }
  }

  const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

  let timer = null
  let failures = 0
  const schedule = () => {
    clearTimeout(timer)
    const seconds = Math.max(MIN_SECONDS, Number(settings.everySeconds) || DEFAULTS.everySeconds)
    timer = setTimeout(check, seconds * 1000 * Math.min(5, 1 + failures))
  }

  async function check() {
    if (!settings.groups.length) {
      show('Watcher: click to choose your group', '#fbbf24')
      publishFailure('Choose your group on the watcher badge in ServiceNow')
      return
    }
    try {
      const tasks = await fetchTasks()
      publish(tasks)
      const stored = read(knownKey(), null)
      const { fresh, known } = findNew(stored, tasks)
      write(knownKey(), known)

      if (fresh.length > MAX_SINGLE_NOTIFICATIONS) {
        notify(summarize(fresh), listUrl(settings.table, settings.groups))
      } else {
        fresh.forEach(task => notify(describe(task, settings.details), recordUrl(settings.table, task.sys_id)))
      }
      if (fresh.length) chime()

      failures = 0
      show(`${tasks.length} unassigned · ${clock()}`, tasks.length ? '#f76b15' : '#4ade80',
        `Watching ${settings.groups.join(', ')} (${settings.table}). Click to open the list; Test to check now; ⚙ for settings.`)
    } catch (err) {
      failures++
      showFailure(err)
    }
    schedule()
  }

  // ---- Test: the whole chain, on demand ------------------------------------------------
  // Works on any ServiceNow tab, watching or not, and changes nothing: the
  // tasks already announced stay announced.
  const runTest = async () => {
    armAudio()
    if (!settings.groups.length) { configure(); return }
    if (typeof GM_notification !== 'function' && 'Notification' in page && page.Notification.permission === 'default') {
      await page.Notification.requestPermission()
    }
    show('Testing…', '#75756f')
    try {
      const tasks = await fetchTasks()
      publish(tasks)
      const message = testMessage(tasks, settings.groups, settings.details)
      notify(message, message.taskId ? recordUrl(settings.table, message.taskId) : listUrl(settings.table, settings.groups))
      chime()
      const blocked = typeof GM_notification !== 'function' && (!('Notification' in page) || page.Notification.permission !== 'granted')
      if (blocked) {
        show('Test: ServiceNow OK, but notifications are blocked', '#fbbf24',
          'Allow notifications for this site in the browser, and for the browser in Windows Settings → Notifications.')
      } else {
        show(`Test OK · ${tasks.length} unassigned · ${clock()}`, '#4ade80',
          'ServiceNow answered and a notification was sent. No popup? Check Windows Settings → Notifications and Do not disturb.')
      }
    } catch (err) {
      showFailure(err)
    }
  }
  testButton.addEventListener('click', (event) => { event.stopPropagation(); runTest() })

  // Only one tab watches: the lock is held until that tab closes, then the
  // next ServiceNow tab takes over.
  if (navigator.locks?.request) {
    show('Watcher: standby (another tab is watching)', '#75756f')
    navigator.locks.request('nblab-servicenow-watcher', () => {
      check()
      return new Promise(() => {})
    })
  } else {
    check()
  }
}

// ---- On the NBLAB website: hand the tasks to the page ---------------------------

const bridge = () => {
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
  const origin = page.location.origin
  const post = (snapshot) => {
    if (snapshot) page.postMessage({ source: BRIDGE_SOURCE, snapshot }, origin)
  }
  post(GM_getValue(SNAPSHOT_KEY, null))
  // Every check in the ServiceNow tab rewrites the snapshot, so this fires
  // about once a minute — which is also how the page knows the watcher is
  // still running.
  GM_addValueChangeListener(SNAPSHOT_KEY, (_name, _old, value) => post(value))
  // The page asks when it starts, in case it started after this script.
  page.addEventListener('message', (event) => {
    if (event.origin === origin && event.data?.source === 'nblab-app' && event.data.type === 'servicenow:hello') {
      post(GM_getValue(SNAPSHOT_KEY, null))
    }
  })
}

// The NBLAB app marks its page with <meta name="nblab-app">. Every other page
// this script is allowed on is ServiceNow — except stray localhost pages and
// the NBLAB site's other files, where it stays out of the way.
const isNblabSite = () => !!document.querySelector('meta[name="nblab-app"]')
const isNotServiceNow = () => /^(localhost|127\.0\.0\.1|dolev6780\.github\.io)$/.test(location.hostname)

if (typeof window === 'undefined') {
  // Loaded by the tests, not a browser.
  globalThis.nblabWatcher = {
    unassignedQuery, tableUrl, recordUrl, listUrl, findNew, describe, summarize, parseGroups, testMessage,
    snapshotOf, failedSnapshot
  }
} else if (isNblabSite()) {
  if (typeof GM_getValue === 'function') bridge()
} else if (!isNotServiceNow()) {
  main()
}
