import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, Site } from '../api/types'
import { formatDate, formatDayTime } from '../lib/dates'
import { formatAddress } from '../lib/sites'
import { serviceName } from '../lib/activities'
import { Sheet } from './Sheet'

/** A service call to be confirmed, once: its first day in the plan with the site. */
export interface Asked {
  entry: Entry
  site: Site | undefined
}

/** The service calls waiting for an answer (or answered no), each once, by its first day. */
export function askedCalls(entries: Entry[], sites: Map<number, Site>, state: 'Offen' | 'Abgelehnt', employeeId?: number): Asked[] {
  const first = new Map<number, Entry>()
  for (const entry of entries) {
    if (entry.confirmation !== state || entry.siteId === null) continue
    if (employeeId !== undefined && entry.employeeId !== employeeId) continue
    const known = first.get(entry.siteId)
    if (!known || entry.date < known.date) first.set(entry.siteId, entry)
  }
  return [...first.values()].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ entry, site: sites.get(entry.siteId!) }))
}

const nameOf = (entry: Entry) => serviceName(entry.siteName ?? '') ?? entry.siteName ?? ''

/**
 * Mein Plan: the service calls the craftsman is asked to confirm, as a red button in the head; the window opens by
 * itself once when there are some. Yes makes the entry full in colour, no tells the planners (with a few words).
 */
export function ConfirmRequests({ asked, onAnswered }: { asked: Asked[]; onAnswered: () => void }) {
  const [open, setOpen] = useState(false)
  const shown = useRef(false)
  useEffect(() => {
    if (asked.length > 0 && !shown.current) {
      shown.current = true
      setOpen(true)
    }
  }, [asked.length])
  // The one being said no to, with the field for why.
  const [declining, setDeclining] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')

  if (asked.length === 0) return null

  const answer = async (siteId: number, accept: boolean) => {
    setBusy(siteId)
    setError('')
    try {
      await api.answerConfirmation(siteId, accept, accept ? null : note.trim() || null)
      setDeclining(null)
      setNote('')
      onAnswered()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button fullWidth color="red" mt={6} className="visit-reminder" onClick={() => setOpen(true)}>
        ✋ {asked.length === 1 ? '1 Einsatz bestätigen' : `${asked.length} Einsätze bestätigen`}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} centered title="Bitte bestätigen: Serviceeinsätze">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Der Planer möchte wissen, ob du diese Einsätze übernehmen kannst. Bis zu deiner Zusage stehen sie gestreift im Plan.
          </Text>
          {asked.map(({ entry, site }) => (
            <div key={entry.siteId} className="confirm-request">
              <Text fw={700}>{nameOf(entry)}</Text>
              <Text size="sm">
                {formatDate(entry.date)} · {formatDayTime(entry)}
              </Text>
              {site && formatAddress(site) && <Text size="sm" c="dimmed">{formatAddress(site)}</Text>}
              {site?.description && <Text size="sm">{site.description}</Text>}
              {declining === entry.siteId ? (
                <Stack gap={6} mt={6}>
                  <Textarea label="Warum nicht? (optional)" autosize minRows={2} maxLength={500} value={note} data-autofocus
                    onChange={(event) => setNote(event.currentTarget.value)} />
                  <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={() => setDeclining(null)}>Zurück</Button>
                    <Button color="red" loading={busy === entry.siteId} onClick={() => void answer(entry.siteId!, false)}>Absagen</Button>
                  </Group>
                </Stack>
              ) : (
                <Group gap="xs" mt={6} grow>
                  <Button variant="outline" color="red" disabled={busy !== null} onClick={() => { setDeclining(entry.siteId); setNote('') }}>
                    Absagen
                  </Button>
                  <Button color="green" loading={busy === entry.siteId} disabled={busy !== null && busy !== entry.siteId}
                    onClick={() => void answer(entry.siteId!, true)}>
                    Zusagen
                  </Button>
                </Group>
              )}
            </div>
          ))}
          {error && <Alert color="red" variant="light">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>Später</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

/**
 * The plan: the service calls a craftsman said no to, with his words. Ask again (e.g. after moving it to another day
 * or craftsman), or fix it without a confirmation.
 */
export function ConfirmationsSheet({ declined, onClose, onChanged, onGo }: {
  declined: Asked[]
  onClose: () => void
  onChanged: () => void
  /** Shows the day of the entry in the plan. */
  onGo: (entry: Entry) => void
}) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const act = async (siteId: number, ask: boolean) => {
    setBusy(siteId)
    setError('')
    try {
      await api.askConfirmation(siteId, ask)
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }
  const row = ({ entry, site }: Asked) => (
    <div key={entry.siteId} className="clash-row">
      <Text size="sm" fw={700}>
        {nameOf(entry)} · {entry.employeeName} · {formatDate(entry.date)}
      </Text>
      <Text size="sm" c="red.8">
        Abgesagt{site?.confirmationBy ? ` von ${site.confirmationBy}` : ''}
        {site?.confirmationNote ? `: „${site.confirmationNote}“` : ' (ohne Begründung)'}
      </Text>
      <Group gap="xs" mt={4}>
        <Button size="compact-sm" variant="default" onClick={() => onGo(entry)}>Im Plan zeigen</Button>
        <Button size="compact-sm" variant="light" loading={busy === entry.siteId} onClick={() => void act(entry.siteId!, true)}>
          Erneut anfragen
        </Button>
        <Button size="compact-sm" variant="light" color="green" loading={busy === entry.siteId} onClick={() => void act(entry.siteId!, false)}>
          Ohne Bestätigung festlegen
        </Button>
      </Group>
    </div>
  )
  return (
    <Sheet title="Vom Handwerker abgesagt" onClose={onClose} size="lg">
      <Stack gap="xs">
        {declined.map(row)}
        {declined.length === 0 && <Text size="sm" c="dimmed">Keine Absagen offen.</Text>}
        {error && <Alert color="red" variant="light">{error}</Alert>}
      </Stack>
    </Sheet>
  )
}
