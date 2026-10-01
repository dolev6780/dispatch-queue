import { useState } from 'react'
import { AlertCircle, Check, Download, Monitor, RefreshCw } from 'lucide-react'
import { allDocuments } from '../services/automation'

const AGENT_DOWNLOAD = `${import.meta.env.BASE_URL}nblab-automation.cmd`

/**
 * The automation agent on this PC: is it there, what it listens to, the forms
 * in its folder, and this PC's two printers — chosen from its Windows printers.
 */
export const ThisPcCard = ({ agent, automation }) => {
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
              No agent answers on this PC. The agent listens to the folder Grab &amp; Go files arrive in and prints them.
              Download it and double-click it — no window opens, it runs next to the clock and starts with Windows.
            </p>
            <a className="btn btn-dark" href={AGENT_DOWNLOAD} download="nblab-automation.cmd"><Download size={16} /><span>Download the agent</span></a>
            <p className="field-hint">
              If Chrome asks whether this site may look for devices on this PC, choose <strong>Allow</strong>. Open the website from its
              usual address — a page opened through the main PC&apos;s relay cannot reach the agent.
            </p>
          </div>
        )}
      </section>
    )
  }

  const printers = info.printers || []
  const missing = [!info.a4Printer && 'the A4 printer', !info.stickerPrinter && 'the sticker printer'].filter(Boolean)
  const forms = allDocuments(automation)
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
        <dd>{automation.autoPrint ? 'Prints by itself' : 'Waits to be printed from the Automation page'}</dd>
      </dl>
    </section>
  )
}
