import { Bell, X } from 'lucide-react'

/** A short notice in the corner: a turnover, a new job, a saved change. */
export const Toast = ({ toast, onClose }) => {
  if (!toast) return null
  return (
    <div className={`toast ${toast.tone ? `is-${toast.tone}` : ''}`} role="alert">
      <span className="toast-icon"><Bell size={18} /></span>
      <div className="toast-body">
        <strong className="toast-title">
          <span>{toast.title}</span>
          <span className="toast-time">{toast.time}</span>
        </strong>
        {toast.message && <p className="toast-text">{toast.message}</p>}
      </div>
      <button className="icon-btn is-sm" onClick={onClose} aria-label="Dismiss"><X size={16} /></button>
    </div>
  )
}
