import { Button, Group, Modal, Stack, Text, UnstyledButton } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { VisitEnquiry } from '../api/types'
import { todayIso } from '../lib/dates'
import { remindsToday, waitingEnquiries, waitingText } from '../lib/visitReminders'

/** At most so many customers are named in the box; the rest as "und N weitere". */
const SHOWN = 5

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage the hints come again next time.
  }
}

/**
 * The head of Mein Plan of one who visits: the customers waiting a week or longer for a visit (until one is
 * agreed), on the 7th, 9th, 11th ... day once a day opened by itself; and the enquiries come in since he last looked.
 */
export function VisitReminders({ employeeId, version, onPlan }: { employeeId: number; version: number; onPlan: () => void }) {
  const [enquiries, setEnquiries] = useState<VisitEnquiry[] | null>(null)
  const [fresh, setFresh] = useState<VisitEnquiry[]>([])
  const [popup, setPopup] = useState(false)
  const [showFresh, setShowFresh] = useState(false)
  const today = todayIso()
  const seenKey = `wego.visits.seen.${employeeId}`
  const remindedKey = `wego.visits.reminded.${employeeId}`

  useEffect(() => {
    let alive = true
    api.visits(employeeId).then(
      (plan) => {
        if (!alive) return
        const enquiries = plan.enquiries ?? []
        setEnquiries(enquiries)
        // New: not there when he looked last. The first time all count as seen.
        const seen = read(seenKey)
        if (seen === null) write(seenKey, JSON.stringify(enquiries.map((e) => e.siteId)))
        else {
          const known = new Set<number>(JSON.parse(seen) as number[])
          setFresh(enquiries.filter((e) => !known.has(e.siteId) && !e.report))
        }
        // The window once a day, on a day of reminding.
        if (read(remindedKey) !== today && waitingEnquiries(enquiries, today).some(({ days }) => remindsToday(days))) setPopup(true)
      },
      () => {
        // Without the enquiries there is nothing to remind of; Mein Plan works all the same.
      },
    )
    return () => {
      alive = false
    }
  }, [employeeId, version, seenKey, remindedKey, today])

  if (!enquiries) return null
  const waiting = waitingEnquiries(enquiries, today)

  const markSeen = () => {
    write(seenKey, JSON.stringify(enquiries.map((e) => e.siteId)))
    setFresh([])
    setShowFresh(false)
  }
  // Closed: not again today by itself.
  const closeWaiting = () => {
    write(remindedKey, today)
    setPopup(false)
  }

  return (
    <>
      {/* One row in the head of Mein Plan: always in sight, the list behind a tap. */}
      {(waiting.length > 0 || fresh.length > 0) && (
        <Group gap={6} mt={6} grow wrap="nowrap" className="visit-reminders">
          {waiting.length > 0 && (
            <Button color="red" className="visit-reminder" aria-label={`${waiting.length} ${waiting.length === 1 ? 'Kunde wartet' : 'Kunden warten'} auf Terminvereinbarung`}
              onClick={() => setPopup(true)}>
              ⚠ {waiting.length === 1 ? '1 Kunde wartet' : `${waiting.length} Kunden warten`}
            </Button>
          )}
          {fresh.length > 0 && (
            <Button color="wego" variant="outline" className="visit-reminder" onClick={() => setShowFresh(true)}>
              {fresh.length === 1 ? '1 neue Anfrage' : `${fresh.length} neue Anfragen`}
            </Button>
          )}
        </Group>
      )}

      <Modal opened={popup && waiting.length > 0} onClose={closeWaiting} centered title="Kunden warten auf Ihren Anruf">
        <Stack gap={6} mb="md">
          {waiting.slice(0, SHOWN).map(({ enquiry, days }) => (
            <UnstyledButton key={enquiry.siteId} className="visit-reminder-row" onClick={() => { closeWaiting(); onPlan() }}>
              <Text size="sm" fw={700}>{enquiry.name}</Text>
              <Text size="sm" c="red.8">{waitingText(days)}</Text>
            </UnstyledButton>
          ))}
          {waiting.length > SHOWN && <Text size="sm" c="dimmed">und {waiting.length - SHOWN} weitere</Text>}
        </Stack>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={closeWaiting}>Später</Button>
          <Button color="red" onClick={() => { closeWaiting(); onPlan() }}>Jetzt planen</Button>
        </Group>
      </Modal>

      <Modal opened={showFresh && fresh.length > 0} onClose={() => setShowFresh(false)} centered title="Neue Anfragen seit Ihrem letzten Besuch">
        <Stack gap={6} mb="md">
          {fresh.map((e) => (
            <div key={e.siteId}>
              <Text size="sm" fw={700}>{e.name}</Text>
              {e.address && <Text size="sm" c="dimmed">{e.address}</Text>}
            </div>
          ))}
        </Stack>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={markSeen}>Gesehen</Button>
          <Button onClick={() => { markSeen(); onPlan() }}>Ansehen</Button>
        </Group>
      </Modal>
    </>
  )
}
