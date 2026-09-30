# NBLAB Management

A real-time dispatch queue and shift board for the lab, built with **React**, **Vite** and **Firebase**: who is on duty, today's queue, and every open job — on a desk PC, a phone, or a wall display.

## Design System

Warm paper background, near-black ink, and one signal colour — orange — for *now*: the person on duty, the live progress, the primary action. Blue, green and red are kept for status only. Display type is condensed **Archivo**; times and labels are **IBM Plex Mono**, so numbers line up down a column.

All colours are tokens in [`src/index.css`](./src/index.css), with a light theme (default) and a dark one; [`src/App.css`](./src/App.css) holds the components.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#f1efea` | `#111214` |
| Surface | `#ffffff` | `#1a1b1e` |
| Ink | `#18191c` | `#f1efea` |
| Signal | `#f76b15` | `#f76b15` |
| Night (top bar, on-duty card) | `#18191c` | `#0b0b0d` |

The wall display is always dark, whatever the station's theme. Every screen has a phone layout of its own rather than a squeezed desktop one: a title bar with a menu, a folding jobs line, and a sticky *Log a job* / *Edit queue* bar on the queue.

## Key Features

- ⏱️ **Automatic Time Slot Allocation**: Shifts are equally divided among on-duty officers according to daily working schedules (Sunday: 08:00 – 15:30, Monday–Thursday: 08:00 – 16:30, Friday & Saturday: Off).
- 🔔 **Shift-Over Bell Ring Sound**: Synthesizes an authentic service chime using the native **Web Audio API** when an officer's shift concludes or when shifts turn over.
- 🎯 **On Duty Now**: A black card with who is on duty, their window, who is next, and the time they have left.
- 🖥️ **Wall Display**: Always today at the station's site, always dark, readable from across the room — with open jobs along the bottom.
- 🟢 **Live indicator**: The top bar shows *Live* while the board is connected and *Reconnecting* when it is not; editing pauses until it is back.
- 📋 **Jobs**: Assign a job to a worker by type — PC Refresh, OTR, PC Supply, Incident, Quick IT, SSD Upgrade, RAM Upgrade, AV Incident, AV Task. The worker gets a chime and a desktop notification; the job stays across the top of the queue and along the bottom of the wall display until it is marked done.
- 📘 **Work Processes**: Each site's step-by-step guides, written by its admins. Link one to a job type and every new job of that type carries its steps as a checklist — the job can't be closed until every step is ticked.
- 👷 **Accounts Are Workers**: Every account is a worker at its site. Move people between sites permanently, or temporarily until a set day — they return home automatically.
- ✅ **Tap-to-Build Queue**: The queue in running order with each person's window and state (finished, serving, up next, later); everyone else in *Not in queue*. Tap to add or remove, arrows to reorder — no dragging, so it works the same on a phone and the wall PC.
- 🧹 **Daily Reset**: Today's queue empties at midnight, in a server-side transaction. Whichever station is online first performs it; the rest see it as done.
- 🏢 **Multiple Sites**: Each site has its own workers, queue and hours. Accounts belong to one home site; global admins can switch between sites.
- 🌓 **Light & Dark**: Light by default; the choice is remembered per device.

## Tech Stack

- **Framework**: React 19 + Vite
- **Database & Sync**: Google Firebase (Cloud Firestore)
- **Icons**: Lucide React
- **Styling**: Vanilla CSS with design tokens; Archivo and IBM Plex Mono from Google Fonts
- **Audio**: Web Audio API procedural synthesis (zero audio files needed)

## Structure

The app is a small multi-module shell over a **multi-site** Firestore model. Navigation is hash-based (`#/queue`) rather than history-based, because the site is served from a project subpath on GitHub Pages with no server-side rewrite — a deep link to `/dispatch-queue/queue` would 404, while `/dispatch-queue/#/queue` always resolves.

