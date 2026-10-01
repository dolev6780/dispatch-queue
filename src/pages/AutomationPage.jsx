import { useState } from 'react'
import { AlertCircle, Check, FileText, Printer, Settings, Tag, Upload } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { allDocuments, allTypes, printsSummary } from '../services/automation'
import { siteLabel } from '../services/format'

const StickerPreview = ({ lines }) => (
  <div className="sticker-preview" aria-label="Sticker">
    {lines.map((line, index) => <span key={index}>{line || ' '}</span>)}
  </div>
)

const timeOf = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Print: upload a file or pick one the agent handled; a button for each print. */
const PrintCard = ({ agent, automation, onOpenSettings }) => {
  const [selected, setSelected] = useState(null) // plan from the agent
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null) // { tone, text }
  const [dragging, setDragging] = useState(false)
  const info = agent.info
  const ready = !!info

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
  const forms = allDocuments(automation)
  const noPaper = !info?.a4Printer || !info?.stickerPrinter

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
        <div className="gg-needs">
          <p className="card-empty">
            {agent.status === 'missing' ? 'Printing needs the automation agent on this PC.' : 'Looking for the agent on this PC…'}
          </p>
          {agent.status === 'missing' && (
            <button className="btn btn-sm btn-outline" onClick={onOpenSettings}><Settings size={14} /><span>Set it up in Settings</span></button>
          )}
        </div>
      ) : (
        <>
        {noPaper && (
          <p className="notice is-amber">
            <AlertCircle size={16} />
            <span>Choose this PC&apos;s {[!info.a4Printer && 'A4 printer', !info.stickerPrinter && 'sticker printer'].filter(Boolean).join(' and ')} in Settings — nothing prints on paper until then.</span>
            <button className="btn btn-sm btn-ghost" onClick={onOpenSettings}>Settings</button>
          </p>
        )}
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
                  <span className="gg-type-badge">{selected.type}</span>
                </div>
                {!selected.isGrabAndGo && (
                  <p className="notice is-amber"><AlertCircle size={16} /><span>This does not look like a Grab &amp; Go file — it prints as {selected.type}.</span></p>
                )}
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
        </>
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

/**
 * Dispatch automation for Grab & Go returns. The agent on each lab PC listens
 * to the folder and prints by itself; this page prints a file — or any part
 * of it — on request. This PC's agent and printers are in Settings.
 */
export const AutomationPage = ({ site, automation, agent, onOpenSettings }) => (
  <div className="page auto-page">
    <header className="page-head">
      <div className="page-head-text">
        <Eyebrow>Dispatch automation · {siteLabel(site).replace(' · ', ' ')}</Eyebrow>
        <h1 className="display">Automation</h1>
        <p className="page-meta">Grab &amp; Go returns · {allTypes(automation).map(type => type.name).join(', ')}</p>
      </div>
    </header>

    <PrintCard agent={agent} automation={automation} onOpenSettings={onOpenSettings} />
  </div>
)
