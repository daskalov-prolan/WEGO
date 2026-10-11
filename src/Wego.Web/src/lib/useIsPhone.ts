import { useEffect, useState } from 'react'

const QUERY = '(max-width: 720px)'

/** True on phone-sized screens. Follows window resizing and rotation. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia?.(QUERY).matches ?? false)

  useEffect(() => {
    const media = window.matchMedia?.(QUERY)
    if (!media) return
    const onChange = () => setIsPhone(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return isPhone
}
