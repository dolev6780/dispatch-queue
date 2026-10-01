import { useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Dialog } from './Dialog'
import { Switch } from './ui'
import {
  BUILTIN_FIELDS, LIMITS, OTHER_TYPE, cleanAutomation, noPrints, splitList, validateAutomation
} from '../services/automation'

const COPIES = [1, 2, 3, 4, 5]

const CopiesSelect = ({ value, onChange, label }) => (
  <select className="input is-copies" value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label}>
    {COPIES.map(n => <option key={n} value={n}>×{n}</option>)}
  </select>
)

/** What one return type prints: the receipt (the downloaded file), forms, a sticker. */
const PrintsEditor = ({ prints, onChange, name }) => {
  const set = (patch) => onChange({ ...prints, ...patch })
  const setDocument = (index, patch) => set({ documents: prints.documents.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)) })
  return (
    <div className="gg-prints">
      <div className="print-row">
        <Switch on={prints.receipt} onChange={receipt => set({ receipt })} label={`${name}: print the receipt`} />
        <span className="print-row-name">Receipt <span className="print-row-hint">the downloaded file</span></span>
        {prints.receipt && <CopiesSelect value={prints.receiptCopies} onChange={receiptCopies => set({ receiptCopies })} label={`${name}: copies of the receipt`} />}
      </div>
      {prints.documents.map((doc, index) => (
        <div key={index} className="print-row">
          <span className="print-row-dot" />
          <input className="input" value={doc.file} maxLength={LIMITS.file} onChange={e => setDocument(index, { file: e.target.value })}
            placeholder="LDO.pdf" aria-label={`${name}: form ${index + 1}`} />
          <CopiesSelect value={doc.copies || 1} onChange={copies => setDocument(index, { copies })} label={`${name}: copies of form ${index + 1}`} />
          <button type="button" className="icon-btn is-sm" onClick={() => set({ documents: prints.documents.filter((_, i) => i !== index) })}
            aria-label={`${name}: remove form ${index + 1}`}><X size={16} /></button>
        </div>
      ))}
      {prints.documents.length < LIMITS.documents && (
        <button type="button" className="btn btn-sm btn-ghost print-add" onClick={() => set({ documents: [...prints.documents, { file: '', copies: 1 }] })}>
          <Plus size={14} /><span>Add a form</span>
        </button>
      )}
      <div className="print-row">
        <Switch on={prints.sticker} onChange={sticker => set({ sticker })} label={`${name}: print the sticker`} />
        <span className="print-row-name">Sticker</span>
      </div>
    </div>
  )
}

const toDraft = (automation) => ({
  ...automation,
  keywords: automation.keywords.join('\n'),
  fileTypes: automation.fileTypes.join(', '),
  types: automation.types.map(type => ({ ...type, keywords: type.keywords.join(', ') })),
  stickerLines: automation.stickerLines.join('\n')
})

const fromDraft = (draft) => ({
  ...draft,
  keywords: splitList(draft.keywords),
  fileTypes: splitList(draft.fileTypes),
  types: draft.types.map(type => ({ ...type, keywords: splitList(type.keywords) })),
  stickerLines: draft.stickerLines.split('\n')
})

/**
 * Edit the site's one automation: what makes a file a Grab & Go file, its
 * return types in the order they are tried and what each prints, the sticker,
 * the folders, and automatic printing.
 */
