import { useState } from 'react'
import { AlertCircle, Check, Copy, ExternalLink, Mail } from 'lucide-react'
import { Dialog } from './Dialog'
import { EMAIL_LIMITS, LINK_LIMIT, blanksIn, builtinValues, composeEmail, mailtoLink, outlookWebLink } from '../services/emails'

const LONG_BLANK = /note|comment|detail|descri|reason|הער|פרט|סיב/i

/**
 * Write an email from a template: fill in its blanks, see the email, and open
 * it in Outlook on the web — or the PC's mail app — ready to send.
 */
export const WriteEmailDialog = ({ template, senderName, siteName, onClose }) => {
  const [values, setValues] = useState({})
  const [now] = useState(() => new Date())
  const [copied, setCopied] = useState(false)

  const blanks = blanksIn(template)
  const email = composeEmail(template, { ...values, ...builtinValues({ now, name: senderName, site: siteName }) })
  const webLink = outlookWebLink(email)
  const tooLong = webLink.length > LINK_LIMIT
  const empty = blanks.filter(blank => !String(values[blank.key] || '').trim())
  const set = (key) => (event) => { setCopied(false); setValues(current => ({ ...current, [key]: event.target.value })) }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog
      title={template.name}
      subtitle={`To ${email.to.join(', ')}${email.cc.length ? ` · CC ${email.cc.join(', ')}` : ''}`}
      onClose={onClose}
      wide
      labelId="write-email-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost dialog-foot-start" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <a className="btn btn-outline" href={mailtoLink(email)}><Mail size={15} /><span>Mail app</span></a>
          {tooLong ? (
            <button type="button" className="btn btn-dark" disabled><ExternalLink size={15} /><span>Open in Outlook</span></button>
          ) : (
            <a className="btn btn-dark" href={webLink} target="_blank" rel="noreferrer"><ExternalLink size={15} /><span>Open in Outlook</span></a>
          )}
        </>
      )}
    >
      {blanks.length > 0 && (
        <div className="mail-fill">
          {blanks.map((blank, index) => (
            <label key={blank.key} className="field">
              <span className="field-label">{blank.label}</span>
              {LONG_BLANK.test(blank.key) ? (
                <textarea className="input" dir="auto" rows={3} maxLength={EMAIL_LIMITS.value} value={values[blank.key] || ''} onChange={set(blank.key)} autoFocus={index === 0} />
              ) : (
                <input className="input" dir="auto" maxLength={EMAIL_LIMITS.value} value={values[blank.key] || ''} onChange={set(blank.key)} autoFocus={index === 0} />
              )}
            </label>
          ))}
        </div>
      )}

      <div className="mail-preview" aria-label="The email">
        <div className="mail-preview-subject"><span>Subject</span><bdi>{email.subject}</bdi></div>
        <div className="mail-preview-body">{email.body}</div>
      </div>

      {tooLong ? (
        <p className="notice is-amber"><AlertCircle size={16} /><span>This email is too long to open in Outlook from here. Press Copy, then paste it into a new email.</span></p>
      ) : empty.length > 0 ? (
        <p className="notice is-amber"><AlertCircle size={16} /><span>Still empty: {empty.map(blank => blank.label).join(', ')}.</span></p>
      ) : (
        <p className="field-hint">Outlook opens with the email written. Check it, then press Send.</p>
      )}
    </Dialog>
  )
}