```
src/
  App.jsx                  shell: session + site gating, routing, today vs selected day
  hooks/
    useAuth.js             Firebase Auth session + LIVE profile listener (loading/loaded/missing/error)
    useDispatchQueue.js    one site's workers + board; server-confirmed loading, stale detection, daily reset
    useJobs.js             a site's open jobs, today's done jobs, and the new-job alert
    useProcesses.js        a site's work processes, live
    useHashRoute.js        hash router (no router dependency)
    useMediaQuery.js       phone vs desktop layout
  pages/
    HomePage.jsx           today at the site in one card, then the modules
    QueuePage.jsx          day bar, on duty, the queue, not in queue, jobs done today (desktop + phone)
    ProcessesPage.jsx      the site's work processes: list, steps, notes; admins write them
    SignInPage.jsx         single work-ID field; first-time setup (first global admin + first site)
    SiteSetupPage.jsx      moves a pre-sites database into its first site
    AdminPage.jsx          sites (global); the site's workers — add, role, move, hide, revoke; shift hours
  components/
    AppBar.jsx             top bar: site, tabs, Live, clock, session, theme (phone: title + menu)
    OnDutyCard.jsx         who is on duty and the time left — or why nobody is
    JobsStrip.jsx          open jobs across the top of the queue (phone: one folding line)
    WallDisplay.jsx        wall display — always TODAY at the current site
    HoursDialog.jsx        the week's shift hours; writes only the days that changed
    JobDialog.jsx          log a job: type, worker (on-duty preselected), note; shows the linked process
    JobChecklistDialog.jsx tick a job's process steps, then mark it done
    ProcessDialog.jsx      write or edit a process: title, job type, ordered steps, notes
    MoveDialog.jsx         move a worker to another site, temporarily or for good
    SiteDialog.jsx         create, rename or delete a site (global admins)
    Dialog.jsx, Toast.jsx, ui.jsx   shared pieces
    ConnectionGate.jsx     full-page status: loading, offline, forbidden, account problems
    StaleBanner.jsx        shown only while a loaded board has lost its connection
  services/
    credentials.js         work ID -> Firebase email/password (pure, tested)
    format.js              dates, clock, time left, site labels (pure, tested)
    roles.js               who may do what, who works where today — mirror of the rules (pure, tested)
    queueOps.js            queue list operations by id (pure, tested)
    jobs.js                job types, new-job detection, checklists, who may close a job (pure, tested)
    processes.js           work-process validation, linking to job types (pure, tested)
    notify.js              desktop notifications (browser Notification API)
    schedule.js            shift arithmetic (pure, tested)
    dailyReset.js          daily reset decision (pure, tested)
    authService.js         sign-in, first-time setup, account creation, pre-sites migration
    db.js                  site-scoped Firestore reads and writes
    features.js            the modules the app offers
    firebase.js            app / auth / Firestore bootstrap
    soundEffects.js        Web Audio turnover chimes
tools/
  servicenow-watcher.user.js  lab-PC browser script: notifies on new unassigned ServiceNow tasks (tested)
rules-tests/
  rules.test.mjs           196-case security-rules suite, run in the Firestore emulator
```

```bash
npm test             # 268 assertions on the pure logic, no browser or network
npm run test:rules   # 196 security-rule cases in the local Firestore emulator (needs Java)
```

CI runs `lint` and `test` before every deploy. The rules suite runs locally — it needs Java and the Firebase CLI.

## Local Development

```bash
npm install
npm run dev
```

## Sites, Accounts & Roles 🔑

**Signed out, the app shows a landing page and a sign-in button — nothing else.** Everything about sites, people and the queue sits behind the sign-in.

**Sign-in is one field: the WWID.** Behind it is a real Firebase Email/Password account (`<wwid>@nblab.local`, with a password derived from the WWID), so every station has a real identity that the security rules can check.

**Every account is a worker, and belongs to one home site.** You land on your site automatically — there is no site picker. Each site has its own workers, its own queue and its own shift hours; nothing is shared between sites. The queue draws on the workers at the site *today*.

**Workers can be moved.** A **permanent** move changes their home site. A **temporary** move has a last day: until then the person is fully relocated — they sign in to the other site, see its board and appear only in its queue — and the day after, they are back home automatically, with nothing to undo. The switch is decided by the server clock in the security rules (`request.time`), so it cannot be skipped or forgotten.

| | Member | Site admin | Global admin |
| --- | --- | --- | --- |
| Use the queue, hours and wall display of the site they work at today | ✅ | ✅ | ✅ (any site) |
| Add, rename, hide from the queue and revoke workers | — | ✅ home site, never a global admin | ✅ anyone |
| Move workers to another site, temporarily or permanently | — | ✅ home site's workers | ✅ anyone |
| Create, rename and delete sites; switch between sites | — | — | ✅ |

A site admin keeps administering their **home** site even while temporarily working elsewhere, and administers nothing at the site they are visiting. A permanent move made by a site admin **drops site-admin rights**, so nobody can plant an administrator in someone else's site.

A global admin's chosen site is remembered **per device**, so a wall display signed in with an admin account keeps showing the site it was set to. A wall display is signed in once and stays signed in through reboots.

### First run

