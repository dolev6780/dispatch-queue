import {
  cleanAutomation, validateAutomation, emptyAutomation, splitList, placeholdersIn, unknownPlaceholders,
  automationSummary, matchAutomation, readField, readFields, fillSticker, builtinValues, LIMITS,
  AGENT_DEFAULTS, cleanAgentSettings, validateAgentSettings
} from './automation.js'

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++ } else { fail++ }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`)
}

const base = {
  ...emptyAutomation(),
  name: 'Grab & Go return',
  keywords: ['Grab & Go', 'Return'],
  documents: [{ file: 'LDO.pdf', copies: 1 }],
  sticker: true,
  stickerLines: ['{ticket}', 'Asset {asset}', '{date}'],
  stickerFields: [{ name: 'ticket', label: 'Ticket' }, { name: 'asset', label: 'Asset tag' }]
}

console.log('--- editing ---')
eq('a list from commas and lines', splitList(' a, b\nc ,, '), ['a', 'b', 'c'])
eq('cleaned: trimmed, duplicates dropped, copies clamped', cleanAutomation({
  ...base, name: '  Return  ', keywords: [' Return ', 'Return', ''], fileTypes: ['.PDF', '*.csv', 'pdf'],
  fileCopies: 9, documents: [{ file: ' LDO.pdf ', copies: 0 }, { file: '' }],
  stickerFields: [{ name: 'Asset Tag!', label: ' Asset tag ' }, { name: '', label: 'x' }]
}), {
  name: 'Return', enabled: true, keywords: ['Return'], fileTypes: ['pdf', 'csv'], printFile: true, fileCopies: 5,
  documents: [{ file: 'LDO.pdf', copies: 1 }], sticker: true, stickerLines: ['{ticket}', 'Asset {asset}', '{date}'],
  stickerFields: [{ name: 'assettag', label: 'Asset tag' }], notes: ''
})
eq('a valid automation', validateAutomation(base), null)
eq('needs a name', validateAutomation({ ...base, name: ' ' }), 'Give the automation a name.')
eq('needs a keyword', validateAutomation({ ...base, keywords: [] }), 'Add at least one word to look for in the file.')
eq('needs something to print', validateAutomation({ ...base, printFile: false, documents: [], sticker: false }), 'Choose something to print.')
eq('a sticker needs lines', validateAutomation({ ...base, stickerLines: [] }), 'Write at least one line for the sticker.')
eq('every placeholder must be filled by something', validateAutomation({ ...base, stickerLines: ['{user}'] }),
  'The sticker uses {user}, but no detail is read with that name.')
eq('placeholders in the lines', placeholdersIn(['{ticket} / {Asset}', '{ticket}']), ['ticket', 'asset'])
eq('built-in details count as known', unknownPlaceholders({ stickerLines: ['{date} {time} {file} {automation}'], stickerFields: [] }), [])
eq('in words', automationSummary(cleanAutomation({ ...base, fileCopies: 2 })), {
  trigger: '"Grab & Go" and "Return"', types: 'any file', prints: ['the downloaded file ×2', 'LDO.pdf', 'a sticker']
})

console.log('--- matching a file ---')
const others = [
  { ...cleanAutomation({ ...base, name: 'Off', keywords: ['Return'] }), enabled: false },
  cleanAutomation({ ...base, name: 'CSV only', keywords: ['Return'], fileTypes: ['csv'] }),
  cleanAutomation(base)
]
const text = 'GRAB & GO locker 4\nReturn reason: damaged screen\nTicket: RITM0012345\nAsset tag: NB-48213\n'
eq('all keywords, any case: the first enabled match', matchAutomation(text, 'gg_return.pdf', others).name, 'Grab & Go return')
eq('a file type limit is honoured', matchAutomation(text, 'export.csv', others).name, 'CSV only')
eq('a missing keyword means no match', matchAutomation('Grab & Go pickup', 'a.pdf', others), null)
eq('a disabled automation never matches', matchAutomation('Return', 'a.txt', [others[0]]), null)

console.log('--- reading details ---')
eq('after a label and a colon', readField(text, 'Asset tag'), 'NB-48213')
eq('the label in any case', readField(text, 'ticket'), 'RITM0012345')
eq('up to the end of the line', readField(text, 'Return reason'), 'damaged screen')
eq('CSV: up to the next comma', readField('Asset tag,NB-1,Dana Levi', 'Asset tag'), 'NB-1')
eq('tabs: up to the next tab', readField('Ticket\tRITM9\tOpen', 'Ticket'), 'RITM9')
eq('quotes are dropped', readField('User: "Dana Levi"', 'User'), 'Dana Levi')
eq('a dash or equals sign works too', readField('Asset - NB-7\nSerial = 123', 'Serial'), '123')
eq('a missing label reads nothing', readField(text, 'Serial'), '')
eq('long values are cut', readField(`Note: ${'x'.repeat(200)}`, 'Note').length, LIMITS.value)
eq('every field by name', readFields(text, base.stickerFields), { ticket: 'RITM0012345', asset: 'NB-48213' })

console.log('--- the sticker ---')
const values = { ...readFields(text, base.stickerFields), ...builtinValues({ fileName: 'gg.pdf', automationName: 'Grab & Go return', now: new Date(2026, 9, 1, 9, 5) }) }
eq('lines filled in', fillSticker(base.stickerLines, values), ['RITM0012345', 'Asset NB-48213', '01/10/2026'])
eq('placeholders in any case', fillSticker(['{TICKET}'], values), ['RITM0012345'])
eq('an unknown placeholder is left empty', fillSticker(['[{nothing}]'], values), ['[]'])

console.log('--- the site\'s PC settings ---')
eq('defaults use each person\'s own folders', AGENT_DEFAULTS.watchFolder, '%USERPROFILE%\\Downloads')
eq('cleaned: trimmed, cut, test mode as true/false, never a printer', cleanAgentSettings({ watchFolder: ' C:\\In ', filesFolder: 'x'.repeat(300), stickerPrinter: ' Zebra ', dryRun: 'yes' }),
  { watchFolder: 'C:\\In', filesFolder: 'x'.repeat(260), dryRun: true })
eq('valid with %USERPROFILE%', validateAgentSettings(AGENT_DEFAULTS), null)
eq('valid with a drive and a network share', validateAgentSettings({ watchFolder: 'D:\\GrabGo', filesFolder: '\\\\lab-server\\print' }), null)
eq('needs a folder to listen to', validateAgentSettings({ watchFolder: ' ', filesFolder: 'C:\\x' }), 'Choose the folder to listen to.')
eq('a folder must look like a Windows folder', validateAgentSettings({ watchFolder: 'Downloads', filesFolder: 'C:\\x' }).startsWith('The folder to listen to should look like'), true)
eq('needs the files folder', validateAgentSettings({ watchFolder: 'C:\\x', filesFolder: '' }), 'Choose the folder with the files to print.')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
