import { CloudOff } from 'lucide-react'

/**
 * Shown only while a loaded board has lost its connection: what is on screen
 * may be out of date, and editing is paused until the connection returns so
 * that no station writes from a stale copy.
 */
export const StaleBanner = ({ compact = false }) => (
  <div className={`stale ${compact ? 'is-compact' : ''}`} role="status">
    <CloudOff size={compact ? 14 : 16} />
    <span>
      {compact
        ? 'Reconnecting — this board may be out of date'
        : 'Reconnecting. What you see may be out of date, and changes are paused until the connection is back.'}
    </span>
  </div>
)
