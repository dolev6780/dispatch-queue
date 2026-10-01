import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Briefcase, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { Eyebrow } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { askAssistant } from '../services/assistantApi'
import { SUGGESTIONS, jobForAi, jobLabel, jobQuestion, processesForAi } from '../services/assistant'

/**
 * The AI tech assistant: a chat with Google Gemini through the main PC's
 * relay, which holds the key. Optionally with the site's work processes, so
 * answers follow local procedure, and with a job, when opened from one.
 *
 * The conversation lives in this page only — it is not saved anywhere, and
 * starts over on reload or with New chat.
 */
export const AssistantPage = ({ available, user, processes, seed, onSeedUsed }) => {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [job, setJob] = useState(null)
  const [withProcesses, setWithProcesses] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  // Opened from a job: start a fresh chat about it, question ready to edit.
  // The seed is taken once and handed back, so a later visit starts clean.
  useEffect(() => {
    if (!seed?.job) return
    /* oxlint-disable-next-line react/set-state-in-effect */
    setMessages([]); setError(''); setJob(seed.job); setDraft(jobQuestion(seed.job))
    onSeedUsed()
    inputRef.current?.focus()
  }, [seed, onSeedUsed])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text) => {
    const question = String(text ?? draft).trim()
    if (!question || busy) return
    const next = [...messages, { role: 'user', text: question }]
    setMessages(next)
    setDraft('')
    setError('')
    setBusy(true)
    try {
      const { text: answer } = await askAssistant({
        user,
        messages: next,
        context: {
          processes: withProcesses ? processesForAi(processes) : [],
          job: jobForAi(job)
        }
      })
      setMessages(current => [...current, { role: 'assistant', text: answer }])
    } catch (err) {
      setError(err.message)
      // Put the question back so it can be sent again.
      setMessages(current => current.slice(0, -1))
      setDraft(question)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const newChat = () => {
    setMessages([])
    setJob(null)
    setDraft('')
    setError('')
    inputRef.current?.focus()
  }

  if (!available) {
    return (
      <div className="page assistant-page">
        <header className="page-head">
          <div className="page-head-text">
            <Eyebrow>AI assistant</Eyebrow>
            <h1 className="display">Tech assistant</h1>
          </div>
        </header>
        <section className="card assistant-off">
          <Sparkles size={22} />
          <p>
            The assistant runs on the <strong>main PC</strong>, which holds the Gemini key. Open the app from the main
            PC&apos;s address (the relay prints it, like <code>http://MAIN-PC:8787</code>) — and the relay there needs a
            Gemini key in a file named <code>gemini.key</code> next to it. See <em>Tools for the lab PC</em> on Home.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="page assistant-page">
      <header className="page-head">
        <div className="page-head-text">
          <Eyebrow>AI assistant · Gemini</Eyebrow>
          <h1 className="display">Tech assistant</h1>
          <p className="page-meta">IT and PC questions, answered step by step</p>
        </div>
        <div className="page-head-actions">
          <label className="assistant-toggle" title="Send this site's work processes with each question, so answers follow them">
            <button type="button" className={`switch ${withProcesses ? 'is-on' : ''}`} role="switch" aria-checked={withProcesses}
              onClick={() => setWithProcesses(on => !on)}>
              <span className="switch-knob" />
            </button>
            <span>Use our work processes{processes.length ? ` (${processes.length})` : ''}</span>
          </label>
          <button className="btn btn-outline" onClick={newChat} disabled={busy || (!messages.length && !job)}>
            <RotateCcw size={15} /><span>New chat</span>
          </button>
        </div>
      </header>

      <p className="notice is-amber">
        <AlertCircle size={16} />
        <span>
          What you write here goes to Google Gemini. Do not paste confidential company information, personal data,
          passwords or work IDs. Check the answers before acting on them.
        </span>
      </p>

      <section className="card chat" aria-live="polite">
        {job && (
          <div className="chat-job">
            <Briefcase size={15} />
            <span>About this job: <strong>{jobLabel(job)}</strong>{job.steps?.length ? ` — with its ${job.steps.length}-step checklist` : ''}</span>
            <button className="icon-btn is-sm" onClick={() => setJob(null)} aria-label="Stop asking about this job"><X size={14} /></button>
          </div>
        )}

        {messages.length === 0 && !busy ? (
          <div className="chat-empty">
            <Sparkles size={22} />
            <p>Ask about a fault, a setup or a job. Try one of these:</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map(text => (
                <button key={text} className="chip" onClick={() => send(text)}>{text}</button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="chat-log">
            {messages.map((message, index) => (
              <li key={index} className={`bubble is-${message.role}`}>
                {message.role === 'assistant' ? <Markdown text={message.text} /> : <p dir="auto">{message.text}</p>}
              </li>
            ))}
            {busy && <li className="bubble is-assistant is-thinking"><span className="dots"><i /><i /><i /></span> Thinking…</li>}
          </ol>
        )}
        <div ref={endRef} />
      </section>

      {error && <p className="alert" role="alert"><AlertCircle size={16} /><span>{error}</span></p>}

      <form className="composer" onSubmit={(event) => { event.preventDefault(); send() }}>
        <textarea
          ref={inputRef}
          className="input"
          rows={2}
          dir="auto"
          value={draft}
          maxLength={4000}
          placeholder="Describe the problem — model, what you see, what you tried…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          <Send size={16} /><span>{busy ? 'Asking…' : 'Ask'}</span>
        </button>
      </form>
    </div>
  )
}
