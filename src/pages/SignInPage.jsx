import { useState } from 'react'
import { KeyRound, ShieldCheck, ArrowLeft, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { findMemberByWorkId, hasAnyAdmin, hashWorkId, isWorkIdTaken, normaliseWorkId } from '../services/auth'

/**
 * Work-ID sign-in.
 *
 * Two modes:
 *  - normal: type a work ID, matched against the roster's stored hashes.
 *  - bootstrap: nobody is an administrator yet, so the first person to claim
 *    one becomes it. This path closes itself as soon as an admin exists,
 *    which is why it is safe to leave in rather than seeding a default
 *    password everyone would forget to change.
 */
export const SignInPage = ({ roster, onSignedIn, onNavigate, onSetupAdmin }) => {
  const [workId, setWorkId] = useState('')
  const [memberId, setMemberId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState(false)

  const needsBootstrap = !hasAnyAdmin(roster)

  const handleSignIn = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const member = await findMemberByWorkId(roster, workId)
      if (!member) {
        setError('That work ID was not recognised.')
        return
      }
      onSignedIn(member.id)
    } catch {
      setError('Could not verify the work ID on this browser.')
    } finally {
      setBusy(false)
    }
  }

  const handleBootstrap = async (event) => {
    event.preventDefault()
    setError('')

    if (!memberId) {
      setError('Choose who you are first.')
      return
    }
    if (normaliseWorkId(workId).length < 3) {
      setError('Use a work ID of at least 3 characters.')
      return
    }

    setBusy(true)
    try {
      if (await isWorkIdTaken(roster, workId, memberId)) {
        setError('That work ID is already in use.')
        return
      }
      const hash = await hashWorkId(workId)
      onSetupAdmin(memberId, hash)
      onSignedIn(memberId)
    } catch {
      setError('Could not set the work ID on this browser.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="md-page md-auth-page">
      <section className="md-auth-card">
        <div className="md-auth-icon">
          {needsBootstrap ? <ShieldCheck size={26} /> : <KeyRound size={26} />}
        </div>

        <h1 className="md-auth-title">
          {needsBootstrap ? 'First-time setup' : 'Sign in'}
        </h1>
        <p className="md-auth-lede">
          {needsBootstrap
            ? 'No administrator has been set up yet. Choose who you are and pick a work ID — you will become the administrator.'
            : 'Enter your work ID to edit the dispatch queue. Viewing the board does not require signing in.'}
        </p>

        <form className="md-auth-form" onSubmit={needsBootstrap ? handleBootstrap : handleSignIn}>
          {needsBootstrap && (
            <label className="md-form-field">
              <span className="md-form-label">Who are you?</span>
              <select
                className="md-input"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">Select your name…</option>
                {roster.map(person => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="md-form-field">
            <span className="md-form-label">Work ID</span>
            <div className="md-input-with-trailing">
              <input
                className="md-input"
                type={reveal ? 'text' : 'password'}
                inputMode="text"
                autoComplete="off"
                placeholder={needsBootstrap ? 'Choose a work ID' : 'Your work ID'}
                value={workId}
                onChange={(event) => setWorkId(event.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="md-btn-action"
                onClick={() => setReveal(shown => !shown)}
                title={reveal ? 'Hide' : 'Show'}
                aria-label={reveal ? 'Hide work ID' : 'Show work ID'}
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="md-calc-alert" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="md-button md-button-filled md-auth-submit"
            disabled={busy || !workId.trim()}
          >
            {busy ? 'Checking…' : needsBootstrap ? 'Create administrator' : 'Sign in'}
          </button>
        </form>

        <button className="md-button md-button-text md-auth-back" onClick={() => onNavigate('queue')}>
          <ArrowLeft size={15} />
          <span>Back to the board</span>
        </button>

        <p className="md-auth-note">
          Signing in records who changed the queue and keeps the board from being edited by
          passers-by. It is not a security boundary — anyone determined can work around it.
        </p>
      </section>
    </div>
  )
}
