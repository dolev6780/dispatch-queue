import { Radio, Sun, Moon, Cloud, AlertCircle, RefreshCw, LayoutGrid, ListOrdered } from 'lucide-react'
import { formatClockTime } from '../services/schedule'

const NAV_TABS = [
  { id: 'home', label: 'Home', icon: LayoutGrid },
  { id: 'queue', label: 'Queue', icon: ListOrdered }
]

/**
 * Application top bar: brand, primary navigation, and the controls that are
 * global rather than page-specific (sync status, clock, theme).
 *
 * Page-specific actions — sound, full screen — live on the page itself so this
 * bar stays readable as more modules are added.
 */
export const AppBar = ({
  route,
  onNavigate,
  theme,
  onToggleTheme,
  connectionState,
  currentTime
}) => (
  <header className="md-app-bar">
    <div className="md-app-bar-content">
      <button
        className="md-brand"
        onClick={() => onNavigate('home')}
        title="NBLAB Management home"
      >
        <div className="md-brand-icon">
          <Radio size={20} />
        </div>
        <div className="md-brand-title">
          NBLAB <span className="md-brand-subtitle">Management</span>
        </div>
      </button>

      <nav className="md-nav-tabs" aria-label="Primary">
        {NAV_TABS.map(tab => {
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
            this reports the connection rather than opening anything. It stays
            because a wall display that has quietly stopped syncing looks
            identical to one that is up to date. */}
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
