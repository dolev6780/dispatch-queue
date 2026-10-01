import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Dialog } from './Dialog'
import { BUILTIN_BLANKS, EMAIL_LIMITS, blanksIn, cleanTemplate, emptyTemplate, splitAddresses, validateTemplate } from '../services/emails'

/**
 * Write or edit an email template: who it goes to, the subject, and the body
 * with {blanks} the sender fills in.
 */
export const TemplateDialog = ({ template, onSave, onClose }) => {
  const start = template || emptyTemplate()
  const [name, setName] = useState(start.name)
  const [to, setTo] = useState(start.to.join(', '))
  const [cc, setCc] = useState((start.cc || []).join(', '))
  const [subject, setSubject] = useState(start.subject)
  const [body, setBody] = useState(start.body)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const values = () => ({ name, to: splitAddresses(to), cc: splitAddresses(cc), subject, body })
  const blanks = blanksIn({ subject, body })

  const submit = async (event) => {
    event.preventDefault()
    const problem = validateTemplate(values())
    if (problem) { setError(problem); return }
    setError('')
    setBusy(true)
    try {
      await onSave(cleanTemplate(values()))
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save the template.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={template ? 'Edit template' : 'New email template'}
      subtitle="Everyone at the site can use it; it opens in Outlook ready to send."
      onClose={onClose}
      onSubmit={submit}
      wide
      labelId="template-dialog-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" dir="auto" value={name} maxLength={EMAIL_LIMITS.name} onChange={e => setName(e.target.value)}
          placeholder="Vendor pickup" autoFocus />
      </label>
      <div className="field-pair">
        <label className="field">
          <span className="field-label">To</span>
          <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder="vendor@example.com" spellCheck={false} />
          <span className="field-hint">Separate several addresses with commas.</span>
        </label>
        <label className="field">
          <span className="field-label">CC <span className="field-optional">optional</span></span>
          <input className="input" value={cc} onChange={e => setCc(e.target.value)} placeholder="lab-team@example.com" spellCheck={false} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Subject</span>
        <input className="input" dir="auto" value={subject} maxLength={EMAIL_LIMITS.subject} onChange={e => setSubject(e.target.value)}
          placeholder="Pickup for {ticket}" />
      </label>
      <label className="field">
        <span className="field-label">Email</span>
        <textarea className="input mail-body-input" dir="auto" rows={10} value={body} maxLength={EMAIL_LIMITS.body} onChange={e => setBody(e.target.value)}
          placeholder={'Hello,\n\nPlease pick up asset {asset tag} for ticket {ticket}.\n\nThanks,\n{name}'} />
        <span className="field-hint">
          Write a blank in braces, like <code>{'{ticket}'}</code> or <code>{'{asset tag}'}</code>: the sender fills it in.
          {' '}{BUILTIN_BLANKS.map(b => `{${b}}`).join(' ')} fill themselves (the sender&apos;s name and site).
        </span>
      </label>
      <p className="mail-blanks">
        <span className="field-label">The sender fills in</span>
        {blanks.length ? blanks.map(b => <span key={b.key} className="chip is-static">{b.label}</span>) : <span className="field-hint">nothing</span>}
      </p>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
