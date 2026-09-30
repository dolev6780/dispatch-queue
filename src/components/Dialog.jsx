import { useEffect } from 'react'
import { X } from 'lucide-react'

/**
 * A modal sheet: title, optional subtitle, body, footer. Escape and a click
 * on the backdrop close it.
 */
export const Dialog = ({ title, subtitle, onClose, children, footer, onSubmit, wide = false, labelId }) => {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const id = labelId || 'dialog-title'
  const Body = onSubmit ? 'form' : 'div'

  return (
    <div className="scrim" onClick={onClose}>
      <div className={`dialog ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}
        onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <h2 id={id} className="dialog-title">{title}</h2>
            {subtitle && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <Body className="dialog-body" onSubmit={onSubmit}>
          {children}
          {footer && <div className="dialog-foot">{footer}</div>}
        </Body>
      </div>
    </div>
  )
}
