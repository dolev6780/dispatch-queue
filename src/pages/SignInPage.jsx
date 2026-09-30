import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound, Moon, Sun } from 'lucide-react'
import { Logo } from '../components/ui'
import { signInWithWwid, createFirstAdmin, isBootstrapClaimed } from '../services/authService'
import { validateWwid } from '../services/credentials'

/** The dark-topped card shared by sign-in and first-site setup. */
export const AuthCard = ({ eyebrow = 'NBLAB Management', title, children, footer, theme, onToggleTheme }) => (
  <div className="auth">
    {onToggleTheme && (
      <button className="icon-btn auth-theme" onClick={onToggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    )}
    <section className="auth-card">
      <div className="auth-top">
        <Logo size={36} />
        <span className="auth-eyebrow">{eyebrow}</span>
        <h1 className="auth-title">{title}</h1>
      </div>
      <div className="auth-body">{children}</div>
    </section>
    {footer && <p className="auth-foot">{footer}</p>}
  </div>
)

/** The work ID field: hidden like a password, with an eye to check it. */
const WorkIdField = ({ value, onChange, autoFocus }) => {
  const [visible, setVisible] = useState(false)
  return (
    <label className="field">
      <span className="field-label">Work ID</span>
      <span className="input-wrap">
        <input
          className="input is-mono is-lg"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Your work ID"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus={autoFocus}
        />
        <button type="button" className="input-eye" onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide work ID' : 'Show work ID'} aria-pressed={visible}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  )
}

/**
 * Sign in with a work ID — one field. The account decides which site you land
 * on, so there is no site picker.
 *
 * On an empty database this becomes first-time setup: the first global
 * administrator and the first site are created together. The rules permit
 * that only while config/bootstrap is absent, and it is written in the same
 * batch, so the path closes for good once setup succeeds.
 */
export const SignInPage = ({ theme, onToggleTheme }) => {
  const [wwid, setWwid] = useState('')
  const [name, setName] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteLocation, setSiteLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsBootstrap, setNeedsBootstrap] = useState(null) // null = checking

  useEffect(() => {
    let active = true
    isBootstrapClaimed()
      .then(claimed => { if (active) setNeedsBootstrap(!claimed) })
      .catch(() => { if (active) setNeedsBootstrap(false) })
    return () => { active = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    const problem = validateWwid(wwid)
    if (problem) { setError(problem); return }
    if (needsBootstrap && !name.trim()) { setError('Enter your name.'); return }
    if (needsBootstrap && !siteName.trim()) { setError('Name the first site.'); return }

    setBusy(true)
    try {
      if (needsBootstrap) {
        await createFirstAdmin({ wwid, name, siteName, siteLocation })
      } else {
        await signInWithWwid(wwid)
      }
      // App reacts to the auth change; this page simply unmounts.
    } catch (err) {
      setError(err.message || 'Sign-in failed.')
      setBusy(false)
    }
  }

  if (needsBootstrap === null) {
    return (
      <AuthCard title="Sign in to the board" theme={theme} onToggleTheme={onToggleTheme}>
        <p className="auth-wait" role="status">Connecting…</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={needsBootstrap ? 'Set up NBLAB' : 'Sign in to the board'}
      theme={theme}
      onToggleTheme={onToggleTheme}
      footer={needsBootstrap ? null : 'No account yet? Ask your site admin to add you.'}
    >
      <form className="auth-form" onSubmit={submit}>
        {needsBootstrap && (
          <>
            <p className="auth-lede">
              No accounts exist yet. Create the first administrator and the first site — more sites and people come after.
            </p>
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
            </label>
            <div className="field-pair">
              <label className="field">
                <span className="field-label">First site</span>
                <input className="input" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. L12" />
              </label>
              <label className="field">
                <span className="field-label">Description <span className="field-optional">optional</span></span>
                <input className="input" value={siteLocation} onChange={e => setSiteLocation(e.target.value)} placeholder="e.g. Main lab" />
              </label>
            </div>
          </>
        )}

        <WorkIdField value={wwid} onChange={setWwid} autoFocus={!needsBootstrap} />

        {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          <span>{busy ? 'Signing in…' : needsBootstrap ? 'Create administrator' : 'Sign in'}</span>
          {!busy && <ArrowRight size={18} />}
        </button>

        <p className="key-note">
          <KeyRound size={18} />
          <span>Your work ID is your password. Anyone who knows it can sign in as you — keep it to yourself.</span>
        </p>
      </form>
    </AuthCard>
  )
}
