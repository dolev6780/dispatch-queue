/**
 * Dispatch automation — pure definitions and logic (no React, no Firebase).
 *
 * There is ONE automation, built in, for Grab & Go returns. A file is a Grab &
 * Go file when its CONTENT holds all the automation's words; then its return
 * type is the first type whose words are all in it — PC refresh, LDO — or
 * "anything else". Each type says what to print: the receipt (the downloaded
 * file itself), forms from the PC's files-to-print folder, and a sticker whose
 * lines are filled with details read from the file.
 *
 * The website hands it to the agent on each lab PC
 * (tools/nblab-automation.ps1), which listens to the folder and prints; the
 * matching and reading rules live there, with their tests. To change what is
 * printed, change GRAB_AND_GO below: its revision changes with it, so every
 * agent takes the new one the next time the website is open on its PC.
 */

export const LIMITS = {
  keywords: 10,
  keyword: 60,
  fileTypes: 10,
  types: 8,
  typeName: 40,
  documents: 10,
  file: 120,
  copies: 5,
  stickerLines: 8,
  stickerLine: 80,
  stickerFields: 10,
  label: 60,
  folder: 260
}

/** The type a Grab & Go file gets when no other type's words are in it. */
export const OTHER_TYPE = 'Anything else'

/** Always available on a sticker, whatever the file holds. */
export const BUILTIN_FIELDS = ['type', 'file', 'date', 'time']

const clampCopies = (value) => Math.min(LIMITS.copies, Math.max(1, Math.round(Number(value) || 1)))
const fieldName = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30)
const unique = (list) => [...new Set(list)]
const cleanWords = (list) =>
  unique((list || []).map(word => String(word).trim().slice(0, LIMITS.keyword)).filter(Boolean)).slice(0, LIMITS.keywords)

/** What a type prints: the receipt (the downloaded file), forms, a sticker. */
export const cleanPrints = (prints) => ({
  receipt: !!prints?.receipt,
  receiptCopies: clampCopies(prints?.receiptCopies),
  documents: (prints?.documents || [])
    .map(doc => ({ file: String(doc?.file || '').trim().slice(0, LIMITS.file), copies: clampCopies(doc?.copies) }))
    .filter(doc => doc.file)
    .slice(0, LIMITS.documents),
  sticker: !!prints?.sticker
})

/** The automation trimmed and cut to the limits — what the agents get. */
export const cleanAutomation = (draft) => ({
  keywords: cleanWords(draft?.keywords),
  fileTypes: unique((draft?.fileTypes || []).map(type => String(type).trim().replace(/^\*?\./, '').toLowerCase()).filter(Boolean)).slice(0, LIMITS.fileTypes),
  types: (draft?.types || [])
    .map(type => ({ name: String(type?.name || '').trim().slice(0, LIMITS.typeName), keywords: cleanWords(type?.keywords), ...cleanPrints(type) }))
    .slice(0, LIMITS.types),
  other: cleanPrints(draft?.other),
  stickerFields: (draft?.stickerFields || [])
    .map(field => ({ name: fieldName(field?.name), label: String(field?.label || '').trim().slice(0, LIMITS.label) }))
    .filter(field => field.name && field.label)
    .slice(0, LIMITS.stickerFields),
  stickerLines: (draft?.stickerLines || []).map(line => String(line).slice(0, LIMITS.stickerLine)).filter(line => line.trim()).slice(0, LIMITS.stickerLines),
  watchFolder: String(draft?.watchFolder ?? '').trim().slice(0, LIMITS.folder),
  filesFolder: String(draft?.filesFolder ?? '').trim().slice(0, LIMITS.folder),
  autoPrint: draft?.autoPrint !== false
})

/** {name} placeholders used in sticker lines. */
export const placeholdersIn = (lines) =>
  unique((lines || []).flatMap(line => [...String(line).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1].toLowerCase())))

/** Placeholders the sticker uses that nothing fills. */
export const unknownPlaceholders = (automation) => {
  const known = new Set([...BUILTIN_FIELDS, ...(automation.stickerFields || []).map(field => field.name)])
  return placeholdersIn(automation.stickerLines).filter(name => !known.has(name))
}

