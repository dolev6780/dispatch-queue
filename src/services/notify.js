/**
 * Desktop (system) notifications for new jobs.
 *
 * Uses the browser Notification API, so it works while the app is open in any
 * tab — even minimised — with no server. It cannot reach a browser that is
 * closed; that would need Firebase Cloud Messaging and a backend.
 *
 * A job notification is created with `requireInteraction`, so it stays on
 * screen until dismissed, and is closed automatically once the job is done.
 */

// Browsers only grant notifications to https pages (and localhost). On the
// main PC's plain-http relay they are simply unavailable.
export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext !== false

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const notificationPermission = () =>
  notificationsSupported() ? window.Notification.permission : 'unsupported'

/** Must be called from a user gesture (a click), or browsers ignore it. */
export const requestNotificationPermission = async () => {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return await window.Notification.requestPermission()
  } catch {
    return window.Notification.permission
  }
}

/** Show one notification; returns it (so it can be closed later) or null. */
export const showDesktopNotification = ({ title, body, tag }) => {
  if (notificationPermission() !== 'granted') return null
  try {
    const notification = new window.Notification(title, { body, tag, requireInteraction: true })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return notification
  } catch {
    // Some browsers only allow notifications from a service worker.
    return null
  }
}
