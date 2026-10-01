/**
 * The AI tech assistant — pure parts, tested.
 *
 * The assistant runs through the main PC's relay (tools/servicenow-relay.mjs),
 * which holds the Gemini key and answers signed-in NBLAB users only. This
 * file shapes what the app sends and reads what comes back; nothing here is
 * stored.
 */
import { jobTypeOf } from './jobs.js'

/** Openers for an empty chat. */
export const SUGGESTIONS = [
  'A laptop will not boot after an SSD swap',
  'BitLocker is asking for a recovery key',
  'The printer shows as offline',
  'The meeting room projector has no signal'
]

/** What the relay needs of each process — nothing more. */
export const processesForAi = (processes) =>
  (processes || []).map(({ title, jobType, steps, notes }) => ({
    title: title || '',
    jobType: jobType || '',
    steps: Array.isArray(steps) ? steps : [],
    notes: notes || ''
  }))

/** What the relay needs of a job — nothing about who logged it or for whom. */
export const jobForAi = (job) => job && {
  type: job.type,
  note: job.note || '',
  processTitle: job.processTitle || '',
  steps: Array.isArray(job.steps) ? job.steps : [],
  checks: Array.isArray(job.checks) ? job.checks : []
}

/** The question a chat about a job starts with — ready for the technician to add to. */
export const jobQuestion = (job) => {
  const label = jobTypeOf(job.type).label
  return job.note
    ? `I'm working on this ${label} job: "${job.note}". What should I check first?`
    : `I'm working on this ${label} job. What should I check first?`
}

/** A short label for the job the chat is about. */
export const jobLabel = (job) => {
  const label = jobTypeOf(job.type).label
  return job.note ? `${label} · ${job.note}` : label
}

// ---- Reading the answer ---------------------------------------------------------
//
// Gemini answers in Markdown. This reads the few kinds the assistant uses —
// paragraphs, headings, bullet and numbered lists, code blocks, **bold** and
// `code` — into plain data the page renders as React elements. No HTML is
// ever injected, so nothing in an answer can run in the page.

const LIST_ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/

/** Markdown text -> blocks: { type: 'p' | 'h' | 'ul' | 'ol' | 'code', ... } */
export const parseMarkdown = (text) => {
  const blocks = []
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  let paragraph = []
  let list = null

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^\s*```/.test(line)) {
      flushParagraph()
      flushList()
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'h', text: heading[1].trim() })
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item) {
      flushParagraph()
      const type = item[1] ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [], ...(type === 'ol' ? { start: Number(item[2]) || 1 } : {}) }
      }
      list.items.push(item[3].trim())
      continue
    }

    // A line under a list item that is not itself an item continues it.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}

/** One line of text -> runs of plain, **bold**, *italic* and `code`. */
export const inlineRuns = (text) => {
  const runs = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*)/g
  let last = 0
  let match
  const source = String(text || '')
  while ((match = pattern.exec(source))) {
    if (match.index > last) runs.push({ type: 'text', text: source.slice(last, match.index) })
    if (match[2] !== undefined) runs.push({ type: 'bold', text: match[2] })
    else if (match[3] !== undefined) runs.push({ type: 'code', text: match[3] })
    else runs.push({ type: 'em', text: match[4] })
    last = match.index + match[0].length
  }
  if (last < source.length) runs.push({ type: 'text', text: source.slice(last) })
  return runs
}
