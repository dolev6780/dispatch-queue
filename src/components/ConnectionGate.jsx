import { CloudOff, RefreshCw, AlertCircle } from 'lucide-react'

/**
 * Blocks the app until the shared board has actually loaded.
 *
 * The board runs on Firestore alone — there is no local copy to fall back on.
 * That makes this screen important rather than cosmetic: without it, a
 * disconnected station would render an empty roster, and on the wall display
 * "not loaded yet" and "the queue is genuinely empty" look identical.
 */
export const ConnectionGate = ({ status, error, onRetry }) => {
  const isConnecting = status === 'connecting' || status === 'connected'
  const isUnconfigured = status === 'unconfigured'

  return (
    <div className="md-gate">
      <div className={`md-gate-icon ${isConnecting ? 'is-working' : 'is-error'}`}>
        {isConnecting ? (
          <RefreshCw size={30} className="bell-ringing" />
        ) : isUnconfigured ? (
          <AlertCircle size={30} />
        ) : (
          <CloudOff size={30} />
        )}
      </div>

      <h2 className="md-gate-title">
        {isConnecting
          ? 'Loading the board…'
          : isUnconfigured
            ? 'Not configured'
            : 'Cannot reach the board'}
      </h2>

      <p className="md-gate-text">
        {isConnecting
          ? 'Connecting to the shared dispatch board.'
          : isUnconfigured
            ? 'This build is missing its Firebase configuration, so there is no board to connect to.'
            : 'The dispatch queue lives in the cloud and there is no offline copy, so nothing can be shown until the connection is back.'}
      </p>

      {error && !isConnecting && <p className="md-gate-detail">{error}</p>}

      {!isConnecting && (
        <button className="md-button md-button-filled" onClick={onRetry}>
          <RefreshCw size={16} />
          <span>Try again</span>
        </button>
      )}
    </div>
  )
}
