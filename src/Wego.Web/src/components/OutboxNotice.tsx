import { Alert, Button, Group, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { flushOutbox, outbox, OUTBOX_EVENT } from '../lib/tabletStore'

/**
 * On the tablet: how many PDFs of finished visits still wait to be sent (no internet at the customer). They go by
 * themselves once it is online; "Jetzt senden" tries at once. Nothing shows while nothing waits.
 */
export function OutboxNotice() {
  const [waiting, setWaiting] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const count = () => void outbox().then((items) => { if (alive) setWaiting(items.length) })
    count()
    window.addEventListener(OUTBOX_EVENT, count)
    window.addEventListener('online', count)
    return () => {
      alive = false
      window.removeEventListener(OUTBOX_EVENT, count)
      window.removeEventListener('online', count)
    }
  }, [])

  if (waiting === 0) return null
  return (
    <Alert color="orange" variant="light" mt="xs" p="xs" className="outbox-notice">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text size="sm">
          {waiting === 1 ? '1 Dokument einer Besichtigung wartet' : `${waiting} Dokumente von Besichtigungen warten`} auf Internet und
          {waiting === 1 ? ' wird' : ' werden'} dann von selbst gesendet.
        </Text>
        <Button size="compact-sm" variant="light" color="orange" loading={busy}
          onClick={() => { setBusy(true); void flushOutbox().then((left) => setWaiting(left)).finally(() => setBusy(false)) }}>
          Jetzt senden
        </Button>
      </Group>
    </Alert>
  )
}
