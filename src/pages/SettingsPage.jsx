import { Bell, BellOff, BellRing, Download, Monitor, Moon, Network, Printer, Sparkles, Sun, Volume2 } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { formatClockHM } from '../services/format'
import { bridgeStatus } from '../services/servicenow'

// Published next to the app by vite.config.js. Opening a .user.js address is
// what makes Tampermonkey offer to install it.
const WATCHER_URL = `${import.meta.env.BASE_URL}servicenow-watcher.user.js`
const RELAY_URL = `${import.meta.env.BASE_URL}servicenow-relay.mjs`
const AGENT_URL = `${import.meta.env.BASE_URL}nblab-automation.cmd`

/** Where the ServiceNow watcher stands for THIS browser, in words. */
const watcherLine = (bridge, now) => {
  const state = bridgeStatus(bridge, now.getTime())
  const version = bridge?.version ? ` (version ${bridge.version})` : ''
  const snapshot = bridge?.snapshot
  if (bridge?.via === 'relay' && state !== 'missing') {
    switch (state) {
      case 'denied':
        return { tone: 'bad', text: 'Opened from the main PC, but it did not accept your sign-in. Sign out and in again.' }
      case 'waiting':
        return { tone: 'wait', text: 'Opened from the main PC. Waiting for its ServiceNow tab: on the main PC, open ServiceNow and press Test on the watcher badge.' }
      case 'stale':
        return { tone: 'wait', text: `Opened from the main PC, but its ServiceNow tab has not reported since ${formatClockHM(snapshot.checkedAt)}.` }
      case 'error':
        return { tone: 'bad', text: `Opened from the main PC. ${snapshot.error}.` }
      default:
        return { tone: 'ok', text: `Shared from the main PC: ${snapshot.count} unassigned in ${snapshot.groups.join(', ')}, checked ${formatClockHM(snapshot.checkedAt)}. They show on the Queue page and the wall display.` }
    }
  }
  switch (state) {
    case 'missing':
      return { tone: 'off', text: 'Not running in this browser. Install or update it, and let Tampermonkey run on this site (Site access: On all sites).' }
    case 'waiting':
      return { tone: 'wait', text: `Installed here${version}, waiting for ServiceNow: open it in this browser, reload it if it was already open, and press Test on its badge.` }
    case 'stale':
      return { tone: 'wait', text: `Installed here${version}, but ServiceNow has not reported since ${formatClockHM(snapshot.checkedAt)}. Is the ServiceNow tab still open?` }
    case 'error':
      return { tone: 'bad', text: `Installed here${version}. ${snapshot.error}.` }
    default:
      return { tone: 'ok', text: `Connected${version}: ${snapshot.count} unassigned in ${snapshot.groups.join(', ')}, checked ${formatClockHM(snapshot.checkedAt)}. They show on the Queue page and the wall display.` }
  }
}

/** Desktop alerts for new jobs, in words. */
const alertsLine = (permission) => {
  switch (permission) {
    case 'granted':
      return { tone: 'ok', text: 'On. A new job for you pops up on this computer, even with the app minimised.' }
    case 'denied':
      return { tone: 'bad', text: 'Blocked in this browser. Allow notifications for this site in the browser\'s site settings, then reload.' }
    case 'default':
      return { tone: 'wait', text: 'Off. Press Enable and allow notifications when the browser asks.' }
    default:
      return {
        tone: 'off',
        text: typeof window !== 'undefined' && window.isSecureContext === false
          ? 'Not available on this address: browsers allow them only on https. Chimes and in-app alerts still work.'
          : 'This browser does not support them. Chimes and in-app alerts still work.'
      }
  }
}

const Status = ({ line }) => (
  <span className={`tool-status is-${line.tone}`} role="status"><span className="tool-status-dot" />{line.text}</span>
)

/**
 * Settings: how this device behaves, and the setup of the lab-PC tools —
 * the ServiceNow watcher, the relay that shares it with every PC, and the AI
 * assistant. Each tool shows where it stands for this browser.
 */
