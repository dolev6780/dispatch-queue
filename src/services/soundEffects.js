/**
 * Dispatch HQ — Turn-Over Sound Synthesizer (Web Audio API)
 * Provides high-fidelity, zero-dependency sound effects for shift rotations.
 */

const STORAGE_KEY = 'dispatch_shift_sound'

export const SOUND_PROFILES = [
  {
    id: 'dispatch_chime',
    name: 'Modern Dispatch Chime',
    description: 'Crisp two-tone airport / command center announcement chime (Default)',
    tag: 'Recommended'
  },
  {
    id: 'marimba',
    name: 'Soft Wooden Marimba',
    description: 'Warm, organic 3-note ascending chord (low listening fatigue)',
    tag: 'Gentle'
  },
  {
    id: 'digital_radar',
    name: 'Command Radar Pulse',
    description: 'High-tech telemetry radio chirp signaling officer handoff',
    tag: 'High-Tech'
  },
  {
    id: 'desk_bell',
    name: 'Classic Brass Bell',
    description: 'Authentic metallic service desk bell with long shimmer',
    tag: 'Classic'
  },
  {
    id: 'subtle_blip',
    name: 'Subtle Double Blip',
    description: 'Soft and discreet double pulse, non-disruptive in shared offices',
    tag: 'Minimal'
  }
]

let sharedAudioCtx = null

const getAudioContext = () => {
  try {
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return null
      sharedAudioCtx = new AudioCtx()
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume()
    }
    return sharedAudioCtx
  } catch (err) {
    console.warn('AudioContext initialization failed:', err)
    return null
  }
}

/**
 * Play a synthesized tone with customizable frequency, envelope, and harmonics.
 */
const playTone = (ctx, {
  freq = 440,
  startTime = 0,
  duration = 1.0,
  attack = 0.012,
  decay = 0.8,
  gainLevel = 0.3,
  type = 'sine',
  overtones = []
}) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)

  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(gainLevel, startTime + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decay)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(startTime)
  osc.stop(startTime + duration)

  // Render harmonic overtones if requested
  overtones.forEach(ot => {
    const otOsc = ctx.createOscillator()
    const otGain = ctx.createGain()
    otOsc.type = ot.type || 'sine'
    otOsc.frequency.setValueAtTime(freq * ot.mult, startTime)

    otGain.gain.setValueAtTime(0.0001, startTime)
    otGain.gain.exponentialRampToValueAtTime(gainLevel * (ot.gainRatio || 0.25), startTime + (ot.attack || attack))
    otGain.gain.exponentialRampToValueAtTime(0.0001, startTime + (ot.decay || decay * 0.7))

    otOsc.connect(otGain)
    otGain.connect(ctx.destination)

    otOsc.start(startTime)
    otOsc.stop(startTime + duration)
  })
}

/**
 * Sound synthesis algorithms
 */
const soundSynthesizers = {
  // 1. Modern Dispatch Chime (F5 -> C5 HQ announcement chime)
  dispatch_chime: (ctx, now) => {
    // Note 1: F5 (698.46 Hz)
    playTone(ctx, {
      freq: 698.46,
      startTime: now,
      duration: 1.4,
      attack: 0.015,
      decay: 1.1,
      gainLevel: 0.35,
      type: 'sine',
      overtones: [
        { mult: 2.0, gainRatio: 0.25, decay: 0.6 },
        { mult: 3.0, gainRatio: 0.12, decay: 0.4 }
      ]
    })

    // Note 2: C5 (523.25 Hz)
    playTone(ctx, {
      freq: 523.25,
      startTime: now + 0.28,
      duration: 1.8,
      attack: 0.015,
      decay: 1.6,
      gainLevel: 0.38,
      type: 'sine',
      overtones: [
        { mult: 2.0, gainRatio: 0.28, decay: 0.9 },
        { mult: 3.0, gainRatio: 0.15, decay: 0.5 }
      ]
    })
  },

  // 2. Soft Wooden Marimba (E4 -> A4 -> C#5 warm arpeggio)
  marimba: (ctx, now) => {
    const notes = [
      { freq: 329.63, delay: 0.0 },   // E4
      { freq: 440.00, delay: 0.11 },  // A4
      { freq: 554.37, delay: 0.22 }   // C#5
    ]

    notes.forEach(n => {
      playTone(ctx, {
        freq: n.freq,
        startTime: now + n.delay,
        duration: 0.9,
        attack: 0.005, // Fast mallet strike
        decay: 0.65,
        gainLevel: 0.32,
        type: 'sine',
        overtones: [
          // Woody transient pop
          { mult: 3.8, gainRatio: 0.35, attack: 0.003, decay: 0.06 }
        ]
      })
    })
  },

  // 3. Command Radar Pulse (Dual high-tech telemetry chirp)
  digital_radar: (ctx, now) => {
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(1046.5, now)
    osc1.frequency.exponentialRampToValueAtTime(1567.98, now + 0.09)

    gain1.gain.setValueAtTime(0.0001, now)
    gain1.gain.exponentialRampToValueAtTime(0.28, now + 0.01)
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Second chirp higher octave
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1318.5, now + 0.14)
    osc2.frequency.exponentialRampToValueAtTime(2093.0, now + 0.24)

    gain2.gain.setValueAtTime(0.0001, now + 0.14)
    gain2.gain.exponentialRampToValueAtTime(0.3, now + 0.15)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.14)
    osc2.stop(now + 0.4)
  },

  // 4. Classic Brass Bell (Authentic high metallic ding)
  desk_bell: (ctx, now) => {
    playTone(ctx, {
      freq: 1174.66, // D6
      startTime: now,
      duration: 2.2,
      attack: 0.008,
      decay: 2.0,
      gainLevel: 0.36,
      type: 'sine',
      overtones: [
        { mult: 2.76, gainRatio: 0.45, decay: 1.2 },
        { mult: 5.4, gainRatio: 0.22, decay: 0.5 },
        { mult: 0.5, gainRatio: 0.2, decay: 1.6 }
      ]
    })
  },

  // 5. Subtle Double Blip (Quiet, office-friendly dual pip)
  subtle_blip: (ctx, now) => {
    playTone(ctx, {
      freq: 784, // G5
      startTime: now,
      duration: 0.1,
      attack: 0.008,
      decay: 0.08,
      gainLevel: 0.2,
      type: 'sine'
    })

    playTone(ctx, {
      freq: 1046.5, // C6
      startTime: now + 0.09,
      duration: 0.14,
      attack: 0.008,
      decay: 0.11,
      gainLevel: 0.22,
      type: 'sine'
    })
  }
}

/**
 * Play shift turn-over sound by sound ID
 */
export const playShiftSound = (soundId) => {
  const ctx = getAudioContext()
  if (!ctx) return

  const effectiveId = soundId || getSavedSoundChoice()
  const synth = soundSynthesizers[effectiveId] || soundSynthesizers.dispatch_chime

  synth(ctx, ctx.currentTime)
}

/**
 * Local storage management for selected sound
 */
export const getSavedSoundChoice = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && soundSynthesizers[saved]) {
      return saved
    }
  } catch {
    // fallback
  }
  return 'dispatch_chime'
}

export const saveSoundChoice = (soundId) => {
  try {
    if (soundSynthesizers[soundId]) {
      localStorage.setItem(STORAGE_KEY, soundId)
    }
  } catch {
    // fallback
  }
}
