import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches, kept live as the window changes. */
export const useMediaQuery = (query) => useSyncExternalStore(
  (onChange) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  },
  () => window.matchMedia(query).matches,
  () => false
)

/** Phone-sized screens get their own layout, not a squeezed desktop one. */
export const useIsNarrow = () => useMediaQuery('(max-width: 720px)')