On an empty database, the sign-in page becomes **first-time setup**: your name, your WWID and the first site's name. The first global admin, the first site and a `config/bootstrap` marker are written in **one batch** that the rules tie together — setup happens completely or not at all, and closes permanently once it succeeds.

A database from before sites existed is migrated by the **site-setup screen**, shown to its administrator on their next sign-in. It creates the first site and moves every existing account into it as a worker in one batch, keeping the custom shift hours and stripping the plaintext WWIDs those older profiles stored. The old separate people list is not carried over — workers are accounts now.

### Security model

Enforced by [`firestore.rules`](./firestore.rules) and proven by the emulator suite — not by hiding buttons.

- **A token proves nothing.** Firebase Email/Password sign-up is callable by anyone holding the public API key — the app itself relies on it to create accounts. So every read and write requires a **profile** (`users/{uid}`), and only an administrator can create one. A stranger who signs up through the API gets a token and can do nothing with it.
- **Nothing derived from the WWID is stored** — not the WWID, not even a masked hint. An earlier build stored it in plaintext in a collection any token could list, a working route to taking over an administrator account; that is closed. Colleagues can now read each other's profiles (the queue lists them by name), which is why even a hint had to go: two digits of a four-digit WWID would cut guessing to 100 tries.
- **Profiles are visible only within a site.** You can read your own and those of the people working at your site today; site admins read their home site's; global admins read all.
- **Revoking is permanent from the user's side.** Removing a profile ends access immediately, and the person cannot recreate it. Their Firebase sign-in itself survives (deleting another user's sign-in needs the Admin SDK on a server), so the WWID stays taken until you delete it in the Firebase Console.
- **Attribution cannot be forged** — every board write must carry the writer's own uid — and **the daily reset date can only move forward**, so stations with disagreeing clocks cannot reset each other back and forth.

**What remains true:** anyone who *knows* a WWID can sign in as that person. Treat WWIDs like passwords.

## Jobs 📋

Anyone working at a site can log a job and assign it to a worker there today — the worker **on duty** is preselected, since they normally take the next job. There are nine types: PC Refresh, OTR, PC Supply, Incident, Quick IT, SSD Upgrade, RAM Upgrade, AV Incident, AV Task, each with an optional note.

**Until it is marked done, a job stays on screen at the site** — across the top of the Queue page, counted on the Home page's on-duty card, and along the bottom of the wall display. It is closed by the assignee, whoever logged it, or a site administrator. The creator can delete a job logged by mistake while it is still open. A **Done today** list keeps the day's record.

**Alerts:**

| Station | New job alert |
| --- | --- |
| The assignee's | Distinct chime, toast, and a **desktop notification** that stays on screen until dismissed and closes itself when the job is done |
| Everyone else at the site | Soft chime and a toast |
| Whoever logged it | Nothing — they know |

Alerts ring only for jobs that appear while a station is running — never for jobs already open when it starts or reconnects.

**Desktop notifications** use the browser's Notification API: press *Enable desktop alerts* once per browser. They work while the app is open in any tab, even minimised, with no server. They cannot reach a closed browser or a phone — that needs Firebase Cloud Messaging, the paid Blaze plan and a Cloud Function.

**Enforced by the rules:** only the nine types; the assignee must be an account working at the site today; creation time and attribution come from the server and cannot be forged; and the only change a job ever accepts is open → done.

## Work Processes 📘

A **work process** is a site's step-by-step guide for a kind of work — the steps of an SSD upgrade, what to check in a meeting room. Everyone working at the site reads them on the **Processes** page; the site's administrators (and global admins) write, reorder and delete them. Anyone can tick the steps there to follow a process on screen without logging a job — those ticks are not saved.

A process can be **linked to one job type**. From then on, every new job of that type carries a copy of its steps as a checklist:

- The *Log a job* dialog says which process will be attached and how many steps it has.
- The job card shows its progress (`2/6`); opening it lists the steps to tick. The assignee, whoever logged the job, or a site admin can tick them; everyone else can follow along.
- **Done** appears only when every step is ticked. The wall display shows each job's progress too.
- A job keeps the steps it was logged with. Editing or deleting the process later never changes a job already on the board.

**Enforced by the rules:** only a site's admins write its processes; a job's checklist must be an exact copy of one of that site's processes, with nothing ticked; ticking can change nothing else; and a job with unticked steps cannot be closed — not even by an admin.

## ServiceNow watcher (lab PC) 🔔

[`tools/servicenow-watcher.user.js`](./tools/servicenow-watcher.user.js) is a small browser script, separate from the app, that tells you when a **new unassigned task** reaches your group in ServiceNow — a chime plus a desktop notification with the task number, short description, priority and group. Clicking the notification opens the task.

