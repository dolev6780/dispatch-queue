import { ArrowRight, BellRing, BookOpen, Download, ListOrdered, Network, Plane, Sparkles } from 'lucide-react'
import { OnDutyCard } from '../components/OnDutyCard'
import { Eyebrow } from '../components/ui'
import { FEATURES } from '../services/features'
import { formatClockHM, formatLongDate } from '../services/format'
import { bridgeStatus } from '../services/servicenow'

const ICONS = { list: ListOrdered, book: BookOpen }

// Published next to the app by vite.config.js. Opening a .user.js address is
// what makes Tampermonkey offer to install it.
const WATCHER_URL = `${import.meta.env.BASE_URL}servicenow-watcher.user.js`
const RELAY_URL = `${import.meta.env.BASE_URL}servicenow-relay.mjs`

/** Where the watcher stands in THIS browser, in words. */
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

/**
 * The signed-in landing page: today at this site in one card, then the
 * modules, then tools to install on a lab PC. Signed-out visitors never see
 * it — they get the sign-in page.
 */
export const HomePage = ({
  site,
  currentTime,
  todayDay,
  todaySchedule,
  nowMinutes,
  openJobsCount,
  summaries = {},
  tempUntil,
  onNavigate,
  serviceNow,
  relayInfo
}) => {
  const watcher = watcherLine(serviceNow, currentTime)
  return (
    <div className="page home-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>{formatLongDate(currentTime)}</Eyebrow>
          <h1 className="display is-xl">NBLAB Management</h1>
          <p className="lede">Today's queue, who is on duty, and every open job at {site?.name || 'your site'}.</p>
          {tempUntil && (
            <p className="notice is-blue">
              <Plane size={15} />
              <span>You are working at {site?.name} until {tempUntil}. After that you are back at your home site automatically.</span>
            </p>
          )}
        </div>
      </header>

      <OnDutyCard
        variant="home"
        day={todayDay}
        schedule={todaySchedule}
        isToday
        nowMinutes={nowMinutes}
        openJobsCount={openJobsCount}
        onOpenQueue={() => onNavigate('queue')}
      />

      <section className="modules" aria-label="Modules">
        {FEATURES.map(feature => {
          const Icon = ICONS[feature.icon] || ListOrdered
          return (
            <button key={feature.id} className="module" onClick={() => onNavigate(feature.route)}>
              <span className="module-icon"><Icon size={20} /></span>
              <span className="module-name">{feature.name}</span>
              <span className="module-desc">{feature.description}</span>
              <span className="module-foot">
                <span>{summaries[feature.id]}</span>
                <ArrowRight size={16} />
              </span>
            </button>
          )
        })}
      </section>

      <section className="tools" aria-label="Tools">
        <Eyebrow>Tools for the lab PC</Eyebrow>
        <div className="tool-card">
          <span className="module-icon"><BellRing size={20} /></span>
          <div className="tool-text">
            <span className="module-name">ServiceNow watcher</span>
            <span className="module-desc">
              A chime and a desktop notification on this PC when a new unassigned task reaches your group, and the
              waiting tasks on this PC's Queue page and wall display. It uses your own ServiceNow login and only
              reads; the tasks stay in this browser and never go into the app's database.
            </span>
            <ol className="tool-steps">
              <li>Add the <strong>Tampermonkey</strong> extension to Edge or Chrome, turn on <em>Allow user scripts</em>, and set its <em>Site access</em> to <em>On all sites</em>.</li>
              <li>Press <strong>Install</strong> here, then <strong>Install</strong> again in Tampermonkey.</li>
              <li>Open ServiceNow, click the badge at the bottom-left, enter your group, and press <strong>Test</strong>. Keep that ServiceNow tab open.</li>
            </ol>
            <span className={`tool-status is-${watcher.tone}`} role="status"><span className="tool-status-dot" />{watcher.text}</span>
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
            <span className={`tool-status is-${relayInfo?.ai ? 'ok' : relayInfo?.isRelay ? 'wait' : 'off'}`} role="status">
              <span className="tool-status-dot" />
              {relayInfo?.ai
                ? `On — Gemini (${relayInfo.model}) through the main PC.`
                : relayInfo?.isRelay
                  ? 'The main PC is reachable, but its relay has no Gemini key yet.'
                  : 'Only on pages opened from the main PC\'s relay address.'}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
