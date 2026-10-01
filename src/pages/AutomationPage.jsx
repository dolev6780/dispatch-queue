import { useState } from 'react'
import { AlertCircle, Check, Download, FileText, Monitor, Pencil, Printer, RefreshCw, Tag, Upload } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { GrabAndGoDialog } from '../components/GrabAndGoDialog'
import { loadLegacyAutomation, saveGrabAndGo } from '../services/db'
import { OTHER_TYPE, allDocuments, allTypes, defaultAutomation, fromLegacy, printsSummary } from '../services/automation'
import { siteLabel } from '../services/format'

const AGENT_DOWNLOAD = `${import.meta.env.BASE_URL}nblab-automation.cmd`

const StickerPreview = ({ lines }) => (
  <div className="sticker-preview" aria-label="Sticker">
    {lines.map((line, index) => <span key={index}>{line || ' '}</span>)}
  </div>
)

const timeOf = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** The agent on this PC: is it there, what it listens to, and this PC's two printers. */
const ThisPcCard = ({ agent, automation }) => {
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const info = agent.info

  const choose = async (patch) => {
    setSaving(true)
    setProblem('')
    try {
      await agent.setPrinters({ a4Printer: info.a4Printer || '', stickerPrinter: info.stickerPrinter || '', ...patch })
    } catch (err) {
      setProblem(err?.message || 'The printer was not saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!info) {
    return (
      <section className="card gg-pc" aria-labelledby="pc-title">
        <div className="card-head">
          <h3 id="pc-title" className="card-title"><Monitor size={17} /> This PC</h3>
          {agent.status === 'missing' && (
            <button className="btn btn-sm btn-ghost" onClick={agent.refresh}><RefreshCw size={14} /><span>Look again</span></button>
          )}
        </div>
        {agent.status !== 'missing' ? (
          <p className="card-empty">Looking for the agent on this PC…</p>
        ) : (
          <div className="gg-pc-missing">
            <p>
              No agent answers on this PC. The agent listens to the folder and prints; everything else is on this page.
              Download it and double-click it — no window opens, it runs next to the clock and starts with Windows.
            </p>
            <a className="btn btn-dark" href={AGENT_DOWNLOAD} download="nblab-automation.cmd"><Download size={16} /><span>Download the agent</span></a>
            <p className="field-hint">
              If Chrome asks whether this site may look for devices on this PC, choose <strong>Allow</strong>. Open this page from its
              usual address — a page opened through the main PC&apos;s relay cannot reach the agent.
            </p>
          </div>
        )}
      </section>
    )
  }

  const printers = info.printers || []
  const missing = [!info.a4Printer && 'the A4 printer', !info.stickerPrinter && 'the sticker printer'].filter(Boolean)
  const forms = automation ? allDocuments(automation) : []
  const found = new Set((info.documents || []).map(name => name.toLowerCase()))
  const printerSelect = (key, label) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={info[key] || ''} disabled={saving} onChange={e => choose({ [key]: e.target.value })}>
        <option value="">Choose a printer</option>
        {printers.map(name => <option key={name} value={name}>{name}{name === info.defaultPrinter ? ' (Windows default)' : ''}</option>)}
        {info[key] && !printers.includes(info[key]) && <option value={info[key]}>{info[key]} (not on this PC)</option>}
      </select>
    </label>
  )

  return (
    <section className="card gg-pc" aria-labelledby="pc-title">
      <div className="card-head">
        <h3 id="pc-title" className="card-title"><Monitor size={17} /> This PC</h3>
        <span className="gg-agent"><span className="gg-dot is-on" />Agent {info.version}{info.dryRun ? ' · test run, nothing is printed' : ''}</span>
      </div>
      <div className="field-pair">
        {printerSelect('a4Printer', 'A4 printer')}
        {printerSelect('stickerPrinter', 'Sticker printer')}
      </div>
      {missing.length > 0 && (
        <p className="notice is-amber"><AlertCircle size={16} /><span>Choose {missing.join(' and ')} — nothing prints on paper until then.</span></p>
      )}
      {problem && <p className="alert" role="alert"><AlertCircle size={16} /><span>{problem}</span></p>}
      <dl className="auto-facts">
        <dt>Listening to</dt>
        <dd className="is-mono">{info.watching || '—'}</dd>
        <dt>Files to print in</dt>
        <dd className="is-mono">{info.filesFolder || '—'}</dd>
        {forms.length > 0 && (
          <>
            <dt>Forms</dt>
            <dd className="gg-forms-found">
              {forms.map(file => (
                <span key={file} className={`chip is-static ${found.has(file.toLowerCase()) ? '' : 'is-missing'}`}>
                  {found.has(file.toLowerCase()) ? <Check size={13} /> : <AlertCircle size={13} />} {file}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>When a file arrives</dt>
        <dd>{!automation ? 'Nothing yet — the automation is not set up' : automation.autoPrint ? 'Prints by itself' : 'Waits for you to print here'}</dd>
      </dl>
    </section>
  )
}

/** Print: upload a file or pick one the agent handled; a button for each print. */
const PrintCard = ({ agent, automation }) => {
  const [selected, setSelected] = useState(null) // plan from the agent
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null) // { tone, text }
  const [dragging, setDragging] = useState(false)
  const info = agent.info
  const ready = !!info && !!automation

  const run = async (key, work) => {
    setBusy(key)
    setMessage(null)
    try { await work() } catch (err) { setMessage({ tone: 'error', text: err?.message || 'That did not work.' }) } finally { setBusy('') }
  }

  const upload = (file) => {
    if (!file || !ready) return
    run('read', async () => setSelected(await agent.read(file)))
  }
  const open = (id) => run('read', async () => setSelected(await agent.plan(id)))
  const changeType = (type) => run('read', async () => setSelected(await agent.plan(selected.id, type)))
  const print = (key, request) => run(key, async () => {
    const result = await agent.print(request)
    const done = result.done || []
    const problems = result.problems || []
    const verb = result.dryRun ? 'Would print' : 'Printed'
    setMessage(problems.length
      ? { tone: 'error', text: `${done.length ? `${verb} ${done.join(', ')}. ` : ''}Problem: ${problems.join('; ')}` }
      : { tone: 'ok', text: `${verb} ${done.join(', ') || 'nothing'}.` })
  })

  const recent = info?.recent || []
  const forms = automation ? allDocuments(automation) : []
  const noPaper = !info?.a4Printer || !info?.stickerPrinter
  const typeNames = automation ? allTypes(automation).map(type => type.name) : []

  return (
    <section className={`card gg-print ${dragging ? 'is-dragging' : ''}`} aria-labelledby="print-title"
      onDragOver={e => { if (ready) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]) }}>
      <div className="card-head">
        <h3 id="print-title" className="card-title"><Printer size={17} /> Print</h3>
        <label className={`btn btn-sm btn-outline auto-try-file ${ready ? '' : 'is-disabled'}`}>
          <Upload size={14} /><span>Upload a file</span>
          <input type="file" disabled={!ready} onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      {!info ? (
        <p className="card-empty">Printing needs the agent on this PC (above).</p>
      ) : !automation ? (
        <p className="card-empty">The automation is not set up yet (below).</p>
      ) : (
        <div className="gg-print-grid">
          <div className="gg-recent">
            <span className="field-label">Recent on this PC</span>
            {recent.length === 0 ? (
              <p className="card-empty">Files the agent handles show here. Or upload one — or drop it on this card.</p>
            ) : (
              <ul className="gg-recent-list">
                {recent.map(item => (
                  <li key={item.id}>
                    <button className={`gg-recent-item ${selected?.id === item.id ? 'is-active' : ''}`} onClick={() => open(item.id)}>
                      <span className="gg-recent-name">{item.name}</span>
                      <span className="gg-recent-meta">
                        {timeOf(item.at)} · {item.type || 'not Grab & Go'}
                        {item.status === 'problem' ? ' · problem' : item.status === 'waiting' ? ' · not printed' : item.status === 'printed' ? ' · printed' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="gg-selected">
            {!selected ? (
              <p className="card-empty">{busy === 'read' ? 'Reading the file…' : 'Choose a file to see its type and print it.'}</p>
            ) : (
              <>
                <div className="gg-selected-head">
                  <FileText size={16} />
                  <strong className="gg-selected-name">{selected.name}</strong>
                </div>
                {!selected.isGrabAndGo && (
                  <p className="notice is-amber"><AlertCircle size={16} /><span>This does not look like a Grab &amp; Go file. Choose its type to print it anyway.</span></p>
                )}
                <label className="field gg-type-pick">
                  <span className="field-label">Return type</span>
                  <select className="input" value={selected.type} disabled={!!busy} onChange={e => changeType(e.target.value)}>
                    {typeNames.map(name => (
                      <option key={name} value={name}>{name}{name === selected.detected ? ' (from the file)' : ''}</option>
                    ))}
                  </select>
                </label>
                {selected.values && (
                  <dl className="auto-facts gg-values">
                    {[
                      ...automation.stickerFields.map(field => [field.label, selected.values[field.name]]),
                      ['Date', selected.values.date],
                      ['Time', selected.values.time]
                    ].map(([label, value]) => (
                      <div key={label} className="gg-value"><dt>{label}</dt><dd>{value || '—'}</dd></div>
                    ))}
                  </dl>
                )}
                {selected.sticker && <StickerPreview lines={selected.stickerLines || []} />}
                <div className="gg-buttons">
                  <button className="btn btn-dark" disabled={!!busy || noPaper} onClick={() => print('all', { id: selected.id, type: selected.type, what: 'all' })}>
                    <Printer size={15} /><span>{busy === 'all' ? 'Printing…' : `Print all · ${selected.type}`}</span>
                  </button>
                  <button className="btn btn-outline" disabled={!!busy || !info.a4Printer} onClick={() => print('receipt', { id: selected.id, type: selected.type, what: 'receipt' })}>
                    <FileText size={15} /><span>Receipt</span>
                  </button>
                  <button className="btn btn-outline" disabled={!!busy || !info.stickerPrinter} onClick={() => print('sticker', { id: selected.id, type: selected.type, what: 'sticker' })}>
                    <Tag size={15} /><span>Sticker</span>
                  </button>
                  {(selected.documents || []).map(doc => (
                    <button key={doc.file} className="btn btn-outline" disabled={!!busy || !info.a4Printer}
                      onClick={() => print(`doc:${doc.file}`, { id: selected.id, type: selected.type, what: 'document', file: doc.file })}>
                      <FileText size={15} /><span>{doc.file}{doc.found === false ? ' (missing)' : ''}</span>
                    </button>
                  ))}
                </div>
                <p className="field-hint">
                  {selected.type} prints: {printsSummary({
                    receipt: !!selected.receipt, receiptCopies: selected.receipt?.copies || 1,
                    documents: selected.documents || [], sticker: !!selected.sticker
                  }).join(' · ') || 'nothing'}. Each button prints just that.
                </p>
              </>
            )}
            {message && (
              <p className={message.tone === 'ok' ? 'notice is-green' : 'alert'} role="status">
                {message.tone === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}<span>{message.text}</span>
              </p>
            )}
          </div>
        </div>
      )}
      {ready && forms.length > 0 && (
        <div className="gg-blank">
          <span className="field-label">Blank forms</span>
          <div className="gg-buttons">
            {forms.map(file => (
              <button key={file} className="btn btn-sm btn-outline" disabled={!!busy || !info.a4Printer}
                onClick={() => print(`blank:${file}`, { what: 'document', file })}>
                <FileText size={14} /><span>{file}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** The site's one automation, as it is; admins edit it. */
const AutomationCard = ({ automation, loaded, canEdit, onEdit }) => (
  <section className="card gg-auto" aria-labelledby="auto-title">
    <div className="card-head">
      <h3 id="auto-title" className="card-title">The automation</h3>
      {canEdit && (
        <button className="btn btn-sm btn-outline" onClick={onEdit}><Pencil size={14} /><span>{automation ? 'Edit' : 'Set up'}</span></button>
      )}
    </div>
    {!automation ? (
      <p className="card-empty">
        {!loaded ? 'Loading…' : canEdit ? 'Not set up yet. Set it up: the words that make a file a Grab & Go file, the return types, and what each prints.'
          : 'Not set up yet — your site admin sets it up.'}
      </p>
    ) : (
      <>
        <dl className="auto-facts">
          <dt>A Grab &amp; Go file has</dt>
          <dd className="auto-words">{automation.keywords.map(word => <span key={word} className="chip is-static">{word}</span>)}</dd>
          <dt>Files</dt>
          <dd>{automation.fileTypes.length ? automation.fileTypes.map(type => `.${type}`).join(', ') : 'any file'}</dd>
        </dl>
        <ol className="gg-type-list">
          {allTypes(automation).map(type => (
            <li key={type.name} className="gg-type-card">
              <strong>{type.name}</strong>
              <span className="gg-type-when">
                {type.name === OTHER_TYPE ? 'none of the above' : <>has {type.keywords.map(word => <span key={word} className="chip is-static">{word}</span>)}</>}
              </span>
              <span className="gg-type-prints">{printsSummary(type).join(' · ') || 'prints nothing'}</span>
            </li>
          ))}
        </ol>
        <div className="gg-auto-foot">
          {automation.stickerLines.length > 0 && <StickerPreview lines={automation.stickerLines} />}
          <dl className="auto-facts">
            <dt>Details read</dt>
            <dd>{automation.stickerFields.map(field => `${field.label} → {${field.name}}`).join(', ') || '—'}</dd>
            <dt>Listen to</dt>
            <dd className="is-mono">{automation.watchFolder}</dd>
            <dt>Files to print in</dt>
            <dd className="is-mono">{automation.filesFolder}</dd>
            <dt>When a file arrives</dt>
            <dd>{automation.autoPrint ? 'Print automatically' : 'Wait — print from this page'}</dd>
          </dl>
        </div>
      </>
    )}
  </section>
)

/**
 * Dispatch automation: one automation for Grab & Go returns. The agent on
 * each lab PC listens to the folder; this page sets everything up, chooses
 * this PC's printers, and prints on request.
 */
export const AutomationPage = ({ site, automation, loaded, error, canEdit, uid, agent }) => {
  const [editing, setEditing] = useState(null) // null | { start, isNew }
  const [actionError, setActionError] = useState('')

  const edit = async () => {
    setActionError('')
    if (automation) { setEditing({ start: automation, isNew: false }); return }
    try {
      const legacy = await loadLegacyAutomation(site.id)
      setEditing({ start: fromLegacy(legacy.automations, legacy.agentSettings), isNew: true })
    } catch {
      setEditing({ start: defaultAutomation(), isNew: true })
    }
  }

  return (
    <div className="page auto-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>Dispatch automation · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
          <h1 className="display">Automation</h1>
          <p className="page-meta">Grab &amp; Go returns · the agent on each lab PC listens, this page sets up and prints</p>
        </div>
      </header>

      {(error || actionError) && <p className="alert" role="alert"><AlertCircle size={16} /><span>{actionError || error}</span></p>}

      <ThisPcCard agent={agent} automation={automation} />
      <PrintCard agent={agent} automation={automation} />
      <AutomationCard automation={automation} loaded={loaded} canEdit={canEdit} onEdit={edit} />

      {editing && (
        <GrabAndGoDialog
          automation={editing.start}
          isNew={editing.isNew}
          onSave={values => saveGrabAndGo(site.id, values, uid)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
