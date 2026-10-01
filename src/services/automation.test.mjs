import {
  LIMITS, OTHER_TYPE, defaultAutomation, splitList, cleanAutomation, cleanPrints, validateAutomation, placeholdersIn,
  unknownPlaceholders, printsSummary, allTypes, allDocuments, isUseful, fromLegacy, agentPayload, noPrints
} from './automation.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const start = defaultAutomation()

console.log('--- where a site starts ---')
eq('Grab & Go files, by their words', start.keywords, ['Grab & Go'])
eq('PC refresh and LDO, then anything else', allTypes(start).map(type => type.name), ['PC refresh', 'LDO', OTHER_TYPE])
eq('LDO prints its form', start.types[1].documents, [{ file: 'LDO.pdf', copies: 1 }])
eq('it is valid as it is', validateAutomation(start), null)
eq('it prints something', isUseful(start), true)
eq('the folders use each person\'s own', [start.watchFolder, start.filesFolder], ['%USERPROFILE%\\Downloads', '%USERPROFILE%\\Documents\\NBLAB print files'])
eq('automatic printing is on', start.autoPrint, true)

console.log('--- cleaning ---')
const messy = cleanAutomation({
  keywords: [' Grab & Go ', 'Grab & Go', '', 'x'.repeat(80)],
  fileTypes: ['.PDF', '*.txt', 'pdf', ' '],
  types: [{ name: '  PC refresh ', keywords: ['refresh', ' '], receipt: 1, receiptCopies: 9, documents: [{ file: ' LDO.pdf ', copies: 0 }, { file: ' ' }], sticker: 'yes' }],
  other: { receipt: false, documents: [], sticker: false },
  stickerFields: [{ name: 'Asset Tag!', label: ' Asset tag ' }, { name: '', label: 'x' }],
  stickerLines: ['{type}', '   ', '{asset}'],
  watchFolder: ' C:\\In ',
  filesFolder: 'D:\\Forms',
  autoPrint: undefined
})
eq('words trimmed, once each, cut', messy.keywords, ['Grab & Go', 'x'.repeat(LIMITS.keyword)])
eq('file types without dots, lower case, once each', messy.fileTypes, ['pdf', 'txt'])
eq('a type: trimmed name and words', [messy.types[0].name, messy.types[0].keywords], ['PC refresh', ['refresh']])
eq('a type: copies kept within 1-5, empty forms dropped', [messy.types[0].receiptCopies, messy.types[0].documents], [5, [{ file: 'LDO.pdf', copies: 1 }]])
eq('a type: switches as true/false', [messy.types[0].receipt, messy.types[0].sticker], [true, true])
eq('detail names made safe', messy.stickerFields, [{ name: 'assettag', label: 'Asset tag' }])
eq('empty sticker lines dropped', messy.stickerLines, ['{type}', '{asset}'])
eq('folders trimmed', [messy.watchFolder, messy.filesFolder], ['C:\\In', 'D:\\Forms'])
eq('automatic printing on unless turned off', [messy.autoPrint, cleanAutomation({ autoPrint: false }).autoPrint], [true, false])
eq('no more than the limit of types', cleanAutomation({ types: Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, keywords: ['w'] })) }).types.length, LIMITS.types)
eq('nothing at all prints nothing', cleanPrints(undefined), noPrints())
eq('splitting a list', splitList('a, b\nc,,'), ['a', 'b', 'c'])

