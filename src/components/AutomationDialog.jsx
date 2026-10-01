import { useState } from 'react'
import { AlertCircle, Plus, X } from 'lucide-react'
import { Dialog } from './Dialog'
import { BUILTIN_FIELDS, LIMITS, cleanAutomation, emptyAutomation, splitList, validateAutomation } from '../services/automation'

const COPIES = [1, 2, 3, 4, 5]

const CopiesSelect = ({ value, onChange, label }) => (
  <select className="input is-copies" value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label}>
    {COPIES.map(n => <option key={n} value={n}>×{n}</option>)}
  </select>
)

const Switch = ({ on, onChange, label }) => (
  <button type="button" className={`switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} aria-label={label}
    onClick={() => onChange(!on)}>
    <span className="switch-knob" />
  </button>
)

/**
 * Write or edit a dispatch automation: the words that pick it, and what it
 * prints — the downloaded file, documents from the shared folder, and a
 * sticker whose lines are filled with details read from the file.
 */
export const AutomationDialog = ({ automation, onSave, onClose }) => {
  const start = automation || emptyAutomation()
  const [name, setName] = useState(start.name)
  const [enabled, setEnabled] = useState(start.enabled !== false)
  const [keywords, setKeywords] = useState(start.keywords.join('\n'))
  const [fileTypes, setFileTypes] = useState(start.fileTypes.join(', '))
  const [printFile, setPrintFile] = useState(start.printFile)
  const [fileCopies, setFileCopies] = useState(start.fileCopies || 1)
  const [documents, setDocuments] = useState(start.documents.length ? start.documents : [])
  const [sticker, setSticker] = useState(start.sticker)
  const [stickerFields, setStickerFields] = useState(start.stickerFields)
  const [stickerLines, setStickerLines] = useState(start.stickerLines.join('\n'))
  const [notes, setNotes] = useState(start.notes || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const values = () => ({
    name, enabled, printFile, fileCopies, documents, sticker, stickerFields, notes,
    keywords: splitList(keywords),
    fileTypes: splitList(fileTypes),
    stickerLines: stickerLines.split('\n')
  })

  const submit = async (event) => {
    event.preventDefault()
    const problem = validateAutomation(values())
    if (problem) { setError(problem); return }
    setError('')
    setBusy(true)
    try {
      await onSave(cleanAutomation(values()))
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save the automation.')
      setBusy(false)
    }
  }

  const setDocument = (index, patch) => setDocuments(list => list.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)))
  const setField = (index, patch) => setStickerFields(list => list.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  const placeholders = [...BUILTIN_FIELDS, ...stickerFields.map(field => cleanAutomation({ stickerFields: [field] }).stickerFields[0]?.name).filter(Boolean)]

  return (
    <Dialog
      title={automation ? 'Edit automation' : 'New automation'}
      subtitle="The lab PCs use it after you export the automations again."
      onClose={onClose}
      onSubmit={submit}
      wide
      labelId="automation-dialog-title"
      footer={(
        <>
          <label className="dialog-foot-start automation-on">
            <Switch on={enabled} onChange={setEnabled} label="Automation on" />
            <span>{enabled ? 'On' : 'Off'}</span>
          </label>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? 'Saving…' : automation ? 'Save' : 'Create automation'}</button>
        </>
      )}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={name} maxLength={LIMITS.name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Grab & Go return — damaged" autoFocus={!automation} />
      </label>

      <div className="field-pair">
        <label className="field">
          <span className="field-label">Words to find in the file</span>
          <textarea className="input" rows={3} value={keywords} onChange={e => setKeywords(e.target.value)}
            placeholder={'Grab & Go\nDamaged'} />
          <span className="field-hint">One per line. The file must contain all of them; capitals do not matter.</span>
        </label>
        <label className="field">
          <span className="field-label">File types <span className="field-optional">optional</span></span>
          <input className="input" value={fileTypes} onChange={e => setFileTypes(e.target.value)} placeholder="pdf, csv" />
          <span className="field-hint">Leave empty for any file.</span>
        </label>
      </div>

      <div className="field">
        <span className="field-label">Print</span>
        <div className="print-row">
          <Switch on={printFile} onChange={setPrintFile} label="Print the downloaded file" />
          <span className="print-row-name">The downloaded file</span>
          {printFile && <CopiesSelect value={fileCopies} onChange={setFileCopies} label="Copies of the downloaded file" />}
        </div>
        {documents.map((doc, index) => (
          <div key={index} className="print-row">
            <span className="print-row-dot" />
            <input className="input" value={doc.file} maxLength={LIMITS.file} onChange={e => setDocument(index, { file: e.target.value })}
              placeholder="LDO.pdf" aria-label={`Document ${index + 1}`} />
            <CopiesSelect value={doc.copies || 1} onChange={copies => setDocument(index, { copies })} label={`Copies of document ${index + 1}`} />
            <button type="button" className="icon-btn is-sm" onClick={() => setDocuments(list => list.filter((_, i) => i !== index))}
              aria-label={`Remove document ${index + 1}`}><X size={16} /></button>
          </div>
        ))}
        {documents.length < LIMITS.documents && (
          <button type="button" className="btn btn-sm btn-outline print-add" onClick={() => setDocuments(list => [...list, { file: '', copies: 1 }])}>
            <Plus size={14} /><span>Add a document</span>
          </button>
        )}
        <span className="field-hint">Documents are files in the <code>documents</code> folder of the shared folder, by file name.</span>
      </div>

      <div className="field">
        <div className="print-row">
          <Switch on={sticker} onChange={setSticker} label="Print a sticker" />
          <span className="print-row-name">A sticker on the sticker printer</span>
        </div>
        {sticker && (
          <div className="sticker-setup">
            <span className="field-label">Details to read from the file</span>
            {stickerFields.map((field, index) => (
              <div key={index} className="print-row">
                <input className="input is-mono is-short" value={field.name} onChange={e => setField(index, { name: e.target.value })}
                  placeholder="asset" aria-label={`Name of detail ${index + 1}`} />
                <span className="print-row-hint">is what follows</span>
                <input className="input" value={field.label} maxLength={LIMITS.label} onChange={e => setField(index, { label: e.target.value })}
                  placeholder="Asset tag" aria-label={`Text before detail ${index + 1}`} />
                <button type="button" className="icon-btn is-sm" onClick={() => setStickerFields(list => list.filter((_, i) => i !== index))}
                  aria-label={`Remove detail ${index + 1}`}><X size={16} /></button>
              </div>
            ))}
            {stickerFields.length < LIMITS.stickerFields && (
              <button type="button" className="btn btn-sm btn-outline print-add" onClick={() => setStickerFields(list => [...list, { name: '', label: '' }])}>
                <Plus size={14} /><span>Add a detail</span>
              </button>
            )}
            <label className="field">
              <span className="field-label">Sticker lines</span>
              <textarea className="input is-mono" rows={4} value={stickerLines} onChange={e => setStickerLines(e.target.value)}
                placeholder={'{ticket}\nAsset {asset}\n{date} {time}'} />
              <span className="field-hint">
                One line per row. Fill in details with {placeholders.map(p => `{${p}}`).join(' ')}.
              </span>
            </label>
          </div>
        )}
      </div>

      <label className="field">
        <span className="field-label">Notes <span className="field-optional">optional</span></span>
        <textarea className="input" rows={2} value={notes} maxLength={LIMITS.notes} onChange={e => setNotes(e.target.value)} />
      </label>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
