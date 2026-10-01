import { inlineRuns, parseMarkdown } from '../services/assistant'

const Inline = ({ text }) => inlineRuns(text).map((run, index) => {
  if (run.type === 'bold') return <strong key={index}>{run.text}</strong>
  if (run.type === 'code') return <code key={index}>{run.text}</code>
  if (run.type === 'em') return <em key={index}>{run.text}</em>
  return <span key={index}>{run.text}</span>
})

/**
 * An assistant answer. Built from parsed blocks as React elements — never as
 * HTML — so nothing in an answer can run in the page. `dir="auto"` lets a
 * Hebrew answer read right to left.
 */
export const Markdown = ({ text }) => (
  <div className="md" dir="auto">
    {parseMarkdown(text).map((block, index) => {
      switch (block.type) {
        case 'h':
          return <p key={index} className="md-h"><Inline text={block.text} /></p>
        case 'ul':
          return <ul key={index}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>
        case 'ol':
          return <ol key={index} start={block.start}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ol>
        case 'code':
          return <pre key={index} dir="ltr"><code>{block.text}</code></pre>
        default:
          return <p key={index}><Inline text={block.text} /></p>
      }
    })}
  </div>
)
