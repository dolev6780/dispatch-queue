import { ArrowRight, BookOpen, ListOrdered, Mail, Plane, Printer } from 'lucide-react'
import { OnDutyCard } from '../components/OnDutyCard'
import { Eyebrow } from '../components/ui'
import { FEATURES } from '../services/features'
import { formatLongDate } from '../services/format'

const ICONS = { list: ListOrdered, book: BookOpen, printer: Printer, mail: Mail }

/**
 * The signed-in landing page: today at this site in one card, then the
 * modules. Signed-out visitors never see it — they get the sign-in page.
 * Setting up the lab-PC tools lives on the Settings page.
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
}) => {
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
    </div>
  )
}
