# Dispatch Queue HQ 🚨

A real-time dispatch queue and officer shift management application built with **React**, **Vite**, and **Material Design 3** aesthetics, themed as **"Iris"** — the brand orb's iridescent blue → indigo → fuchsia sweep over deep indigo-black surfaces, styled to read like a live operations console.

## Design System

The entire UI is driven by CSS custom properties in [`src/index.css`](./src/index.css); no color literal appears anywhere in [`src/App.css`](./src/App.css). Retheming the app means editing one token block.

| Role | Dark | Light |
| --- | --- | --- |
| Surface | `#0a0a14` | `#f8f8fe` |
| Card / container | `#18182c` | `#f3f3fb` |
| Accent (primary) | `#818cf8` | `#4f46e5` |
| Accent (secondary) | `#e879f9` | `#a21caf` |
| Body text | `#eceafd` | `#16162e` |

The signature gradient runs the orb's full sweep — `#60a5fa → #818cf8 → #e879f9` in dark, `#4f46e5 → #7c3aed → #a21caf` in light — and carries the brand mark, filled buttons, the active-officer row and the progress bar.

Both themes are verified against **WCAG AA** (4.5:1 for body text, 3:1 for non-text indicators), including text sitting on *every stop* of the gradient-filled active row. The light accents sit at indigo-600/fuchsia-700 rather than the more vivid indigo-500, which measured 4.47:1 on white and just missed.

Beyond color, the theme layer adds glassmorphic surfaces, gradient accents with soft glows, an ambient aurora + grid backdrop, a shimmering progress bar, a breathing glow on the on-duty officer, staggered section entrance motion, tabular-figure alignment on all clock readouts, a consistent keyboard focus ring, and full `prefers-reduced-motion` and print support.

## Key Features

- ⏱️ **Automatic Time Slot Allocation**: Shifts are equally divided among on-duty officers according to daily working schedules (Sunday: 08:00 – 15:30, Monday–Thursday: 08:00 – 16:30, Friday & Saturday: Off).
- 🔔 **Shift-Over Bell Ring Sound**: Synthesizes an authentic service chime using the native **Web Audio API** when an officer's shift concludes or when shifts turn over.
- 🎯 **On-Duty Spotlight Row**: The active serving officer's row fills with the accent gradient and carries a slow breathing glow, while the badge and pills invert so they stay legible against it.
- 🖥️ **Minimal Full Screen Mode**: Distraction-free dashboard for wall-mounted command center displays.
- ✅ **Tap-to-Build Queue**: A single list — queued officers on top with their shift windows, everyone else below. Tap to add or remove, arrows to reorder. No dragging, so it behaves identically on a phone, a tablet and the wall PC.
- 🧹 **Daily Reset**: The queue empties at midnight. Whichever station is open first performs the reset and the rest see it as already done.
- 🌓 **Dark & Light Mode**: Seamless theme toggle; both directions are contrast-audited rather than just inverted.

## Tech Stack

- **Framework**: React 19 + Vite
- **Database & Sync**: Google Firebase (Cloud Firestore)
- **Icons**: Lucide React
- **Styling**: Vanilla CSS with Material Design 3 design tokens (fully tokenized — zero hardcoded colors)
- **Audio**: Web Audio API procedural synthesis (zero audio files needed)

## Structure

The app is a small multi-module shell. Navigation is hash-based (`#/queue`) rather than history-based, because the site is served from a project subpath on GitHub Pages with no server-side rewrite — a deep link to `/dispatch-queue/queue` would 404, while `/dispatch-queue/#/queue` always resolves.

```
src/
  App.jsx                  shell: routing, shared state wiring, dialogs
  hooks/
    useHashRoute.js        two-route hash router (no router dependency)
    useDispatchData.js     synced state, daily reset, day rollover, clock
  pages/
    HomePage.jsx           NBLAB Management landing + module grid
    QueuePage.jsx          today-focused queue management
    SignInPage.jsx         work-ID sign-in + first-run admin bootstrap
    AdminPage.jsx          team, work IDs, shift hours, danger zone
  components/
    AppBar.jsx             brand, nav tabs, sync status, clock, theme
    QueueBuilder.jsx       single-list queue builder
    FullScreenBoard.jsx    wall-mounted display
    DayScheduleDialog.jsx  per-weekday shift hours editor
  services/
    schedule.js            shift arithmetic (pure, tested)
    dailyReset.js          daily reset policy (pure, tested)
    auth.js                work-ID hashing + session (pure, tested)
    firebase.js            Firestore sync + local cache
    soundEffects.js        Web Audio turnover chimes
```