const looksLikeWindowsFolder = (path) => /^([a-zA-Z]:\\|\\\\[^\\]+\\|%[A-Za-z_]+%)/.test(path)

/** Is an automation sound? Returns what is wrong, or null. (Guards GRAB_AND_GO in the tests.) */
export const validateAutomation = (draft) => {
  const a = cleanAutomation(draft)
  if (a.keywords.length === 0) return 'Add at least one word every Grab & Go file has.'
  const names = new Set()
  for (const type of a.types) {
    if (!type.name) return 'Give every return type a name.'
    if (type.name.toLowerCase() === OTHER_TYPE.toLowerCase()) return `"${OTHER_TYPE}" is already there, at the end.`
    if (names.has(type.name.toLowerCase())) return `There are two types named "${type.name}".`
    names.add(type.name.toLowerCase())
    if (type.keywords.length === 0) return `Add the words that show a file is "${type.name}".`
  }
  const stickers = [...a.types, a.other].some(prints => prints.sticker)
  if (stickers && a.stickerLines.length === 0) return 'Write at least one line for the sticker.'
  const unknown = unknownPlaceholders(a)
  if (unknown.length) return `The sticker uses {${unknown[0]}}, but no detail is read with that name.`
  if (!looksLikeWindowsFolder(a.watchFolder)) return 'The folder to listen to should look like C:\\…, \\\\server\\…, or start with %USERPROFILE%.'
  if (!looksLikeWindowsFolder(a.filesFolder)) return 'The folder with the files to print should look like C:\\…, \\\\server\\…, or start with %USERPROFILE%.'
  return null
}

/** What a type prints, in words. */
export const printsSummary = (prints) => [
  ...(prints.receipt ? [`receipt${prints.receiptCopies > 1 ? ` ×${prints.receiptCopies}` : ''}`] : []),
  ...prints.documents.map(doc => `${doc.file}${doc.copies > 1 ? ` ×${doc.copies}` : ''}`),
  ...(prints.sticker ? ['sticker'] : [])
]

/** Every type, in the order files are matched, "anything else" last. */
export const allTypes = (automation) => [
  ...automation.types,
  { name: OTHER_TYPE, keywords: [], ...automation.other }
]

/** Every form any type prints, once each. */
export const allDocuments = (automation) =>
  unique(allTypes(automation).flatMap(type => type.documents.map(doc => doc.file)))

/** A number that changes whenever the automation does. */
export const revisionOf = (automation) => {
  let hash = 0
  for (const ch of JSON.stringify(cleanAutomation(automation))) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0
  return Math.abs(hash) || 1
}

/**
 * The automation: Grab & Go files, and what each kind of return prints. The
 * words and details are what the Grab & Go files are expected to hold —
 * check them against a real file.
 */
export const GRAB_AND_GO = cleanAutomation({
  keywords: ['Grab & Go'],
  fileTypes: [],
  types: [
    { name: 'PC refresh', keywords: ['refresh'], receipt: true, receiptCopies: 1, documents: [], sticker: true },
    { name: 'LDO', keywords: ['LDO'], receipt: true, receiptCopies: 1, documents: [{ file: 'LDO.pdf', copies: 1 }], sticker: true }
  ],
  other: { receipt: true, receiptCopies: 1, documents: [], sticker: true },
  stickerFields: [
    { name: 'ticket', label: 'Ticket' },
    { name: 'asset', label: 'Asset tag' },
    { name: 'user', label: 'User' }
  ],
  stickerLines: ['{type}', '{ticket}', 'Asset {asset}', '{user} - {date}'],
  watchFolder: '%USERPROFILE%\\Downloads',
  filesFolder: '%USERPROFILE%\\Documents\\NBLAB print files',
  autoPrint: true
})

export const GRAB_AND_GO_REVISION = revisionOf(GRAB_AND_GO)

/** What the website hands to the agent on this PC. */
export const agentPayload = (automation, { revision, site }) => ({
  automation: cleanAutomation(automation),
  revision: Number(revision) || 0,
  site: { id: site?.id || '', name: site?.name || '' }
})
