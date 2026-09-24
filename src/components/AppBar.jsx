import { Radio, Sun, Moon, Cloud, CloudOff, AlertCircle, RefreshCw, LayoutGrid, ListOrdered } from 'lucide-react'
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
  onOpenFirebase,
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
        <button
          className={`md-firebase-chip md-firebase-${connectionState.status}`}
          onClick={onOpenFirebase}
          title={`Cloud sync status: ${connectionState.status}. Click to open sync settings.`}
        >
          <span className="md-firebase-pulse-dot" />
          {connectionState.status === 'connected' ? (
            <><Cloud size={14} /><span>Synced</span></>
          ) : connectionState.status === 'connecting' ? (
            <><RefreshCw size={14} className="bell-ringing" /><span>Connecting</span></>
          ) : connectionState.status === 'error' ? (
            <><AlertCircle size={14} /><span>Sync Issue</span></>
          ) : (
            <><CloudOff size={14} /><span>Local</span></>
          )}
        </button>

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
