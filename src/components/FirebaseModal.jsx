import React, { useState } from 'react'
import {
  Cloud,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Sliders,
  Database,
  ShieldCheck,
  Copy,
  Check
} from 'lucide-react'
import {
  getActiveFirebaseConfig,
  saveCustomFirebaseConfig,
  clearCustomFirebaseConfig,
  CLIENT_ID
} from '../services/firebase'

export function FirebaseModal({ isOpen, onClose, connectionState, onConfigChanged }) {
  const [activeTab, setActiveTab] = useState('status') // 'status' | 'configure'
  const [pasteSnippet, setPasteSnippet] = useState('')
  const [parseError, setParseError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const [form, setForm] = useState(() => {
    const config = getActiveFirebaseConfig()
    return {
      apiKey: config?.apiKey || '',
      authDomain: config?.authDomain || '',
      projectId: config?.projectId || '',
      storageBucket: config?.storageBucket || '',
      messagingSenderId: config?.messagingSenderId || '',
      appId: config?.appId || ''
    }
  })

  if (!isOpen) return null

  // Smart parser for Firebase console snippets
  const handleParseSnippet = (text) => {
    setPasteSnippet(text)
    setParseError('')

    if (!text.trim()) return

    try {
      // Handle standard JSON or JS object notation
      const extract = (key) => {
        const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, 'i')
        const match = text.match(regex)
        return match ? match[1].trim() : ''
      }

      const apiKey = extract('apiKey')
      const projectId = extract('projectId')
      const authDomain = extract('authDomain')
      const storageBucket = extract('storageBucket')
      const messagingSenderId = extract('messagingSenderId')
      const appId = extract('appId')

      if (apiKey || projectId) {
        setForm({
          apiKey: apiKey || form.apiKey,
          authDomain: authDomain || `${projectId}.firebaseapp.com`,
          projectId: projectId || form.projectId,
          storageBucket: storageBucket || `${projectId}.firebasestorage.app`,
          messagingSenderId: messagingSenderId || form.messagingSenderId,
          appId: appId || form.appId
        })
      } else {
        // Try strict JSON parse
        const obj = JSON.parse(text)
        if (obj && (obj.apiKey || obj.projectId)) {
          setForm({
            apiKey: obj.apiKey || '',
            authDomain: obj.authDomain || '',
            projectId: obj.projectId || '',
            storageBucket: obj.storageBucket || '',
            messagingSenderId: obj.messagingSenderId || '',
            appId: obj.appId || ''
          })
        }
      }
    } catch {
      // Don't show hard error while user is actively typing/pasting
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.apiKey.trim() || !form.projectId.trim()) {
      setParseError('API Key and Project ID are required.')
      return
    }

    setIsSaving(true)
    setParseError('')

    try {
      await saveCustomFirebaseConfig({
        apiKey: form.apiKey.trim(),
        authDomain: form.authDomain.trim() || `${form.projectId.trim()}.firebaseapp.com`,
        projectId: form.projectId.trim(),
        storageBucket: form.storageBucket.trim() || `${form.projectId.trim()}.firebasestorage.app`,
        messagingSenderId: form.messagingSenderId.trim(),
        appId: form.appId.trim()
      })

      if (onConfigChanged) onConfigChanged()
      setActiveTab('status')
    } catch (err) {
      setParseError(err.message || 'Failed to initialize Firebase with these credentials.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    try {
      await clearCustomFirebaseConfig()
      setForm({
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
      })
      setPasteSnippet('')
      if (onConfigChanged) onConfigChanged()
      setActiveTab('status')
    } catch (err) {
      setParseError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyStationId = () => {
    navigator.clipboard?.writeText(CLIENT_ID)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  const activeConfig = getActiveFirebaseConfig()

  return (
    <div className="md-modal-backdrop" onClick={onClose}>
      <div
        className="md-modal-content md-firebase-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="md-modal-header">
          <div className="md-modal-title-group">
            <div className="md-modal-icon-badge">
              <Database size={20} color="var(--md-sys-color-primary)" />
            </div>
            <div>
              <h3>Firebase Cloud Synchronization</h3>
              <p>Real-time multi-device sync for Dispatch Queue HQ</p>
            </div>
          </div>
          <button className="md-modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="md-modal-tabs">
          <button
            className={`md-modal-tab ${activeTab === 'status' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            Connection Status
          </button>
          <button
            className={`md-modal-tab ${activeTab === 'configure' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('configure')}
          >
            Settings & Credentials
          </button>
        </div>

        <div className="md-modal-body">
          {activeTab === 'status' ? (
            <div className="md-firebase-status-panel">
              <div className={`md-status-banner md-status-${connectionState.status}`}>
                <div className="md-status-banner-icon">
                  {connectionState.status === 'connected' ? (
                    <CheckCircle2 size={24} color="#10b981" />
                  ) : connectionState.status === 'connecting' ? (
                    <RefreshCw size={24} className="bell-ringing" color="#0284c7" />
                  ) : connectionState.status === 'error' ? (
                    <AlertTriangle size={24} color="#ef4444" />
                  ) : (
                    <CloudOff size={24} color="#f59e0b" />
                  )}
                </div>
                <div className="md-status-banner-text">
                  <h4>
                    {connectionState.status === 'connected' && 'Cloud Firestore Live & Synchronized'}
                    {connectionState.status === 'connecting' && 'Connecting to Firebase Cloud...'}
                    {connectionState.status === 'error' && 'Connection Issue Encountered'}
                    {connectionState.status === 'unconfigured' && 'Local Storage Mode (Stand-alone)'}
                  </h4>
                  <p>
                    {connectionState.status === 'connected' &&
                      'All queue adjustments, officer positions, and schedule hours are syncing in real time across all open tabs and screens.'}
                    {connectionState.status === 'connecting' &&
                      'Establishing secure real-time listener to Firestore document dispatch_queue/shared_state.'}
                    {connectionState.status === 'error' &&
                      (connectionState.error || 'Failed to authenticate or connect to Cloud Firestore. Falling back to local offline cache.')}
                    {connectionState.status === 'unconfigured' &&
                      'Operating locally using browser storage. Changes will persist on this device. Connect Firebase to share live dispatch state with your entire team.'}
                  </p>
                </div>
              </div>

              <div className="md-info-grid">
                <div className="md-info-card">
                  <span className="md-info-label">Active Project</span>
                  <span className="md-info-value">
                    {connectionState.projectId || activeConfig?.projectId || 'None (Local)'}
                  </span>
                </div>

                <div className="md-info-card">
                  <span className="md-info-label">Config Source</span>
                  <span className="md-info-value">
                    {activeConfig?._source === 'env'
                      ? 'Environment (.env.local)'
                      : activeConfig?._source === 'custom'
                      ? 'Browser In-App Storage'
                      : 'Default / Local'}
                  </span>
                </div>

                <div className="md-info-card">
                  <span className="md-info-label">Last Cloud Sync</span>
                  <span className="md-info-value">
                    {connectionState.lastSyncTime
                      ? connectionState.lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                      : 'Not synced yet'}
                  </span>
                </div>

                <div className="md-info-card">
                  <span className="md-info-label">Station Session ID</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                    <span className="md-info-value" style={{ fontFamily: 'var(--md-font-mono)', fontSize: '0.82rem' }}>
                      {CLIENT_ID}
                    </span>
                    <button
                      className="md-icon-btn-micro"
                      onClick={handleCopyStationId}
                      title="Copy station ID"
                    >
                      {copiedId ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="md-modal-actions-bar">
                <button
                  className="md-button md-button-filled"
                  onClick={() => setActiveTab('configure')}
                >
                  <Sliders size={15} />
                  <span>Configure Firebase Project</span>
                </button>
                {activeConfig && (
                  <button
                    className="md-button md-button-tonal"
                    onClick={handleClear}
                    disabled={isSaving}
                  >
                    Switch to Local Mode
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="md-firebase-form">
              {parseError && (
                <div className="md-form-error">
                  <AlertTriangle size={15} />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Quick Paste Snippet Box */}
              <div className="md-form-group">
                <label htmlFor="fb-snippet">
                  <span>Quick Import: Paste Firebase Config Object</span>
                  <span className="md-form-sublabel">
                    From Firebase Console &gt; Project Settings &gt; General &gt; Your apps
                  </span>
                </label>
                <textarea
                  id="fb-snippet"
                  className="md-input-textarea"
                  rows={3}
                  placeholder={`const firebaseConfig = {\n  apiKey: "AIzaSy...",\n  projectId: "dispatch-queue-hq",\n  ...\n};`}
                  value={pasteSnippet}
                  onChange={(e) => handleParseSnippet(e.target.value)}
                />
              </div>

              <div className="md-form-divider">
                <span>Or Enter Manually</span>
              </div>

              <div className="md-form-row">
                <div className="md-form-group">
                  <label htmlFor="fb-project-id">Firebase Project ID *</label>
                  <input
                    id="fb-project-id"
                    type="text"
                    className="md-input"
                    placeholder="e.g. dispatch-queue-hq"
                    value={form.projectId}
                    onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                    required
                  />
                </div>

                <div className="md-form-group">
                  <label htmlFor="fb-api-key">Web API Key *</label>
                  <input
                    id="fb-api-key"
                    type="text"
                    className="md-input"
                    placeholder="AIzaSy..."
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="md-form-row">
                <div className="md-form-group">
                  <label htmlFor="fb-auth-domain">Auth Domain</label>
                  <input
                    id="fb-auth-domain"
                    type="text"
                    className="md-input"
                    placeholder="project-id.firebaseapp.com"
                    value={form.authDomain}
                    onChange={(e) => setForm({ ...form, authDomain: e.target.value })}
                  />
                </div>

                <div className="md-form-group">
                  <label htmlFor="fb-app-id">App ID</label>
                  <input
                    id="fb-app-id"
                    type="text"
                    className="md-input"
                    placeholder="1:123456789:web:abcdef..."
                    value={form.appId}
                    onChange={(e) => setForm({ ...form, appId: e.target.value })}
                  />
                </div>
              </div>

              <div className="md-firestore-hint">
                <ShieldCheck size={16} color="var(--md-sys-color-primary)" />
                <div>
                  <strong>Firestore Rules Note:</strong> Make sure Cloud Firestore is enabled in your project. Deploy the <code>firestore.rules</code> file from this repo rather than opening the database with <code>allow read, write: if true;</code> — it limits access to the single dispatch state document. Note that this config is embedded in the published page, so anyone who opens the site can read it.
                </div>
              </div>

              <div className="md-modal-footer">
                <button
                  type="button"
                  className="md-button md-button-tonal"
                  onClick={() => setActiveTab('status')}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="md-button md-button-filled"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <RefreshCw size={15} className="bell-ringing" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Cloud size={15} />
                      <span>Save &amp; Connect Cloud</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
