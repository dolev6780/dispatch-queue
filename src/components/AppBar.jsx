import { useState } from 'react'
import { ChevronDown, LogOut, Menu, Moon, Settings, Sun, X } from 'lucide-react'
import { Logo } from './ui'
import { formatClockHMS, initialsOf, siteLabel } from '../services/format'

const BASE_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'queue', label: 'Queue' },
  { id: 'processes', label: 'Processes' }
]

const CONNECTION = {
  live: { label: 'Live', className: 'is-live' },
  stale: { label: 'Reconnecting', className: 'is-stale' },
  connecting: { label: 'Connecting', className: 'is-connecting' }
}

/** Where this station is: live, reconnecting, or still connecting. */
const ConnectionDot = ({ state, withLabel = true }) => {
  const info = CONNECTION[state] || CONNECTION.connecting
  return (
    <span className={`conn ${info.className}`} title={info.label} role="status">
      <span className="conn-dot" />
      {withLabel ? <span>{info.label}</span> : <span className="sr-only">{info.label}</span>}
    </span>
  )
}

/** The site this station shows. Global admins may switch; everyone else is fixed. */
const SitePicker = ({ site, sites, onSwitchSite, className = '' }) => {
  if (!site) return null
  if (sites && sites.length > 1) {
    return (
      <label className={`site-picker is-switchable ${className}`}>
        <span className="site-picker-text">{siteLabel(site)}</span>
        <ChevronDown size={14} />
        <select value={site.id} onChange={(event) => onSwitchSite(event.target.value)} aria-label="Site">
          {sites.map(option => (
            <option key={option.id} value={option.id}>{siteLabel(option)}</option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <span className={`site-picker ${className}`}>
      <span className="site-picker-text">{siteLabel(site)}</span>
    </span>
  )
}

/**
 * The black bar across the top of every signed-in screen.
 *
 * Desktop: brand, site, tabs, connection, clock, the signed-in person.
 * Phone: the site and page as a title, the clock, and a menu for the rest.
 * The Admin tab appears for site and global admins; hiding it is convenience —
 * the Firestore rules are the enforcement.
 */
export const AppBar = ({
  route,
  onNavigate,
  theme,
  onToggleTheme,
  currentTime,
  session,
  isGlobal,
  canAdminister,
  site,
  sites,
  onSwitchSite,
  onSignOut,
  connection,
  isNarrow,
  showAssistant
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const tabs = [
    ...BASE_TABS,
    ...(showAssistant ? [{ id: 'assistant', label: 'Assistant' }] : []),
    ...(canAdminister ? [{ id: 'admin', label: 'Admin' }] : [])
  ]
  const name = session?.name || 'Account'
  const ThemeIcon = theme === 'dark' ? Sun : Moon
  const themeTitle = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`

  if (isNarrow) {
    const pageName = route === 'home' ? '' : ` ${route}`
    const go = (target) => { setMenuOpen(false); onNavigate(target) }
    return (
      <header className="topbar is-narrow">
        <div className="topbar-inner">
          <button className="topbar-title" onClick={() => onNavigate('home')}>
            <span>{site ? `${site.name}${pageName}` : 'NBLAB'}</span>
            <ConnectionDot state={connection} withLabel={false} />
          </button>
          <span className="topbar-clock">{formatClockHMS(currentTime)}</span>
          <button className="topbar-icon" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}>
            <Menu size={20} />
          </button>
        </div>

        {menuOpen && (
          <div className="sheet-backdrop" onClick={() => setMenuOpen(false)}>
            <nav className="sheet" aria-label="Menu" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-head">
                <span className="avatar">{initialsOf(name)}</span>
                <span className="sheet-who">
                  <strong>{name}</strong>
                  {isGlobal && <span className="role-tag">Global admin</span>}
                </span>
                <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  <X size={18} />
                </button>
              </div>
              <SitePicker site={site} sites={sites} onSwitchSite={onSwitchSite} className="is-light" />
              <div className="sheet-links">
                {[...tabs, { id: 'settings', label: 'Settings' }].map(tab => (
                  <button key={tab.id} className={`sheet-link ${route === tab.id ? 'is-active' : ''}`}
                    onClick={() => go(tab.id)} aria-current={route === tab.id ? 'page' : undefined}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="sheet-foot">
                <button className="btn btn-outline" onClick={onToggleTheme}>
                  <ThemeIcon size={16} /><span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
                <button className="btn btn-outline" onClick={() => { setMenuOpen(false); onSignOut() }}>
                  <LogOut size={16} /><span>Sign out</span>
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>
    )
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => onNavigate('home')} title="NBLAB Management home">
          <Logo />
          <span>NBLAB</span>
        </button>

        <SitePicker site={site} sites={sites} onSwitchSite={onSwitchSite} />

        <nav className="tabs" aria-label="Primary">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab ${route === tab.id ? 'is-active' : ''}`}
              onClick={() => onNavigate(tab.id)}
              aria-current={route === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="topbar-end">
          <ConnectionDot state={connection} />
          <span className="topbar-clock">{formatClockHMS(currentTime)}</span>
          <span className="who">
            <span className="avatar">{initialsOf(name)}</span>
            <span className="who-name">{name}</span>
            {isGlobal && <span className="role-tag">Global admin</span>}
          </span>
          <button className={`topbar-icon ${route === 'settings' ? 'is-active' : ''}`} onClick={() => onNavigate('settings')}
            title="Settings" aria-label="Settings" aria-current={route === 'settings' ? 'page' : undefined}>
            <Settings size={17} />
          </button>
          <button className="topbar-icon" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
          <button className="topbar-icon" onClick={onToggleTheme} title={themeTitle} aria-label={themeTitle}>
            <ThemeIcon size={17} />
          </button>
        </div>
      </div>
    </header>
  )
}
