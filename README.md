# Dispatch Queue HQ 🚨

A real-time dispatch queue and officer shift management application built with **React**, **Vite**, and **Material Design 3 (Material UI)** aesthetics in a refined Blue, White, and Gray color palette.

## Key Features

- ⏱️ **Automatic Time Slot Allocation**: Shifts are equally divided among on-duty officers according to daily working schedules (Sunday: 08:00 – 15:30, Monday–Thursday: 08:00 – 16:30, Friday & Saturday: Off).
- 🔔 **Shift-Over Bell Ring Sound**: Synthesizes an authentic service chime using the native **Web Audio API** when an officer's shift concludes or when shifts turn over.
- 🎯 **On-Duty Inverted Row Styling**: The active serving officer's row dynamically adopts the primary number color while the number badge inverts to the dark container color for clear visibility.
- 🖥️ **Minimal Full Screen Mode**: Distraction-free dashboard for wall-mounted command center displays.
- 🔄 **Drag-and-Drop Roster**: Easily rearrange or reorder officers for the current day's dispatch queue.
- 🌓 **Dark & Light Mode**: Seamless theme toggle preserving high-contrast Material 3 color tokens.

## Tech Stack

- **Framework**: React 19 + Vite
- **Icons**: Lucide React
- **Styling**: Vanilla CSS with Material Design 3 Design Tokens
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
