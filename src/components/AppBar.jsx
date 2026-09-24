import {
  Radio,
  Sun,
  Moon,
  Cloud,
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  ListOrdered,
  ShieldCheck,
  LogIn,
  LogOut
} from 'lucide-react'
import { formatClockTime } from '../services/schedule'

const BASE_TABS = [
  { id: 'home', label: 'Home', icon: LayoutGrid },
  { id: 'queue', label: 'Queue', icon: ListOrdered }
]

/**
 * Application top bar: brand, primary navigation, session, and the controls
 * that are global rather than page-specific.
 *
 * The Admin tab only appears for a signed-in administrator. That is a UI
 * convenience, not a security boundary — see services/auth.js.
 */
export const AppBar = ({
  route,
  onNavigate,
  theme,
  onToggleTheme,
  connectionState,
  currentTime,
  session,
  onSignOut
}) => {
  const tabs = session?.isAdmin
    ? [...BASE_TABS, { id: 'admin', label: 'Admin', icon: ShieldCheck }]
    : BASE_TABS

  return (
    <header className="md-app-bar">
      <div className="md-app-bar-content">
        <button className="md-brand" onClick={() => onNavigate('home')} title="NBLAB Management home">
          <div className="md-brand-icon">
            <Radio size={20} />
          </div>
          <div className="md-brand-title">
            NBLAB <span className="md-brand-subtitle">Management</span>
          </div>
        </button>

        <nav className="md-nav-tabs" aria-label="Primary">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isActive = route === tab.id
            return (
              <button
                key={tab.id}
                className={`md-nav-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => onNavigate(tab.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="md-app-bar-actions">
          {/* Read-only status. There is no local mode and no in-app config, so
              this reports the connection rather than opening anything. It
              stays because a wall display that has quietly stopped syncing
              looks identical to one that is up to date. */}
          <div
            className={`md-firebase-chip md-firebase-${connectionState.status}`}
            role="status"
            title={
              connectionState.status === 'connected'
                ? `Live sync active${connectionState.projectId ? ` · ${connectionState.projectId}` : ''}`
                : connectionState.status === 'connecting'
                  ? 'Connecting to the shared board…'
                  : connectionState.status === 'error'
                    ? `Sync problem: ${connectionState.error || 'connection lost'}`
                    : 'Firebase configuration missing from this build'
            }
          >
            <span className="md-firebase-pulse-dot" />
            {connectionState.status === 'connected' ? (
              <><Cloud size={14} /><span>Live</span></>
            ) : connectionState.status === 'connecting' ? (
              <><RefreshCw size={14} className="bell-ringing" /><span>Connecting</span></>
            ) : connectionState.status === 'error' ? (
              <><AlertCircle size={14} /><span>Sync issue</span></>
            ) : (
              <><AlertCircle size={14} /><span>Not configured</span></>
            )}
          </div>

          <div className="md-clock-chip">
            <span className="md-pulse-dot" />
            <span>{formatClockTime(currentTime)}</span>
          </div>

          {session ? (
            <div className="md-session-chip">
              <span className="md-session-avatar">
                {session.name.split(' ').map(part => part[0]).join('').slice(0, 2)}
              </span>
              <span className="md-session-name">{session.name}</span>
              {session.isAdmin && <ShieldCheck size={13} className="md-session-admin" />}
              <button
                className="md-btn-action"
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button className="md-button md-button-tonal" onClick={() => onNavigate('signin')}>
              <LogIn size={15} />
              <span>Sign in</span>
            </button>
          )}

          <button
            className="md-icon-button"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
    </header>
  )
}
