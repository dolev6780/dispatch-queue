import { ArrowRight, BellRing, BookOpen, Download, ListOrdered, Plane } from 'lucide-react'
import { OnDutyCard } from '../components/OnDutyCard'
import { Eyebrow } from '../components/ui'
import { FEATURES } from '../services/features'
import { formatLongDate } from '../services/format'

const ICONS = { list: ListOrdered, book: BookOpen }

// Published next to the app by vite.config.js. Opening a .user.js address is
// what makes Tampermonkey offer to install it.
const WATCHER_URL = `${import.meta.env.BASE_URL}servicenow-watcher.user.js`

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
  onNavigate
}) => (
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
          <span className="tool-note">Updates install by themselves. Without Tampermonkey, Install just shows the script.</span>
        </div>
        <a className="btn btn-dark tool-install" href={WATCHER_URL} target="_blank" rel="noopener noreferrer">
          <Download size={16} /><span>Install</span>
        </a>
      </div>
    </section>
  </div>
)
