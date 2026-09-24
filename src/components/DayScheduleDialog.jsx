import { Clock, X, Check, Coffee, AlertCircle, RotateCcw, Sliders } from 'lucide-react'
import {
  SHIFT_PRESETS,
  timeStringToMinutes,
  formatDuration
} from '../services/schedule'

/**
 * Editor for one weekday's shift window: working / not working, start and end
 * time, quick presets, and a live preview of the per-officer slot length.
 */
export const DayScheduleDialog = ({
  dayName,
  form,
  onChange,
  officerCount,
  onSubmit,
  onReset,
  onClose
}) => {
  const startMins = timeStringToMinutes(form.startTime)
  const endMins = timeStringToMinutes(form.endTime)
  const duration = endMins - startMins
  const isInvalid = duration <= 0

  return (
    <div className="md-modal-backdrop" onClick={onClose}>
      <div
        className="md-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-schedule-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="md-dialog-header">
          <div className="md-dialog-title-group">
            <div className="md-dialog-icon">
              <Sliders size={19} />
            </div>
            <div>
              <h3 id="day-schedule-title" className="md-dialog-title">{dayName} hours</h3>
              <p className="md-dialog-subtitle">
                The shift window is split equally between everyone in the queue.
              </p>
            </div>
          </div>
          <button className="md-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="md-dialog-body">
          <div className="md-form-field">
            <label className="md-form-label">Day status</label>
            <div className="md-segmented-control">
              <button
                type="button"
                className={`md-segment-btn ${form.isWorkDay ? 'is-active' : ''}`}
                onClick={() => onChange({ ...form, isWorkDay: true })}
              >
                <Check size={15} />
                <span>Working day</span>
              </button>
              <button
                type="button"
                className={`md-segment-btn ${!form.isWorkDay ? 'is-active is-off' : ''}`}
                onClick={() => onChange({ ...form, isWorkDay: false })}
              >
                <Coffee size={15} />
                <span>Day off</span>
              </button>
            </div>
          </div>

          {form.isWorkDay ? (
            <>
              <div className="md-time-inputs-grid">
                <div className="md-form-field">
                  <label className="md-form-label" htmlFor="start-time-input">Start</label>
                  <div className="md-input-with-icon">
                    <Clock size={16} />
                    <input
                      id="start-time-input"
                      type="time"
                      className="md-input md-time-input"
                      value={form.startTime}
                      onChange={(event) => onChange({ ...form, startTime: event.target.value })}
                    />
                  </div>
                </div>
                <div className="md-form-field">
                  <label className="md-form-label" htmlFor="end-time-input">End</label>
                  <div className="md-input-with-icon">
                    <Clock size={16} />
                    <input
                      id="end-time-input"
                      type="time"
                      className="md-input md-time-input"
                      value={form.endTime}
                      onChange={(event) => onChange({ ...form, endTime: event.target.value })}
                    />
                  </div>
                </div>
              </div>

              {isInvalid ? (
                <div className="md-calc-alert">
                  <AlertCircle size={16} />
                  <span>End time must be after the start time.</span>
                </div>
              ) : (
                <div className="md-calc-card">
                  <div className="md-calc-stat">
                    <span className="md-calc-label">Total shift</span>
                    <strong className="md-calc-value">{formatDuration(duration)}</strong>
                  </div>
                  <div className="md-calc-divider" />
                  <div className="md-calc-stat">
                    <span className="md-calc-label">Each officer</span>
                    <strong className="md-calc-value">
                      {officerCount > 0 ? formatDuration(duration / officerCount) : '—'}
                    </strong>
                    <span className="md-calc-sub">({officerCount} in queue)</span>
                  </div>
                </div>
              )}

              <div className="md-presets-section">
                <span className="md-presets-label">Quick presets</span>
                <div className="md-presets-chips">
                  {SHIFT_PRESETS.map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      className="md-preset-chip"
                      onClick={() => onChange({ ...form, startTime: preset.start, endTime: preset.end })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="md-dialog-off-notice">
              <Coffee size={22} />
              <div>
                <strong>Marked as a day off</strong>
                <p>No shift times are calculated and nobody is scheduled.</p>
              </div>
            </div>
          )}

          <div className="md-dialog-footer">
            <button type="button" className="md-button md-button-text" onClick={onReset}>
              <RotateCcw size={15} />
              <span>Reset to default</span>
            </button>
            <div className="md-dialog-action-buttons">
              <button type="button" className="md-button md-button-tonal" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="md-button md-button-filled"
                disabled={form.isWorkDay && isInvalid}
              >
                <Check size={16} />
                <span>Save</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
