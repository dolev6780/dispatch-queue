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
    AssistantPage.jsx      the AI tech assistant: chat with Gemini through the main PC's relay
    SettingsPage.jsx       this device (theme, chimes, desktop alerts) and the lab-PC tools' setup and status
    AutomationPage.jsx     dispatch automations: what lab PCs print when a Grab & Go file downloads; Try it; export
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
    assistant.js           what the AI assistant sends, and its answers read as Markdown (pure, tested)
    automation.js          dispatch automations: matching, details, stickers, export (pure, tested)
    servicenow.js          the ServiceNow list handed over by the watcher or the relay (pure, tested)
    notify.js              desktop notifications (browser Notification API)
    schedule.js            shift arithmetic (pure, tested)
    dailyReset.js          daily reset decision (pure, tested)
    authService.js         sign-in, first-time setup, account creation, pre-sites migration
    db.js                  site-scoped Firestore reads and writes
    features.js            the modules the app offers
    firebase.js            app / auth / Firestore bootstrap
    soundEffects.js        Web Audio turnover chimes
tools/
  nblab-automation.ps1        lab-PC agent: listens to a folder and to the website on the PC, prints (npm run test:agent);
                              published as one double-click file, nblab-automation.cmd (vite.config.js)
  servicenow-watcher.user.js  lab-PC browser script: notifies on new unassigned ServiceNow tasks (tested)
  servicenow-relay.mjs        main-PC server: shares the unassigned list with the other lab PCs, in memory,
                              and answers the AI assistant with the Gemini key it keeps (tested)
rules-tests/
  rules.test.mjs           222-case security-rules suite, run in the Firestore emulator
```

```bash
npm test             # 458 assertions on the pure logic, no browser or network
npm run test:agent   # 117 cases for the lab-PC automation agent (Windows PowerShell)
npm run test:rules   # 222 security-rule cases in the local Firestore emulator (needs Java)
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

**Nothing leaves the browser.** It reads ServiceNow with the login already open in that browser, only reads, and sends nothing to Firebase or anywhere else. All it keeps, in that browser, is your settings, the ids of tasks it has already announced (so a reload does not repeat them), and the latest list of unassigned tasks for the NBLAB page (below).

**On the NBLAB website, on the same PC.** The script also runs on the NBLAB site, where it hands the latest unassigned tasks — number, short description, priority, time — to the page: a *ServiceNow* strip on the Queue page and a row on the wall display, each task linking back to ServiceNow. The hand-over goes through Tampermonkey's own storage in that browser, never through Firebase, so other stations do not see it. The page keeps the tasks in memory only and accepts nothing but plain text and `https` links from the script (`src/services/servicenow.js`). If the ServiceNow tab is closed, the strip says the watcher is paused after three minutes.

**Install**

1. Install the **Tampermonkey** extension in Edge or Chrome (if Intel IT allows it). In the extension's details, turn on *Allow user scripts* (Chrome) or *Developer mode* (Edge), and set *Site access* to *On all sites*. If ServiceNow still says Tampermonkey has no access, Intel's policy blocks extensions there (`edge://policy` → `runtime_blocked_hosts`).
2. On the app's **Settings** page (⚙ in the top bar), press **Install** under *Lab PC tools* (or open <https://dolev6780.github.io/dispatch-queue/servicenow-watcher.user.js>), then **Install** in Tampermonkey. The site publishes the script next to the app (see `vite.config.js`), and Tampermonkey checks it there for updates, so fixes reach the lab PC by themselves.
3. If your ServiceNow address does not end in `service-now.com`, add a `// @match https://<your address>/*` line to the header.
4. Open ServiceNow. A small badge appears bottom-left: click it and enter your **assignment group(s)** exactly as named in ServiceNow, and `sc_task` (catalog tasks) or `incident`.
5. Press **Test** on the badge. It checks ServiceNow right away and shows a real notification for the newest waiting task (or says nothing is waiting), with the chime — so access, notifications and sound are all checked in one click. The badge says *Test OK*, or what is wrong.

The badge shows how many unassigned tasks are waiting and when it last checked; clicking it opens that list, ⚙ changes the settings. It checks once a minute. With several ServiceNow tabs open, only one watches. The first check only takes note of tasks already waiting — it announces what arrives after that. If ServiceNow refuses the request (the badge turns red), you were signed out, or your account is not allowed to use ServiceNow's API.

### On every lab PC: the relay