export const GrabAndGoDialog = ({ automation, isNew, onSave, onClose }) => {
  const [draft, setDraft] = useState(() => toDraft(cleanAutomation(automation)))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (patch) => setDraft(current => ({ ...current, ...patch }))
  const setType = (index, patch) => set({ types: draft.types.map((type, i) => (i === index ? { ...type, ...patch } : type)) })
  const moveType = (index, by) => {
    const types = [...draft.types]
    const [moved] = types.splice(index, 1)
    types.splice(index + by, 0, moved)
    set({ types })
  }
  const setField = (index, patch) => set({ stickerFields: draft.stickerFields.map((field, i) => (i === index ? { ...field, ...patch } : field)) })
  const placeholders = [...BUILTIN_FIELDS, ...draft.stickerFields.map(field => cleanAutomation({ stickerFields: [field] }).stickerFields[0]?.name).filter(Boolean)]

  const submit = async (event) => {
    event.preventDefault()
    const values = fromDraft(draft)
    const problem = validateAutomation(values)
    if (problem) { setError(problem); return }
    setError('')
    setBusy(true)
    try {
      await onSave(cleanAutomation(values))
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save the automation.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={isNew ? 'Set up the automation' : 'Edit the automation'}
      subtitle="Every lab PC with the agent takes the change within a minute."
      onClose={onClose}
      onSubmit={submit}
      wide
      labelId="gg-dialog-title"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <section className="gg-section">
        <h3 className="gg-section-title">Grab &amp; Go files</h3>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">Words every Grab &amp; Go file has</span>
            <textarea className="input" rows={2} value={draft.keywords} onChange={e => set({ keywords: e.target.value })} placeholder="Grab & Go" />
            <span className="field-hint">One per line; all of them, any capitals. Other files in the folder are left alone.</span>
          </label>
          <label className="field">
            <span className="field-label">File types <span className="field-optional">optional</span></span>
            <input className="input" value={draft.fileTypes} onChange={e => set({ fileTypes: e.target.value })} placeholder="pdf" />
            <span className="field-hint">Leave empty for any file.</span>
          </label>
        </div>
      </section>

      <section className="gg-section">
        <h3 className="gg-section-title">Return types</h3>
        <p className="field-hint">Tried from the top: the first whose words are all in the file is the return type.</p>
        <div className="gg-types">
          {draft.types.map((type, index) => (
            <div key={index} className="gg-type">
              <div className="gg-type-head">
                <input className="input gg-type-name" value={type.name} maxLength={LIMITS.typeName} onChange={e => setType(index, { name: e.target.value })}
                  placeholder="PC refresh" aria-label={`Name of type ${index + 1}`} />
                <button type="button" className="icon-btn is-sm" disabled={index === 0} onClick={() => moveType(index, -1)} aria-label={`Move ${type.name || 'type'} up`}><ArrowUp size={15} /></button>
                <button type="button" className="icon-btn is-sm" disabled={index === draft.types.length - 1} onClick={() => moveType(index, 1)} aria-label={`Move ${type.name || 'type'} down`}><ArrowDown size={15} /></button>
                <button type="button" className="icon-btn is-sm is-danger-soft" onClick={() => set({ types: draft.types.filter((_, i) => i !== index) })}
                  aria-label={`Remove ${type.name || 'type'}`}><X size={15} /></button>
              </div>
              <label className="field">
                <span className="field-label">When the file also contains</span>
                <input className="input" value={type.keywords} onChange={e => setType(index, { keywords: e.target.value })}
                  placeholder="refresh" aria-label={`Words for ${type.name || `type ${index + 1}`}`} />
              </label>
              <PrintsEditor prints={type} name={type.name || `type ${index + 1}`} onChange={prints => setType(index, prints)} />
            </div>
          ))}
          <div className="gg-type is-other">
            <div className="gg-type-head"><strong className="gg-type-fixed">{OTHER_TYPE}</strong></div>
            <p className="field-hint">A Grab &amp; Go file that is none of the above.</p>
            <PrintsEditor prints={draft.other} name={OTHER_TYPE} onChange={other => set({ other })} />
          </div>
        </div>
        {draft.types.length < LIMITS.types && (
          <button type="button" className="btn btn-sm btn-outline print-add"
            onClick={() => set({ types: [...draft.types, { name: '', keywords: '', ...noPrints(), receipt: true, sticker: true }] })}>
            <Plus size={14} /><span>Add a return type</span>
          </button>
        )}
      </section>

      <section className="gg-section">
        <h3 className="gg-section-title">Sticker</h3>
        <span className="field-label">Details to read from the file</span>
        {draft.stickerFields.map((field, index) => (
          <div key={index} className="print-row">
            <input className="input is-mono is-short" value={field.name} onChange={e => setField(index, { name: e.target.value })}
              placeholder="asset" aria-label={`Name of detail ${index + 1}`} />
            <span className="print-row-hint">is what follows</span>
            <input className="input" value={field.label} maxLength={LIMITS.label} onChange={e => setField(index, { label: e.target.value })}
              placeholder="Asset tag" aria-label={`Text before detail ${index + 1}`} />
            <button type="button" className="icon-btn is-sm" onClick={() => set({ stickerFields: draft.stickerFields.filter((_, i) => i !== index) })}
              aria-label={`Remove detail ${index + 1}`}><X size={16} /></button>
          </div>
        ))}
        {draft.stickerFields.length < LIMITS.stickerFields && (
          <button type="button" className="btn btn-sm btn-ghost print-add" onClick={() => set({ stickerFields: [...draft.stickerFields, { name: '', label: '' }] })}>
            <Plus size={14} /><span>Add a detail</span>
          </button>
        )}
        <label className="field">
          <span className="field-label">Sticker lines</span>
          <textarea className="input is-mono" rows={4} value={draft.stickerLines} onChange={e => set({ stickerLines: e.target.value })}
            placeholder={'{type}\n{ticket}\nAsset {asset}'} />
          <span className="field-hint">One line per row. Fill in details with {placeholders.map(p => `{${p}}`).join(' ')}.</span>
        </label>
      </section>

      <section className="gg-section">
        <h3 className="gg-section-title">Folders and printing</h3>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">Folder to listen to</span>
            <input className="input is-mono" value={draft.watchFolder} maxLength={LIMITS.folder} onChange={e => set({ watchFolder: e.target.value })} spellCheck={false} />
            <span className="field-hint">Where the Grab &amp; Go files arrive. <code>%USERPROFILE%</code> is each person&apos;s own folder.</span>
          </label>
          <label className="field">
            <span className="field-label">Files to print are in</span>
            <input className="input is-mono" value={draft.filesFolder} maxLength={LIMITS.folder} onChange={e => set({ filesFolder: e.target.value })} spellCheck={false} />
            <span className="field-hint">The forms, by the names above. A network share works too.</span>
          </label>
        </div>
        <div className="print-row">
          <Switch on={draft.autoPrint} onChange={autoPrint => set({ autoPrint })} label="Print automatically" />
          <span className="print-row-name">
            {draft.autoPrint ? 'Print automatically when a Grab & Go file arrives' : 'Wait: print from this page only'}
          </span>
        </div>
      </section>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}
    </Dialog>
  )
}
