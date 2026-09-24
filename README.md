# Dispatch Queue HQ 🚨

A real-time dispatch queue and officer shift management application built with **React**, **Vite**, and **Material Design 3** aesthetics, themed as **"Command Cyan"** — deep slate-navy surfaces with an electric cyan/teal accent, styled to read like a live operations console.

## Design System

The entire UI is driven by CSS custom properties in [`src/index.css`](./src/index.css); no color literal appears anywhere in [`src/App.css`](./src/App.css). Retheming the app means editing one token block.

| Role | Dark | Light |
| --- | --- | --- |
| Surface | `#070b11` | `#f4f8fb` |
| Card / container | `#111a24` | `#f1f6fa` |
| Accent (primary) | `#22d3ee` | `#0e7490` |
| Accent (secondary) | `#2dd4bf` | `#0f766e` |
| Body text | `#e9f1f8` | `#0d1b26` |

Both themes are verified against **WCAG AA** (4.5:1 for body text, 3:1 for non-text indicators) — including text on the gradient-filled active row. The light accents sit at cyan-700/teal-700 rather than the more vivid cyan-600, which measured only 3.5:1 on white and failed.

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