`schedule.js`, `dailyReset.js` and `auth.js` are deliberately free of React and Firebase so the logic that decides *who is on duty*, *when the queue clears* and *who may edit* can be tested directly:

```bash
npm test     # 82 assertions, no browser required
```

CI runs `lint` and `test` before every deploy.

## Local Development

```bash
npm install
npm run dev
```

## Sign-in & Administration 🔑

**Viewing is public; editing needs a work ID.** That split is deliberate — the wall display can sit on the Queue page unattended and survive a reboot without anyone logging it back in.

| | Signed out | Signed in | Administrator |
| --- | --- | --- | --- |
| See the board & full screen | ✅ | ✅ | ✅ |
| Build and reorder the queue | — | ✅ | ✅ |
| Edit shift hours | — | ✅ | ✅ |
| Team, work IDs, danger zone | — | — | ✅ |

### First run

No administrator exists initially, so `#/signin` opens in **first-time setup**: pick your name, choose a work ID, and you become the administrator. This path closes itself the moment an admin exists — which is why there is no default password to forget to change.

> ⚠️ Until someone claims it, **anyone who opens the site can claim the administrator slot.** Do it first, before sharing the URL.

### Work IDs

Set from the admin page. Only a **SHA-256 hash** is stored, never the ID itself, because the shared Firestore document is publicly readable and plaintext IDs would be harvestable by anyone who opened it. IDs therefore cannot be read back — setting one replaces it. Someone with no work ID simply cannot sign in.

### What this does and does not protect

This is a **soft gate plus attribution**: it records who changed the queue and stops passers-by editing the board.

It is **not authentication**. There is no server-side check, so:

- Firestore rules cannot verify a work ID — writes are still open to anyone who talks to the API directly.
- The administrator flag is enforced in the UI only.
- Hashing stops ID harvesting, but a short numeric ID is guessable offline.

If the board ever needs real protection, replace this with Firebase Auth (Google or email/password) and tighten [`firestore.rules`](./firestore.rules) to require `request.auth != null`. The rules file already carries a note on exactly where that line goes.

## Firebase Cloud Sync 🔥

Firebase is **required**. The app is one shared board, so there is no offline-only mode and no in-app configuration screen — a station that is not talking to Firestore is misconfigured, not running a valid alternative. The status chip in the top bar reports `Live` / `Connecting` / `Sync issue` / `Not configured` and is read-only.

Config comes from build-time env vars (`VITE_FIREBASE_*`) and nothing else; see [`src/services/firebase.js`](./src/services/firebase.js).

> `localStorage` is still used, but only as a **cache**: it carries a station through a brief network drop and seeds the first paint. It is not a mode and never diverges from Firestore for long.

### 1. Create the project

In the [Firebase Console](https://console.firebase.google.com/): create a project → add a **Web app** → enable **Cloud Firestore**. Copy the config values from *Project Settings → General → Your apps*.

### 2. Local development

```bash
cp .env.example .env.local   # .env.local is gitignored
# then fill in the six VITE_FIREBASE_* values
```

### 3. Deployed builds

**GitHub Pages** reads the values from repository secrets (wired up in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)). Set them once with the `gh` CLI:

```bash
gh secret set VITE_FIREBASE_API_KEY
gh secret set VITE_FIREBASE_AUTH_DOMAIN
gh secret set VITE_FIREBASE_PROJECT_ID
gh secret set VITE_FIREBASE_STORAGE_BUCKET
gh secret set VITE_FIREBASE_MESSAGING_SENDER_ID
gh secret set VITE_FIREBASE_APP_ID
```

Each command prompts for the value, so nothing lands in your shell history. Or add them under *Settings → Secrets and variables → Actions*. If the secrets are absent the build still succeeds, but the app will show **Not configured** and will not sync.

**Netlify** reads them from *Site configuration → Environment variables*.

### 4. Security rules

Deploy [`firestore.rules`](./firestore.rules) rather than the wide-open `allow read, write: if true`:

```bash
npm run rules:check   # compile the rules without releasing them
npm run rules         # release them
```

[`.firebaserc`](./.firebaserc) pins the default project, so neither command needs `--project`. `firebase-tools` is intentionally **not** a devDependency — CI runs `npm ci` on every deploy and it is a heavy package for something used occasionally, so the scripts resolve it through `npx` instead.

> ⚠️ **The Firebase web config is public by design** — it ships inside the JS bundle, so anyone who opens the deployed site can read it. The supplied rules seal off every path except the single `dispatch_queue/shared_state` document and shape-check the payload, which stops your project being used as free storage. They **cannot** stop an anonymous visitor editing the roster, because the app has no sign-in. If the queue is sensitive, enable **Anonymous Auth + App Check** and require `request.auth != null` in the rules.

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

