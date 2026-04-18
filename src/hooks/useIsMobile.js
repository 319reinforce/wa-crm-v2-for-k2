import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mql = window.matchMedia(MOBILE_QUERY)
    const handler = (e) => setIsMobile(e.matches)
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else mql.addListener(handler)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else mql.removeListener(handler)
    }
  }, [])

  return isMobile
}
