import {
  LIMITS, OTHER_TYPE, GRAB_AND_GO, GRAB_AND_GO_REVISION, cleanAutomation, cleanPrints, validateAutomation, placeholdersIn,
  unknownPlaceholders, printsSummary, allTypes, allDocuments, revisionOf, agentPayload
} from './automation.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

console.log('--- the built-in automation ---')
eq('Grab & Go files, by their words', GRAB_AND_GO.keywords, ['Grab & Go'])
eq('PC refresh and LDO, then anything else', allTypes(GRAB_AND_GO).map(type => type.name), ['PC refresh', 'LDO', OTHER_TYPE])
eq('PC refresh prints the receipt and the sticker', printsSummary(GRAB_AND_GO.types[0]), ['receipt', 'sticker'])
eq('LDO adds its form', printsSummary(GRAB_AND_GO.types[1]), ['receipt', 'LDO.pdf', 'sticker'])
eq('anything else: the receipt and the sticker', printsSummary(GRAB_AND_GO.other), ['receipt', 'sticker'])
eq('it is sound: every sticker detail is read, the folders are Windows folders', validateAutomation(GRAB_AND_GO), null)
eq('it is already clean', cleanAutomation(GRAB_AND_GO), GRAB_AND_GO)
eq('the folders use each person\'s own', [GRAB_AND_GO.watchFolder, GRAB_AND_GO.filesFolder], ['%USERPROFILE%\\Downloads', '%USERPROFILE%\\Documents\\NBLAB print files'])
eq('it prints by itself', GRAB_AND_GO.autoPrint, true)
eq('its forms', allDocuments(GRAB_AND_GO), ['LDO.pdf'])
eq('its revision: a positive whole number', Number.isInteger(GRAB_AND_GO_REVISION) && GRAB_AND_GO_REVISION > 0, true)
eq('...that changes when it does', revisionOf({ ...GRAB_AND_GO, stickerLines: ['{ticket}'] }) !== GRAB_AND_GO_REVISION, true)
eq('...and not otherwise', revisionOf(JSON.parse(JSON.stringify(GRAB_AND_GO))), GRAB_AND_GO_REVISION)

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
eq('nothing at all prints nothing', cleanPrints(undefined), { receipt: false, receiptCopies: 1, documents: [], sticker: false })

console.log('--- what makes an automation sound ---')
const withTypes = (types) => ({ ...GRAB_AND_GO, types })
eq('needs the Grab & Go words', validateAutomation({ ...GRAB_AND_GO, keywords: [] }), 'Add at least one word every Grab & Go file has.')
eq('every type needs a name', validateAutomation(withTypes([{ name: ' ', keywords: ['x'] }])), 'Give every return type a name.')
eq('every type needs its words', validateAutomation(withTypes([{ name: 'LDO', keywords: [] }])), 'Add the words that show a file is "LDO".')
eq('no two types with one name', validateAutomation(withTypes([{ name: 'LDO', keywords: ['a'] }, { name: 'ldo', keywords: ['b'] }])), 'There are two types named "ldo".')
eq('"anything else" is not added twice', validateAutomation(withTypes([{ name: 'Anything else', keywords: ['a'] }])), '"Anything else" is already there, at the end.')
eq('a sticker needs lines', validateAutomation({ ...GRAB_AND_GO, stickerLines: [] }), 'Write at least one line for the sticker.')
eq('every {placeholder} must be read', validateAutomation({ ...GRAB_AND_GO, stickerLines: ['{serial}'] }), 'The sticker uses {serial}, but no detail is read with that name.')
eq('the built-in details are always there', unknownPlaceholders({ stickerFields: [], stickerLines: ['{type} {file} {date} {time}'] }), [])
eq('placeholders, once each, any case', placeholdersIn(['{A} {a}', '{b}']), ['a', 'b'])
eq('a folder must look like a Windows folder', validateAutomation({ ...GRAB_AND_GO, watchFolder: 'Downloads' }).startsWith('The folder to listen to should look like'), true)

console.log('--- for the agent on this PC ---')
const payload = agentPayload({ ...GRAB_AND_GO, keywords: [' Grab & Go '] }, { revision: GRAB_AND_GO_REVISION, site: { id: 'l12', name: 'L12', extra: 'x' } })
eq('the automation, cleaned', payload.automation.keywords, ['Grab & Go'])
eq('...with its revision and site', [payload.revision, payload.site], [GRAB_AND_GO_REVISION, { id: 'l12', name: 'L12' }])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
