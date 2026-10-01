/**
 * Dispatch automation — pure definitions and logic (no React, no Firebase).
 *
 * An automation says: when a file arrives on a lab PC whose CONTENT holds all
 * these keywords, print the file itself, these documents, and a sticker whose
 * lines are filled with details read from the file. The automation agent on
 * each PC (tools/nblab-automation.ps1) reads them from the website and does
 * the work; matchAutomation, readFields and fillSticker here are its rules,
 * mirrored so the website can try them on pasted text. Keep the two in step.
 */

export const LIMITS = {
  name: 80,
  keywords: 10,
  keyword: 60,
  fileTypes: 10,
  documents: 10,
  file: 120,
  copies: 5,
  stickerLines: 8,
  stickerLine: 80,
  stickerFields: 10,
  label: 60,
  notes: 1000,
  value: 80
}

/** Always available on a sticker, whatever the file holds. */
export const BUILTIN_FIELDS = ['file', 'date', 'time', 'automation']

export const emptyAutomation = () => ({
  name: '',
  enabled: true,
  keywords: [],
  fileTypes: [],
  printFile: true,
  fileCopies: 1,
  documents: [],
  sticker: false,
  stickerLines: [],
  stickerFields: [],
  notes: ''
})

/** "a, b\nc" -> ['a', 'b', 'c'] */
export const splitList = (text) => String(text || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean)

const clampCopies = (value) => Math.min(LIMITS.copies, Math.max(1, Math.round(Number(value) || 1)))
const fieldName = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30)
const unique = (list) => [...new Set(list)]

/** A draft from the editor, trimmed and cut to the limits — what gets saved. */
export const cleanAutomation = (draft) => ({
  name: String(draft.name || '').trim().slice(0, LIMITS.name),
  enabled: draft.enabled !== false,
  keywords: unique((draft.keywords || []).map(word => String(word).trim().slice(0, LIMITS.keyword)).filter(Boolean)).slice(0, LIMITS.keywords),
  fileTypes: unique((draft.fileTypes || []).map(type => String(type).trim().replace(/^\*?\./, '').toLowerCase()).filter(Boolean)).slice(0, LIMITS.fileTypes),
  printFile: !!draft.printFile,
  fileCopies: clampCopies(draft.fileCopies),
  documents: (draft.documents || [])
    .map(doc => ({ file: String(doc.file || '').trim().slice(0, LIMITS.file), copies: clampCopies(doc.copies) }))
    .filter(doc => doc.file)
    .slice(0, LIMITS.documents),
  sticker: !!draft.sticker,
  stickerLines: (draft.stickerLines || []).map(line => String(line).slice(0, LIMITS.stickerLine)).filter(line => line.trim()).slice(0, LIMITS.stickerLines),
  stickerFields: (draft.stickerFields || [])
    .map(field => ({ name: fieldName(field.name), label: String(field.label || '').trim().slice(0, LIMITS.label) }))
    .filter(field => field.name && field.label)
    .slice(0, LIMITS.stickerFields),
  notes: String(draft.notes || '').trim().slice(0, LIMITS.notes)
})

/** {name} placeholders used in sticker lines. */
export const placeholdersIn = (lines) =>
  unique((lines || []).flatMap(line => [...String(line).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1].toLowerCase())))

/** Placeholders a sticker uses that nothing fills. */
export const unknownPlaceholders = (automation) => {
  const known = new Set([...BUILTIN_FIELDS, ...(automation.stickerFields || []).map(field => field.name)])
  return placeholdersIn(automation.stickerLines).filter(name => !known.has(name))
}

/** Check an automation before saving; returns an error message or null. */
export const validateAutomation = (automation) => {
  const a = cleanAutomation(automation)
  if (!a.name) return 'Give the automation a name.'
  if (a.keywords.length === 0) return 'Add at least one word to look for in the file.'
  if (!a.printFile && a.documents.length === 0 && !a.sticker) return 'Choose something to print.'
  if (a.sticker && a.stickerLines.length === 0) return 'Write at least one line for the sticker.'
  const unknown = unknownPlaceholders(a)
  if (unknown.length) return `The sticker uses {${unknown[0]}}, but no detail is read with that name.`
  return null
}

