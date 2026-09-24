import {
  ListOrdered,
  Users,
  CalendarClock,
  ClipboardList,
  BarChart3,
  Settings2,
  ArrowRight
} from 'lucide-react'

/**
 * NBLAB Management landing page.
 *
 * Only the Queue module is built. The rest are listed as planned so the shape
 * of the product is visible, and are explicitly marked "Coming soon" rather
 * than being clickable dead ends.
 */
const MODULES = [
  {
    id: 'queue',
    title: 'Dispatch Queue',
    description: 'Build the daily queue, see who is on duty, and drive the wall display.',
    icon: ListOrdered,
    available: true
  },
  {
    id: 'team',
    title: 'Team',
    description: 'Staff records, roles and contact details in one place.',
    icon: Users,
    available: false
  },
  {
    id: 'shifts',
    title: 'Shift Planning',
    description: 'Plan rotations further ahead than the current week.',
    icon: CalendarClock,
    available: false
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Assign and track lab work alongside the dispatch rota.',
    icon: ClipboardList,
    available: false
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Coverage, hours worked and queue history.',
    icon: BarChart3,
    available: false
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Workspace preferences, sync and integrations.',
    icon: Settings2,
    available: false
  }
]

export const HomePage = ({ onNavigate, currentTime, queueSummary }) => {
  const formattedDate = currentTime.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <div className="md-page">
      <section className="md-hero">
        <span className="md-hero-eyebrow">{formattedDate}</span>
        <h1 className="md-hero-title">NBLAB Management</h1>
        <p className="md-hero-lede">
          One place to run the lab. The dispatch queue is live now — every change syncs
          instantly to every screen. More modules are on the way.
        </p>

        <div className="md-hero-actions">
          <button className="md-button md-button-filled" onClick={() => onNavigate('queue')}>
            <ListOrdered size={17} />
            <span>Open Dispatch Queue</span>
            <ArrowRight size={16} />
          </button>
          {queueSummary && (
            <span className="md-hero-stat">{queueSummary}</span>
          )}
        </div>
      </section>

      <section className="md-module-grid">
        {MODULES.map(module => {
          const Icon = module.icon
          return (
            <button
              key={module.id}
              className={`md-module-card ${module.available ? '' : 'is-soon'}`}
              onClick={() => module.available && onNavigate(module.id)}
              disabled={!module.available}
              aria-disabled={!module.available}
            >
              <div className="md-module-icon">
                <Icon size={22} />
              </div>
              <div className="md-module-text">
                <h3>
                  {module.title}
                  {!module.available && <span className="md-module-soon">Coming soon</span>}
                </h3>
                <p>{module.description}</p>
              </div>
              {module.available && <ArrowRight size={18} className="md-module-arrow" />}
            </button>
          )
        })}
      </section>
    </div>
  )
}
