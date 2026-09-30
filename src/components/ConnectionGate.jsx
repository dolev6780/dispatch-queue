import { AlertCircle, CloudOff, Lock, RefreshCw, UserX } from 'lucide-react'

const ICONS = {
  working: RefreshCw,
  offline: CloudOff,
  error: AlertCircle,
  forbidden: Lock,
  account: UserX
}

/**
 * Full-page status: loading, disconnected, not permitted, or an account
 * problem.
 *
 * Every action carries its own label. The previous version reused one screen
 * for all of these, so an access-denied message claimed the board was
 * unreachable, and a button labelled "Try again" actually signed the station
 * out — which is how a rebooting wall display got stranded.
 */
export const ConnectionGate = ({ kind = 'working', title, message, detail, actions = [] }) => {
  const Icon = ICONS[kind] || AlertCircle
  const isWorking = kind === 'working'

  return (
    <div className={`gate is-${kind}`} role={isWorking ? 'status' : 'alert'}>
      <span className="gate-icon"><Icon size={26} className={isWorking ? 'spin' : undefined} /></span>
      <h2 className="gate-title">{title}</h2>
      {message && <p className="gate-text">{message}</p>}
      {detail && <p className="gate-detail">{detail}</p>}
      {actions.length > 0 && (
        <div className="gate-actions">
          {actions.map(action => (
            <button key={action.label} className={`btn ${action.primary ? 'btn-dark' : 'btn-outline'}`} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
