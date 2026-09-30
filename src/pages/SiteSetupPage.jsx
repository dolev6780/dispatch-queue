import { useState } from 'react'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { AuthCard } from './SignInPage'
import { migrateToFirstSite } from '../services/authService'

/**
 * Shown to an administrator whose account predates sites.
 *
 * Creates the first site and moves everything into it in one batch: this
 * account, any other pre-sites accounts, and the existing dispatch people and
 * queue. It also strips the plaintext WWIDs those older profiles stored.
 */
export const SiteSetupPage = ({ uid, name, onSignOut, theme, onToggleTheme }) => {
  const [siteName, setSiteName] = useState('')
  const [siteLocation, setSiteLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!siteName.trim()) { setError('Name the site.'); return }
    setError('')
    setBusy(true)
    try {
      await migrateToFirstSite({ uid, siteName, siteLocation })
      // The profile listener picks up the new siteId and the app moves on.
    } catch (err) {
      setError(err.message || 'Could not set up the site.')
      setBusy(false)
    }
  }

  return (
    <AuthCard
      eyebrow="One-time setup"
      title="Name your first site"
      theme={theme}
      onToggleTheme={onToggleTheme}
      footer={<button className="link-btn" onClick={onSignOut}>Sign out</button>}
    >
      <form className="auth-form" onSubmit={submit}>
        <p className="auth-lede">
          Hi {name || 'there'} — the app now runs several sites. Your account and everything already set up
          moves into this first one. You can add more sites afterwards.
        </p>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">Site name</span>
            <input className="input" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. L12" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Description <span className="field-optional">optional</span></span>
            <input className="input" value={siteLocation} onChange={e => setSiteLocation(e.target.value)} placeholder="e.g. Main lab" />
          </label>
        </div>

        {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          <span>{busy ? 'Setting up…' : 'Create site'}</span>
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
    </AuthCard>
  )
}
