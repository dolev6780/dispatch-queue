import { useCallback, useEffect, useState } from 'react'

/**
 * Minimal hash-based router.
 *
 * Hash routing rather than history routing because the app is served from a
 * project subpath on GitHub Pages with no server-side rewrite: a deep link to
 * /dispatch-queue/queue would 404, whereas /dispatch-queue/#/queue always
 * resolves to index.html. It also means refresh and back/forward work without
 * pulling in a router dependency for what is currently two routes.
 */
const readRoute = () => window.location.hash.replace(/^#\/?/, '').split('?')[0]

export const useHashRoute = (fallback = 'home') => {
  const [route, setRoute] = useState(() => readRoute() || fallback)

  useEffect(() => {
    const handleChange = () => setRoute(readRoute() || fallback)
    window.addEventListener('hashchange', handleChange)
    return () => window.removeEventListener('hashchange', handleChange)
  }, [fallback])

  const navigate = useCallback((next) => {
    const target = next === 'home' ? '#/' : `#/${next}`
    if (window.location.hash === target) return
    window.location.hash = target
  }, [])

  return [route, navigate]
}
