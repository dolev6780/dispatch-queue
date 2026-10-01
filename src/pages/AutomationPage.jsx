import { useState } from 'react'
import { AlertCircle, Check, Download, FileText, Pencil, Plus, Printer, Tag, Trash2, X } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { AutomationDialog } from '../components/AutomationDialog'
import { deleteAutomation, saveAutomation } from '../services/db'
import { automationSummary, builtinValues, cleanAutomation, fillSticker, matchAutomation, readFields } from '../services/automation'
import { siteLabel } from '../services/format'

const StickerPreview = ({ lines }) => (
  <div className="sticker-preview" aria-label="Sticker">
    {lines.map((line, index) => <span key={index}>{line || ' '}</span>)}
  </div>
)

const AutomationCard = ({ automation, canEdit, onEdit, onToggle, onDelete }) => {
  const [confirming, setConfirming] = useState(false)
  const summary = automationSummary(cleanAutomation(automation))
  return (
    <li className={`card auto-card ${automation.enabled === false ? 'is-off' : ''}`}>
      <div className="auto-head">
        <div className="auto-title">
          <h3>{automation.name}</h3>
          <span className={`auto-state ${automation.enabled === false ? 'is-off' : 'is-on'}`}>{automation.enabled === false ? 'Off' : 'On'}</span>
        </div>
        {canEdit && (
          <div className="auto-actions">
            <button className="btn btn-sm btn-ghost" onClick={onToggle}>{automation.enabled === false ? 'Turn on' : 'Turn off'}</button>
            <button className="btn btn-sm btn-outline" onClick={onEdit}><Pencil size={14} /><span>Edit</span></button>
            {confirming ? (
              <span className="confirm">
                <button className="icon-btn is-sm" onClick={() => setConfirming(false)} aria-label="Keep it"><X size={15} /></button>
                <button className="icon-btn is-sm is-danger" onClick={() => { setConfirming(false); onDelete() }} aria-label={`Delete ${automation.name}`}><Check size={15} /></button>
              </span>
            ) : (
              <button className="icon-btn is-sm is-danger-soft" onClick={() => setConfirming(true)} aria-label={`Delete ${automation.name}`} title="Delete automation">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      <dl className="auto-facts">
        <dt>When the file contains</dt>
        <dd className="auto-words">{automation.keywords.map(word => <span key={word} className="chip is-static">{word}</span>)}</dd>
        <dt>Files</dt>
        <dd>{summary.types}</dd>
        <dt>Prints</dt>
        <dd>{summary.prints.join(' · ') || 'nothing'}</dd>
      </dl>
      {automation.sticker && automation.stickerLines.length > 0 && <StickerPreview lines={automation.stickerLines} />}
      {automation.notes && <p className="auto-notes">{automation.notes}</p>}
    </li>
  )
}

/**
 * Dispatch automation: what the lab PCs print when a Grab & Go file arrives.
 * Admins write the automations here; the agent on each PC (Settings → Lab PC
 * tools) reads them from the website by itself and does the printing. "Try
 * it" runs the same matching on pasted text, right here.
 */
export const AutomationPage = ({ site, automations, loaded, error, canEdit, uid }) => {
  const [editing, setEditing] = useState(null) // null | 'new' | automation
  const [actionError, setActionError] = useState('')
  const [sample, setSample] = useState('')
  const [sampleName, setSampleName] = useState('')

  const save = (values) => saveAutomation(site.id, editing === 'new' ? null : editing.id, values, uid)
  const run = async (work) => {
    setActionError('')
    try { await work() } catch (err) { setActionError(err?.message || 'That did not work.') }
  }

  const tried = sample.trim() ? matchAutomation(sample, sampleName, automations) : null
  const triedValues = tried
    ? { ...readFields(sample, tried.stickerFields), ...builtinValues({ fileName: sampleName || 'file', automationName: tried.name, now: new Date() }) }
    : null

  const readSampleFile = (file) => {
    if (!file) return
    setSampleName(file.name)
    const reader = new FileReader()
    reader.onload = () => setSample(String(reader.result || ''))
    reader.readAsText(file)
  }

  return (
    <div className="page auto-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>Dispatch automation · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
          <h1 className="display">Automation</h1>
          <p className="page-meta">
            {automations.length} {automations.length === 1 ? 'automation' : 'automations'} · printed by the agent on each lab PC
          </p>
        </div>
        <div className="page-head-actions">
          {canEdit && (
            <button className="btn btn-dark" onClick={() => setEditing('new')}>
              <Plus size={16} /><span>New automation</span>
            </button>
          )}
        </div>
      </header>

      <ol className="auto-how" aria-label="How it works">
        <li><Download size={16} /><span>A Grab &amp; Go file arrives in the folder a lab PC listens to</span></li>
        <li><FileText size={16} /><span>The agent reads it and finds the automation whose words are all in it</span></li>
        <li><Printer size={16} /><span>It prints the file, the files to print from that PC, and the sticker</span></li>
      </ol>

      {(error || actionError) && <p className="alert" role="alert"><AlertCircle size={16} /><span>{actionError || error}</span></p>}

      {automations.length === 0 ? (
        <section className="card proc-empty">
          <Printer size={22} />
          <p>
            {!loaded ? 'Loading…'
              : canEdit ? 'No automations yet. Create the first one — for example, a Grab & Go return.'
                : 'No automations yet. Your site admin sets them up.'}
          </p>
        </section>
      ) : (
        <ul className="auto-list">
          {automations.map(automation => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              canEdit={canEdit}
              onEdit={() => setEditing(automation)}
              onToggle={() => run(() => saveAutomation(site.id, automation.id, { ...automation, enabled: automation.enabled === false }, uid))}
              onDelete={() => run(() => deleteAutomation(site.id, automation.id))}
            />
          ))}
        </ul>
      )}

      <section className="card auto-try" aria-labelledby="try-title">
        <div className="card-head">
          <h3 id="try-title" className="card-title">Try it</h3>
          <label className="btn btn-sm btn-outline auto-try-file">
            <FileText size={14} /><span>Open a text file</span>
            <input type="file" accept=".txt,.csv,.tsv,.html,.htm,.json,.xml,.eml" onChange={e => readSampleFile(e.target.files?.[0])} />
          </label>
        </div>
        <p className="field-hint">
          Paste the text of a Grab &amp; Go file to see which automation the PCs would use and what they would print.
          Nothing is printed or saved. For a PDF, run <code>nblab-automation.cmd -Test &quot;file.pdf&quot;</code> on a lab PC.
        </p>
        <div className="field-pair">
          <textarea className="input is-mono" rows={7} value={sample} onChange={e => setSample(e.target.value)}
            placeholder={'Grab & Go return\nTicket: RITM0012345\nAsset tag: NB-48213'} aria-label="Text of a file" />
          <div className="auto-try-result">
            <input className="input" value={sampleName} onChange={e => setSampleName(e.target.value)} placeholder="File name (optional), e.g. return.pdf"
              aria-label="File name" />
            {!sample.trim() ? (
              <p className="card-empty">The result shows here.</p>
            ) : !tried ? (
              <p className="notice is-amber"><AlertCircle size={16} /><span>No automation matches — the PC would print nothing.</span></p>
            ) : (
              <>
                <p className="notice is-green"><Check size={16} /><span><strong>{tried.name}</strong> · prints {automationSummary(cleanAutomation(tried)).prints.join(', ')}</span></p>
                {tried.sticker && (
                  <>
                    <span className="field-label"><Tag size={14} /> Sticker</span>
                    <StickerPreview lines={fillSticker(tried.stickerLines, triedValues)} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {editing && (
        <AutomationDialog
          automation={editing === 'new' ? null : editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
