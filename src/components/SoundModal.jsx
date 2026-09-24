import React from 'react'
import { Volume2, Play, Check, X } from 'lucide-react'
import { SOUND_PROFILES, playShiftSound } from '../services/soundEffects'

export function SoundModal({
  isOpen,
  onClose,
  selectedSoundId,
  onSelectSound
}) {
  if (!isOpen) return null

  const handlePreview = (e, soundId) => {
    e.stopPropagation()
    playShiftSound(soundId)
  }

  const handleSelect = (soundId) => {
    onSelectSound(soundId)
    playShiftSound(soundId)
  }

  return (
    <div className="md-modal-backdrop" onClick={onClose}>
      <div
        className="md-dialog md-sound-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sound-modal-title"
      >
        {/* Modal Header */}
        <div className="md-dialog-header">
          <div className="md-dialog-title-group">
            <div className="md-dialog-icon">
              <Volume2 size={20} />
            </div>
            <div>
              <h3 id="sound-modal-title" className="md-dialog-title">Shift Turnover Sound</h3>
              <p className="md-dialog-subtitle">Alert sound played when workers replace & shifts rotate</p>
            </div>
          </div>
          <button
            className="md-modal-close-btn"
            onClick={onClose}
            aria-label="Close sound settings"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Sound Options List */}
        <div className="md-sound-list">
          {SOUND_PROFILES.map((profile) => {
            const isSelected = profile.id === selectedSoundId
            return (
              <div
                key={profile.id}
                className={`md-sound-option ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelect(profile.id)}
              >
                <div className="md-sound-radio">
                  {isSelected && <Check size={14} strokeWidth={3} />}
                </div>

                <div className="md-sound-info">
                  <div className="md-sound-header">
                    <span className="md-sound-name">{profile.name}</span>
                    {profile.tag && (
                      <span className={`md-sound-tag tag-${profile.id}`}>
                        {profile.tag}
                      </span>
                    )}
                  </div>
                  <p className="md-sound-desc">{profile.description}</p>
                </div>

                <button
                  type="button"
                  className="md-sound-preview-btn"
                  onClick={(e) => handlePreview(e, profile.id)}
                  title={`Preview ${profile.name}`}
                  aria-label={`Preview ${profile.name}`}
                >
                  <Play size={13} fill="currentColor" />
                  <span>Test</span>
                </button>
              </div>
            )
          })}
        </div>

        {/* Modal Footer */}
        <div className="md-sound-footer">
          <button
            type="button"
            className="md-button md-button-filled"
            onClick={onClose}
          >
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  )
}
