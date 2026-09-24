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
- 🔄 **Drag-and-Drop Roster**: Easily rearrange or reorder officers for the current day's dispatch queue.
- 🌓 **Dark & Light Mode**: Seamless theme toggle; both directions are contrast-audited rather than just inverted.

## Tech Stack

- **Framework**: React 19 + Vite
- **Database & Sync**: Google Firebase (Cloud Firestore)
- **Icons**: Lucide React
- **Styling**: Vanilla CSS with Material Design 3 design tokens (fully tokenized — zero hardcoded colors)
- **Audio**: Web Audio API procedural synthesis (zero audio files needed)

## Local Development

```bash
npm install
npm run dev
```

## Firebase Cloud Sync 🔥

Sync is **optional**. With no configuration the app runs in **Local Mode**, persisting to `localStorage` — fully functional, just not shared between stations. Configure Firebase and every station sees the same queue in real time.

Config is resolved in [`src/services/firebase.js`](./src/services/firebase.js) in this order:

1. **Custom config in `localStorage`** — pasted through the in-app Firebase modal (click the status chip in the top bar). Per-browser, good for a quick trial.
2. **Build-time env vars** — `VITE_FIREBASE_*`. This is what you want for a real deployment.

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

Each command prompts for the value, so nothing lands in your shell history. Or add them under *Settings → Secrets and variables → Actions*. If the secrets are absent the build still succeeds and the app just starts in Local Mode.

**Netlify** reads them from *Site configuration → Environment variables*.

### 4. Security rules

Deploy [`firestore.rules`](./firestore.rules) rather than the wide-open `allow read, write: if true`:

```bash
firebase deploy --only firestore:rules
```

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
5. Under **Site configuration** > **Environment variables**, optionally set your Firebase variables from `.env.example`.
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