export const SettingsPage = ({
  currentTime,
  theme,
  onThemeChange,
  soundEnabled,
  onToggleSound,
  onTestChime,
  notificationState,
  onEnableNotifications,
  serviceNow,
  relayInfo
}) => {
  const watcher = watcherLine(serviceNow, currentTime)
  const alerts = alertsLine(notificationState)
  const ai = relayInfo?.ai
    ? { tone: 'ok', text: `On: Gemini (${relayInfo.model}) through the main PC.` }
    : relayInfo?.isRelay
      ? { tone: 'wait', text: 'The main PC is reachable, but its relay has no Gemini key yet.' }
      : { tone: 'off', text: 'Only on pages opened from the main PC\'s relay address.' }

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>Settings</Eyebrow>
          <h1 className="display">Settings</h1>
          <p className="page-meta">This device, and the tools that run on the lab PCs</p>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="device-title">
        <h2 id="device-title" className="eyebrow">This device</h2>
        <div className="card settings-list">
          <div className="setting-row">
            <span className="module-icon"><Monitor size={20} /></span>
            <div className="setting-text">
              <span className="setting-name">Theme</span>
              <span className="setting-desc">Remembered on this device. The wall display is always dark.</span>
            </div>
            <div className="segmented setting-control" role="radiogroup" aria-label="Theme">
              <button type="button" role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'is-active' : ''}
                onClick={() => onThemeChange('light')}>
                <Sun size={15} /> Light
              </button>
              <button type="button" role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'is-active' : ''}
                onClick={() => onThemeChange('dark')}>
                <Moon size={15} /> Dark
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="module-icon">{soundEnabled ? <Bell size={20} /> : <BellOff size={20} />}</span>
            <div className="setting-text">
              <span className="setting-name">Chimes</span>
              <span className="setting-desc">A chime when the shift changes and when a job comes in. Remembered on this device.</span>
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-sm btn-outline" onClick={onTestChime}>
                <Volume2 size={14} /><span>Test</span>
              </button>
              <button type="button" className={`switch ${soundEnabled ? 'is-on' : ''}`} role="switch" aria-checked={soundEnabled}
                aria-label="Chimes" onClick={onToggleSound}>
                <span className="switch-knob" />
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="module-icon"><BellRing size={20} /></span>
            <div className="setting-text">
              <span className="setting-name">Desktop alerts for new jobs</span>
              <span className="setting-desc">A system notification when a job is assigned to you. Each browser asks once.</span>
              <Status line={alerts} />
            </div>
            {notificationState === 'default' && (
              <div className="setting-control">
                <button type="button" className="btn btn-sm btn-dark" onClick={onEnableNotifications}>Enable</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section tools" aria-labelledby="tools-title">
        <h2 id="tools-title" className="eyebrow">Lab PC tools</h2>

        <div className="tool-card">
          <span className="module-icon"><BellRing size={20} /></span>
          <div className="tool-text">
            <span className="module-name">ServiceNow watcher</span>
            <span className="module-desc">
              A chime and a desktop notification on this PC when a new unassigned task reaches your group, and the
              waiting tasks on this PC&apos;s Queue page and wall display. It uses your own ServiceNow login and only
              reads; the tasks stay in this browser and never go into the app&apos;s database.
            </span>
            <ol className="tool-steps">
              <li>Add the <strong>Tampermonkey</strong> extension to Edge or Chrome, turn on <em>Allow user scripts</em>, and set its <em>Site access</em> to <em>On all sites</em>.</li>
              <li>Press <strong>Install</strong> here, then <strong>Install</strong> again in Tampermonkey.</li>
              <li>Open ServiceNow, click the badge at the bottom-left, enter your group, and press <strong>Test</strong>. Keep that ServiceNow tab open.</li>
            </ol>
            <Status line={watcher} />
            <span className="tool-note">Updates install by themselves. Without Tampermonkey, Install just shows the script.</span>
          </div>
          <a className="btn btn-dark tool-install" href={WATCHER_URL} target="_blank" rel="noopener noreferrer">
            <Download size={16} /><span>Install</span>
          </a>
        </div>

        <div className="tool-card">
          <span className="module-icon"><Network size={20} /></span>
          <div className="tool-text">
            <span className="module-name">Show ServiceNow on every lab PC</span>
            <span className="module-desc">
              A small server on the main PC (the one running the watcher) shares its unassigned list with the
              other lab PCs. It keeps the list in memory only — nothing on disk, nothing in Firebase — and shows
              it only to people signed in to NBLAB.
            </span>
            <ol className="tool-steps">
              <li>On the main PC, install <strong>Node.js</strong> (the LTS version from nodejs.org) if it is not there yet.</li>
              <li>Press <strong>Download relay</strong>, open a terminal in the download folder, and run <code>node servicenow-relay.mjs</code>. Leave that window open.</li>
              <li>On every other lab PC, open the address it prints — like <code>http://MAIN-PC:8787</code> — instead of this website, and sign in as usual.</li>
            </ol>
            <Status line={relayInfo?.isRelay
              ? { tone: 'ok', text: 'This page comes from the main PC\'s relay.' }
              : { tone: 'off', text: 'This page comes from the website, not from the relay.' }} />
            <span className="tool-note">
              If the other PCs cannot open that address, the main PC&apos;s firewall blocks port 8787 — IT has to allow it.
              Desktop alerts do not work on that address (browsers allow them only on https); everything else does.
            </span>
          </div>
          <a className="btn btn-outline tool-install" href={RELAY_URL} download="servicenow-relay.mjs">
            <Download size={16} /><span>Download relay</span>
          </a>
        </div>

        <div className="tool-card">
          <span className="module-icon"><Printer size={20} /></span>
          <div className="tool-text">
            <span className="module-name">Dispatch automation agent</span>
            <span className="module-desc">
              On every lab PC that handles Grab &amp; Go returns. It only listens — to the folder the files arrive in, and
              to this website on the same PC — and prints. Everything else is on the Automation page. One file, nothing to
              install, and nothing leaves the PC.
            </span>
            <ol className="tool-steps">
              <li>Press <strong>Download</strong> and double-click <code>nblab-automation.cmd</code>. No window opens: it runs next to the clock and starts with Windows.</li>
              <li>Open <strong>Automation</strong> on this PC. If Chrome asks whether this site may look for devices on this PC, choose <strong>Allow</strong>. Choose this PC&apos;s <strong>A4 printer</strong> and <strong>sticker printer</strong>.</li>
              <li>Put the forms (like <code>LDO.pdf</code>) in the files folder, named as in the automation.</li>
            </ol>
            <span className="tool-note">
              It updates itself when a new version is published here, and takes changes to the automation within a minute
              while the website is open on the PC. Right-click its icon for the log or <em>Check for updates</em>. PDFs,
              pictures and text files print by Windows itself — no PDF app needed; Word and Excel files print through Office.
              If company policy blocks scripts, IT has to allow it.
            </span>
          </div>
          <a className="btn btn-dark tool-install" href={AGENT_URL} download="nblab-automation.cmd">
            <Download size={16} /><span>Download</span>
          </a>
        </div>

        <div className="tool-card">
          <span className="module-icon"><Sparkles size={20} /></span>
          <div className="tool-text">
            <span className="module-name">AI tech assistant</span>
            <span className="module-desc">
              Google Gemini answers IT and PC questions step by step, can follow your work processes, helps with a
              job from its card, and drafts processes for admins. It runs through the relay on the main PC, which
              keeps the Gemini key — the key is never in this website.
            </span>
            <ol className="tool-steps">
              <li>Get a Gemini API key at <strong>aistudio.google.com</strong>.</li>
              <li>On the main PC, save it in a file named <code>gemini.key</code> next to <code>servicenow-relay.mjs</code>, then restart the relay.</li>
              <li>Open the app from the relay&apos;s address — the <strong>Assistant</strong> tab appears.</li>
            </ol>
            <Status line={ai} />
          </div>
        </div>
      </section>
    </div>
  )
}
