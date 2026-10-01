/**
 * The modules the app offers.
 *
 * Defined in code rather than managed from the admin page: each module needs
 * a screen written for it, so a module an administrator could create without
 * one was just an empty tile. Each module's data lives in its own collection
 * under every site: sites/{siteId}/features/{id}/...
 */

export const DISPATCH_QUEUE = 'dispatch-queue'
export const WORK_PROCESSES = 'work-processes'
export const DISPATCH_AUTOMATION = 'dispatch-automation'
export const EMAIL_TEMPLATES = 'email-templates'

export const FEATURES = [
  {
    id: DISPATCH_QUEUE,
    route: 'queue',
    name: 'Dispatch Queue',
    description: 'Build the daily queue, see who is on duty, and drive the wall display.',
    icon: 'list'
  },
  {
    id: WORK_PROCESSES,
    route: 'processes',
    name: 'Work Processes',
    description: 'Step-by-step guides for the lab\'s work. A linked job type turns into a checklist on every job.',
    icon: 'book'
  },
  {
    id: DISPATCH_AUTOMATION,
    route: 'automation',
    name: 'Dispatch Automation',
    description: 'When a Grab & Go file downloads on a lab PC, print what that return needs: the file, its documents and a sticker.',
    icon: 'printer'
  },
  {
    id: EMAIL_TEMPLATES,
    route: 'emails',
    name: 'Email Templates',
    description: 'Emails the site sends often, with blanks to fill in. They open in Outlook ready to send.',
    icon: 'mail'
  }
]
