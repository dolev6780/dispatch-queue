/**
 * Ask the AI assistant, through the main PC's relay. The relay holds the
 * Gemini key and checks the sign-in token sent here; the answer comes back as
 * text (or, for a draft, as steps).
 */
export const askAssistant = async ({ user, mode = 'chat', messages = [], context = {} }) => {
  const token = await user.getIdToken()
  let res
  try {
    res = await fetch('api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode, messages, context })
    })
  } catch {
    throw new Error('Cannot reach the main PC — is the relay still running?')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `The assistant did not answer (${res.status}).`)
  return body
}
