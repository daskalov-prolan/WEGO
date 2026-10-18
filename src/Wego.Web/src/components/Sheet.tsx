import { Drawer, Modal } from '@mantine/core'
import type { ReactNode } from 'react'
import { useIsPhone } from '../lib/useIsPhone'

interface Props {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  size?: string
}

/** A dialog: on phones a panel that slides up from the bottom, elsewhere a centred window. */
export function Sheet({ title, onClose, children, size = 'lg' }: Props) {
  const isPhone = useIsPhone()
  return isPhone ? (
    <Drawer opened onClose={onClose} title={title} position="bottom" size="auto" padding="md" radius="md">
      <div className="sheet-body">{children}</div>
    </Drawer>
  ) : (
    <Modal opened onClose={onClose} title={title} size={size} centered>
      {children}
    </Modal>
  )
}