**Nothing leaves the browser.** It reads ServiceNow with the login already open in that browser, only reads, and sends nothing to Firebase or anywhere else. All it keeps, in that browser, is your settings and the ids of tasks it has already announced (so a reload does not repeat them).

**Install**

1. Install the **Tampermonkey** extension in Edge or Chrome (if Intel IT allows it). In recent browsers, also turn on *Allow user scripts* in the extension's details.
2. Tampermonkey → *Create a new script* → paste the whole file → *Save*.
3. If your ServiceNow address does not end in `service-now.com`, add a `// @match https://<your address>/*` line to the header.
4. Open ServiceNow. A small badge appears bottom-left: click it and enter your **assignment group(s)** exactly as named in ServiceNow, and `sc_task` (catalog tasks) or `incident`.
5. Press **Test** on the badge. It checks ServiceNow right away and shows a real notification for the newest waiting task (or says nothing is waiting), with the chime — so access, notifications and sound are all checked in one click. The badge says *Test OK*, or what is wrong.

The badge shows how many unassigned tasks are waiting and when it last checked; clicking it opens that list, ⚙ changes the settings. It checks once a minute. With several ServiceNow tabs open, only one watches. The first check only takes note of tasks already waiting — it announces what arrives after that. If ServiceNow refuses the request (the badge turns red), you were signed out, or your account is not allowed to use ServiceNow's API.

## Firebase 🔥

Firebase is **required** — there is no offline mode and no local copy of the board. A station that cannot reach Firestore shows a blocking status screen until it can; a board that loses its connection after loading shows a *reconnecting* banner and pauses editing, so no station ever writes from a stale copy.

**How the board is written** — the lessons of two data-loss incidents and a review:

- Every queue or hours edit writes **only the day it touches** (field paths), so two stations editing different days can never overwrite each other.
- Adding and removing people uses `arrayUnion` / `arrayRemove`, which commute — concurrent adds to the same day both land.
- The daily reset runs in a **transaction** that re-reads the server copy and touches only today's list. A transaction cannot commit offline or on a stale read, so a laptop waking from sleep cannot push last week's board over today's.
- A snapshot served from the local cache never counts as "loaded".

`localStorage` holds only per-device preferences: the chosen chime, and a global admin's active site.

### Setup

1. **Firebase Console:** create a project, add a **Web app**, enable **Cloud Firestore**, and under *Authentication → Sign-in method* enable **Email/Password**. Leave **Anonymous** disabled.
2. **Local development:** `cp .env.example .env.local` and fill in the six `VITE_FIREBASE_*` values (`.env.local` is gitignored).
3. **GitHub Pages** reads the same values from repository secrets, wired into [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

   ```bash
   gh secret set VITE_FIREBASE_API_KEY
   gh secret set VITE_FIREBASE_AUTH_DOMAIN
   gh secret set VITE_FIREBASE_PROJECT_ID
   gh secret set VITE_FIREBASE_STORAGE_BUCKET
   gh secret set VITE_FIREBASE_MESSAGING_SENDER_ID
   gh secret set VITE_FIREBASE_APP_ID
   ```

4. **Security rules:**

   ```bash
   npm run test:rules    # prove them in the emulator first
   npm run rules:check   # compile against the project without releasing
   npm run rules         # release
   ```

   [`.firebaserc`](./.firebaserc) pins the default project. `firebase-tools` is deliberately not a dependency — CI installs dependencies on every deploy and it is a heavy package — so the scripts resolve it through `npx`.

## Production Build

```bash
npm run build
```

## Deploying to Netlify 🌐

This project includes pre-configured [`netlify.toml`](./netlify.toml) with SPA redirects, caching, and security headers.

### Option 1: Git Continuous Deployment (Recommended)
1. Push your changes to GitHub (`dolev6780/dispatch-queue`).
2. Log in to [Netlify](https://app.netlify.com/) and click **"Add new site"** > **"Import an existing project"**.
3. Choose **GitHub** and select `dispatch-queue`.
4. The build settings will automatically be populated from `netlify.toml` (`npm run build`, publish directory `dist`).
5. Under **Site configuration** > **Environment variables**, set your Firebase variables from `.env.example`. These are required — without them the app cannot sync.
6. Click **Deploy**.

### Option 2: Netlify CLI
```bash
# 1. Log in to your Netlify account
npx netlify login

# 2. Initialize and link site
npx netlify init

# 3. Deploy to production
npx netlify deploy --prod
```