Only one PC needs to watch ServiceNow. [`tools/servicenow-relay.mjs`](./tools/servicenow-relay.mjs) is a small server for that **main PC** that shares its unassigned list with the other lab PCs — still without Firebase:

```
node servicenow-relay.mjs                 # port 8787; leave the window open
node servicenow-relay.mjs --site l12      # only people working at site l12 may read
```

- **In memory only.** The watcher on the main PC hands each check to the relay at `http://127.0.0.1:8787`. The relay keeps the latest list in memory — nothing on disk, nothing in Firebase — and it is gone when the window closes. Updates are accepted from the main PC itself only.
- **The other PCs open the app from the main PC** — `http://MAIN-PC:8787/` (the relay prints its addresses) — instead of the GitHub Pages address. The relay serves the live NBLAB app, and the app finds the relay on its own and polls it every 15 seconds. This detour exists because browsers do not let an https page read a plain-http server on another PC.
- **Only NBLAB users can read it.** Each request carries the user's Firebase sign-in token; the relay checks its signature against Google's keys, the project, the expiry, and that the person has an NBLAB profile (read with their own token, as the Firestore rules allow). Anyone else on the network gets nothing.
- **Plain http has two side effects,** handled in the app: the browser's `crypto.subtle` is missing there, so sign-in hashing falls back to a JS SHA-256 (`@noble/hashes`, same result — tested), and desktop notifications are unavailable (browsers allow them only on https).
- **Firewall:** the other PCs can only reach the relay if the main PC's firewall allows incoming connections on port 8787. On a managed PC that may need IT.

The **Settings** page's *Lab PC tools* section has the download and these steps, and its status line says whether this PC gets the list from the watcher in this browser or from the main PC.

## AI tech assistant 🤖

An **Assistant** tab where technicians ask IT and PC questions and get step-by-step answers from **Google Gemini** — in Hebrew or English, whichever they write in. It also:

- **follows your work processes** — with *Use our work processes* on (the default), each question carries the site's processes, so answers follow local procedure and name the process they use;
- **helps on a job** — the ✨ button on a job card (and *Ask AI* in a job's checklist) opens the assistant with that job's type, note and checklist, the question ready to edit;
- **drafts work processes** — *Draft with AI* in the process editor writes the steps from the title (or *Improve with AI* when steps exist), for the admin to edit before saving.

**The key stays on the main PC.** The site is public, so a key in its code could be copied by anyone. Instead the relay holds it: put the key from [aistudio.google.com](https://aistudio.google.com) in a file named `gemini.key` next to `servicenow-relay.mjs` (or in the `GEMINI_API_KEY` environment variable) and restart the relay. The app sends its question to the relay, the relay asks Gemini and returns the answer — the key never reaches a browser. So the assistant is there only on pages opened from the relay's address, and the tab appears only then.

- **Who may ask:** signed-in NBLAB users only (the same token check as the ServiceNow list), each at most 40 times per 10 minutes.
- **What is sent:** the conversation, and — when switched on — the site's process titles, steps and notes, or the job's type, note and checklist. Never names, work IDs or who a job is for. The relay logs only the size of each answer, never its content. The page warns not to paste confidential information, and the conversation is kept nowhere: it is gone on reload or *New chat*.
- **Model:** `gemini-flash-latest` by default, which follows Google's current Flash model; `--model gemini-2.5-flash` picks another. Errors (bad key, unknown model, quota) come back in plain words.
- **Answers** are Markdown rendered as React elements — never as HTML — so nothing in an answer can run in the page; Hebrew answers read right to left.

`gemini.key` is in `.gitignore`.

## Dispatch automation 🖨️

When a worker returns a user's PC through **Grab & Go**, the file the return produces arrives on their lab PC — and that PC prints what that kind of return needs: the **receipt** (the downloaded file itself) and forms like the LDO form on its **A4 printer**, and a sticker with the ticket and asset details on its **sticker printer**.

**The automation is built in** — `GRAB_AND_GO` in [`src/services/automation.js`](./src/services/automation.js); nothing to set up on the site:

- **a Grab & Go file** is one whose *content* holds all of its words (any capitals) — every other file in the folder is left alone;
- **its return type** is the first type whose words are all in it — **PC refresh** (`refresh`), **LDO** (`LDO`) — or **Anything else**;
- **each type prints** the receipt (the downloaded file itself), its forms by name from the files-to-print folder (LDO: `LDO.pdf`), and the sticker — lines with `{placeholders}` filled from **details read from the file** (a detail is what follows its label: `Asset tag: NB-48213` gives `NB-48213`; in CSV or table files, the next cell), plus `{type}`, `{file}`, `{date}`, `{time}`;
- it listens to `%USERPROFILE%\Downloads`, takes forms from `%USERPROFILE%\Documents\NBLAB print files`, and prints by itself.

To change any of it, change `GRAB_AND_GO`: its revision (a hash of it) changes too, and each PC's agent takes the new one the next time the website is open there. Printers are never part of it.

**The page on a lab PC** talks to the agent on that same PC (`http://127.0.0.1:47815`, `src/services/localAgent.js`):

- **This PC** — whether the agent answers, what it listens to, which forms are in its folder, and this PC's **A4 printer** and **sticker printer**, chosen from its Windows printers;
- **Print** — upload a file (or drop it on the card), or pick one the agent handled lately: the page shows its return type (change it if need be), the details read and the sticker, with **Print all**, and **a button for each print** — receipt, sticker, each form. Blank forms have their own buttons.

The page hands the automation to the agent whenever it changes — from any page, on PCs where the agent has answered before; Chrome asks once whether the site may look for devices on the PC (choose *Allow*). A page opened through the relay (plain http) cannot reach the agent.

**The agent** — [`tools/nblab-automation.ps1`](./tools/nblab-automation.ps1), Windows PowerShell, nothing to install — only listens: to the folder, and to the website on the same PC. *Settings → Lab PC tools → Download* gives one file, `nblab-automation.cmd`; double-click it — no window, no sign-in: it runs next to the clock (right-click: the Automation page, the log, the forms, check for updates, stop) and starts with Windows. The first time it opens the Automation page.

1. A file finishes arriving in the folder (`.crdownload` and other partial files are ignored; it waits until the file stops growing).
2. It reads the file's text: text, CSV, HTML, Word, Excel, and PDF (compressed pages and the font maps Windows and browsers use).
3. A Grab & Go file gets its return type and — with automatic printing on — is printed; either way it is listed for the page's *Print* card. A Windows notification says what happened; every run is in the log.
4. The receipt and forms go to the **A4 printer**: PDFs drawn page by page by Windows' own PDF reader (`Windows.Data.Pdf`; no PDF app needed, wide pages print landscape), pictures and text/CSV files by the agent itself, anything else (Word, Excel…) through its app's *print to* command. The sticker is drawn to fit the label on the **sticker printer**.

**Its local door** answers only the NBLAB website's origin (and `localhost` while developing), only on `127.0.0.1`, with CORS and Private Network Access headers: `GET /status`, `POST /setup` (printers, the automation), `POST /read` (an uploaded file, as raw bytes), `GET /plan`, `POST /print` (all, receipt, sticker, or one form; a form never takes a path). Settings, uploads (kept two days) and the log are in `%LOCALAPPDATA%\NBLAB\automation`. Agents 2.x keep their printers when they update; their old sign-in is deleted.

**Updating itself:** a couple of minutes after starting, then twice a day (or *Check for updates*), it fetches `nblab-automation.cmd` from the website. Only a **higher `$AgentVersion`** counts — so raise it with every change to the agent — and only a whole, working copy: it must be the agent, built for the website, and parse as PowerShell without errors. It is saved over the copy that starts with Windows, and the agent restarts on it, with a notice. Agents before 2.2 do not update themselves: download once more.

**Built for downloading:** `vite.config.js` publishes the script as `nblab-automation.cmd` — a few batch lines that run the rest of the same file in PowerShell — with the website's address filled in. The agent is started with no console at all (`CreateNoWindow`), and the Startup shortcut goes through `conhost --headless` — "hidden" windows are ignored when Windows Terminal hosts consoles, the Windows 11 default. One agent runs per Windows user; double-clicking again (or a newer download) quietly takes over. `nblab-automation.cmd -Test "file.pdf"` shows what it reads from a file, its type and what it would print.

## Settings ⚙

The ⚙ button in the top bar (and *Settings* in the phone menu) opens one page for everything that is set up rather than used:

- **This device** — light or dark theme, shift-change and job chimes (with a test), and desktop alerts for new jobs: whether this browser allows them, and an *Enable* button when it has not been asked yet. All remembered per device.
- **Lab PC tools** — the ServiceNow watcher (*Install*), the relay that shares it with every lab PC (*Download relay*), and the AI tech assistant (the Gemini key on the main PC), each with its steps and a status line for this browser.

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

