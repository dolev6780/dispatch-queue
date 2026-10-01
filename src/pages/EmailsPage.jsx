import { useState } from 'react'
import { AlertCircle, Check, Mail, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { TemplateDialog } from '../components/TemplateDialog'
import { WriteEmailDialog } from '../components/WriteEmailDialog'
import { deleteTemplate, saveTemplate } from '../services/db'
import { blanksIn } from '../services/emails'
import { siteLabel } from '../services/format'

const TemplateCard = ({ template, canEdit, onWrite, onEdit, onDelete }) => {
  const [confirming, setConfirming] = useState(false)
  const blanks = blanksIn(template)
  return (
    <li className="card mail-card">
      <div className="mail-card-head">
        <h3 dir="auto">{template.name}</h3>
        {canEdit && (
          <div className="mail-card-actions">
            <button className="icon-btn is-sm" onClick={onEdit} aria-label={`Edit ${template.name}`} title="Edit template"><Pencil size={15} /></button>
            {confirming ? (
              <span className="confirm">
                <button className="icon-btn is-sm" onClick={() => setConfirming(false)} aria-label="Keep it"><X size={15} /></button>
                <button className="icon-btn is-sm is-danger" onClick={() => { setConfirming(false); onDelete() }} aria-label={`Delete ${template.name}`}><Check size={15} /></button>
              </span>
            ) : (
              <button className="icon-btn is-sm is-danger-soft" onClick={() => setConfirming(true)} aria-label={`Delete ${template.name}`} title="Delete template">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      <dl className="auto-facts">
        <dt>To</dt>
        <dd className="mail-addresses">{template.to.join(', ')}</dd>
        {template.cc?.length > 0 && (
          <>
            <dt>CC</dt>
            <dd className="mail-addresses">{template.cc.join(', ')}</dd>
          </>
        )}
        <dt>Subject</dt>
        <dd dir="auto">{template.subject}</dd>
      </dl>
      <p className="mail-card-blanks">{blanks.length ? `You fill in: ${blanks.map(b => b.label).join(', ')}` : 'Nothing to fill in'}</p>
      <button className="btn btn-dark mail-write" onClick={onWrite}><Send size={15} /><span>Write</span></button>
    </li>
  )
}

/**
 * Email templates: emails the site sends often. Site admins write them; anyone
 * fills in the blanks and opens the email in Outlook, ready to send.
 */
export const EmailsPage = ({ site, templates, loaded, error, canEdit, uid, senderName }) => {
  const [editing, setEditing] = useState(null) // null | 'new' | template
  const [writing, setWriting] = useState(null)
  const [actionError, setActionError] = useState('')

  const remove = async (template) => {
    setActionError('')
    try { await deleteTemplate(site.id, template.id) } catch (err) { setActionError(err?.message || 'Could not delete the template.') }
  }

  return (
    <div className="page mail-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>Email templates · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
          <h1 className="display">Emails</h1>
          <p className="page-meta">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'} · fill in the blanks, it opens in Outlook ready to send
          </p>
        </div>
        <div className="page-head-actions">
          {canEdit && (
            <button className="btn btn-dark" onClick={() => setEditing('new')}><Plus size={16} /><span>New template</span></button>
          )}
        </div>
      </header>

      {(error || actionError) && <p className="alert" role="alert"><AlertCircle size={16} /><span>{actionError || error}</span></p>}

      {templates.length === 0 ? (
        <section className="card proc-empty">
          <Mail size={22} />
          <p>
            {!loaded ? 'Loading…'
              : canEdit ? 'No email templates yet. Write the first one — for example, a pickup request to a vendor.'
                : 'No email templates yet. Your site admin writes them.'}
          </p>
        </section>
      ) : (
        <ul className="mail-list">
          {templates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              canEdit={canEdit}
              onWrite={() => setWriting(template)}
              onEdit={() => setEditing(template)}
              onDelete={() => remove(template)}
            />
          ))}
        </ul>
      )}

      {writing && (
        <WriteEmailDialog template={writing} senderName={senderName} siteName={site?.name || ''} onClose={() => setWriting(null)} />
      )}
      {editing && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          onSave={values => saveTemplate(site.id, editing === 'new' ? null : editing.id, values, uid)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
