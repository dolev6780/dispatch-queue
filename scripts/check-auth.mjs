/**
 * Reports whether Anonymous sign-in is enabled on the Firebase project.
 *
 * Run this BEFORE flipping signedIn() in firestore.rules to
 * `request.auth != null`. If anonymous auth is not enabled and the rules
 * require it, every station loses the ability to write and the board freezes.
 *
 *   npm run auth:check
 *
 * Exits 0 when enabled, 1 when not, 2 when it could not tell.
 */
import { readFileSync, existsSync } from 'node:fs'

// Set process.exitCode and return rather than calling process.exit(): exiting
// while an undici fetch handle is still open trips a libuv assertion on
// Windows and turns a clean "not enabled" result into a crash.
const finish = (code) => { process.exitCode = code }

const readApiKey = () => {
  if (process.env.VITE_FIREBASE_API_KEY) return process.env.VITE_FIREBASE_API_KEY
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    const match = readFileSync(file, 'utf8').match(/^VITE_FIREBASE_API_KEY=(.+)$/m)
    if (match) return match[1].trim()
  }
  return null
}

const apiKey = readApiKey()

if (!apiKey) {
  console.error('✗ No VITE_FIREBASE_API_KEY found (checked the environment, .env.local and .env).')
  finish(2)
}

else try {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    }
  )
  const body = await response.json()

  if (body.idToken) {
    console.log('✓ Anonymous sign-in is ENABLED.')
    console.log('  Safe to set signedIn() to `request.auth != null` in firestore.rules,')
    console.log('  then run `npm run rules`.')
    finish(0)
  } else {

    const reason = body?.error?.message || `HTTP ${response.status}`
    console.error(`✗ Anonymous sign-in is NOT enabled (${reason}).`)
    console.error('  Firebase Console -> Build -> Authentication -> Sign-in method -> Anonymous.')
    console.error('  Do NOT harden firestore.rules until this reports ENABLED.')
    finish(1)
  }
} catch (error) {
  console.error('✗ Could not reach the Identity Toolkit API:', error.message)
  finish(2)
}