/** What an automation does, in words. */
export const automationSummary = (automation) => ({
  trigger: automation.keywords.map(word => `"${word}"`).join(' and '),
  types: automation.fileTypes.length ? automation.fileTypes.map(type => `.${type}`).join(', ') : 'any file',
  prints: [
    ...(automation.printFile ? [`the downloaded file${automation.fileCopies > 1 ? ` ×${automation.fileCopies}` : ''}`] : []),
    ...automation.documents.map(doc => `${doc.file}${doc.copies > 1 ? ` ×${doc.copies}` : ''}`),
    ...(automation.sticker ? ['a sticker'] : [])
  ]
})

// ---- The agent's rules, mirrored --------------------------------------------------

const extensionOf = (fileName) => {
  const match = /\.([^.\\/]+)$/.exec(String(fileName || ''))
  return match ? match[1].toLowerCase() : ''
}

/**
 * The first enabled automation whose keywords are ALL in the text (any case),
 * and whose file types — if it has any — include the file's.
 */
export const matchAutomation = (text, fileName, automations) => {
  const haystack = String(text || '').toLowerCase()
  const type = extensionOf(fileName)
  return (automations || []).find(automation => {
    if (automation.enabled === false) return false
    const types = automation.fileTypes || []
    if (types.length > 0 && !types.includes(type)) return false
    const words = automation.keywords || []
    return words.length > 0 && words.every(word => haystack.includes(String(word).toLowerCase()))
  }) || null
}

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A detail from the file: what follows its label on the same line.
 *   "Asset tag: NB-1234"      -> NB-1234
 *   "Asset tag,NB-1234,Dana"  -> NB-1234   (CSV: up to the next comma)
 *   "Asset tag\tNB-1234\t…"   -> NB-1234   (tab-separated: up to the next tab)
 */
export const readField = (text, label) => {
  if (!label) return ''
  // Spaces only before the separator, so a tab after the label counts as one.
  const match = new RegExp(`${escapeRegExp(label)} *([:=#-]*) *([,;\\t])?[ \\t]*([^\\n]*)`, 'i').exec(String(text || ''))
  if (!match) return ''
  let value = match[3]
  if (match[2]) value = value.split(match[2])[0]
  return value.trim().replace(/^"(.*)"$/, '$1').trim().slice(0, LIMITS.value)
}

/** Every detail an automation reads, by name. */
export const readFields = (text, fields) =>
  Object.fromEntries((fields || []).map(field => [field.name, readField(text, field.label)]))

/** Sticker lines with {placeholders} filled in; unknown ones are left empty. */
export const fillSticker = (lines, values) =>
  (lines || []).map(line => String(line).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => values[name.toLowerCase()] ?? ''))

/** The built-in details for a file printed at `now`. */
export const builtinValues = ({ fileName, automationName, now }) => {
  const pad = (n) => String(n).padStart(2, '0')
  return {
    file: fileName || '',
    date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    automation: automationName || ''
  }
}

// ---- The site's settings for the lab-PC agents ------------------------------------

/**
 * What every lab PC at the site follows unless it sets its own folders. Paths
 * may use Windows variables, so one value works for everyone: %USERPROFILE% is
 * each person's own folder. The printers are not here: each PC chooses its A4
 * printer and its sticker printer from the printers installed in Windows.
 */
export const AGENT_DEFAULTS = {
  watchFolder: '%USERPROFILE%\\Downloads',
  filesFolder: '%USERPROFILE%\\Documents\\NBLAB print files',
  dryRun: false
}

export const cleanAgentSettings = (draft) => ({
  watchFolder: String(draft?.watchFolder ?? '').trim().slice(0, 260),
  filesFolder: String(draft?.filesFolder ?? '').trim().slice(0, 260),
  dryRun: !!draft?.dryRun
})

const looksLikeWindowsFolder = (path) => /^([a-zA-Z]:\\|\\\\[^\\]+\\|%[A-Za-z_]+%)/.test(path)

/** Check the settings before saving; returns an error message or null. */
export const validateAgentSettings = (draft) => {
  const s = cleanAgentSettings(draft)
  if (!s.watchFolder) return 'Choose the folder to listen to.'
  if (!looksLikeWindowsFolder(s.watchFolder)) return 'The folder to listen to should look like C:\\…, \\\\server\\…, or start with %USERPROFILE%.'
  if (!s.filesFolder) return 'Choose the folder with the files to print.'
  if (!looksLikeWindowsFolder(s.filesFolder)) return 'The folder with the files to print should look like C:\\…, \\\\server\\…, or start with %USERPROFILE%.'
  return null
}
