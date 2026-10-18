import { useMediaQuery } from '@mantine/hooks'

/** True on phone-sized screens. Follows window resizing and rotation. */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 720px)', false, { getInitialValueInEffect: false }) ?? false
}