console.log('--- checking before saving ---')
const withTypes = (types, extra) => ({ ...start, types, ...extra })
eq('needs the Grab & Go words', validateAutomation({ ...start, keywords: [] }), 'Add at least one word every Grab & Go file has.')
eq('every type needs a name', validateAutomation(withTypes([{ name: ' ', keywords: ['x'] }])), 'Give every return type a name.')
eq('every type needs its words', validateAutomation(withTypes([{ name: 'LDO', keywords: [] }])), 'Add the words that show a file is "LDO".')
eq('no two types with one name', validateAutomation(withTypes([{ name: 'LDO', keywords: ['a'] }, { name: 'ldo', keywords: ['b'] }])), 'There are two types named "ldo".')
eq('"anything else" is not added twice', validateAutomation(withTypes([{ name: 'Anything else', keywords: ['a'] }])), '"Anything else" is already there, at the end.')
eq('a sticker needs lines', validateAutomation({ ...start, stickerLines: [] }), 'Write at least one line for the sticker.')
eq('no sticker anywhere: no lines needed', validateAutomation({ ...start, stickerLines: [], types: [], other: { receipt: true } }), null)
eq('every {placeholder} must be read', validateAutomation({ ...start, stickerLines: ['{serial}'] }), 'The sticker uses {serial}, but no detail is read with that name.')
eq('the built-in details are always there', unknownPlaceholders({ stickerFields: [], stickerLines: ['{type} {file} {date} {time}'] }), [])
eq('placeholders, once each, any case', placeholdersIn(['{A} {a}', '{b}']), ['a', 'b'])
eq('a folder must look like a Windows folder', validateAutomation({ ...start, watchFolder: 'Downloads' }).startsWith('The folder to listen to should look like'), true)
eq('a network share works', validateAutomation({ ...start, filesFolder: '\\\\lab-server\\print' }), null)
eq('only types with nothing to print: not useful', isUseful({ ...start, types: [], other: noPrints() }), false)

console.log('--- in words ---')
eq('what a type prints', printsSummary(cleanPrints({ receipt: true, receiptCopies: 2, documents: [{ file: 'LDO.pdf', copies: 1 }], sticker: true })), ['receipt ×2', 'LDO.pdf', 'sticker'])
eq('every form, once', allDocuments({ ...start, other: { ...start.other, documents: [{ file: 'LDO.pdf', copies: 2 }, { file: 'Receipt.pdf', copies: 1 }] } }), ['LDO.pdf', 'Receipt.pdf'])

console.log('--- from the automations made before ---')
const legacy = fromLegacy([
  { name: 'Refresh', keywords: ['Grab & Go', 'refresh'], printFile: true, fileCopies: 2, documents: [], sticker: true, stickerLines: ['{ticket}'], stickerFields: [{ name: 'ticket', label: 'Ticket' }] },
  { name: 'LDO return', keywords: ['Grab & Go', 'LDO'], printFile: false, fileCopies: 1, documents: [{ file: 'LDO.pdf', copies: 1 }], sticker: false }
], { watchFolder: 'D:\\GG', filesFolder: '', dryRun: true })
eq('the words they share say it is a Grab & Go file', legacy.keywords, ['Grab & Go'])
eq('each becomes a type, with its own words', legacy.types.map(type => [type.name, type.keywords]), [['Refresh', ['refresh']], ['LDO return', ['LDO']]])
eq('...printing what it printed', [legacy.types[0].receipt, legacy.types[0].receiptCopies, legacy.types[1].documents], [true, 2, [{ file: 'LDO.pdf', copies: 1 }]])
eq('the sticker carries over', [legacy.stickerLines, legacy.stickerFields], [['{ticket}'], [{ name: 'ticket', label: 'Ticket' }]])
eq('the folders carry over; test mode means no automatic printing', [legacy.watchFolder, legacy.filesFolder, legacy.autoPrint], ['D:\\GG', start.filesFolder, false])
eq('nothing before: the usual start', fromLegacy([], null), start)

console.log('--- for the agent on this PC ---')
const payload = agentPayload({ ...start, keywords: [' Grab & Go '] }, { revision: 1717171717000, site: { id: 'l12', name: 'L12', extra: 'x' } })
eq('the automation, cleaned', payload.automation.keywords, ['Grab & Go'])
eq('...with its revision and site', [payload.revision, payload.site], [1717171717000, { id: 'l12', name: 'L12' }])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
