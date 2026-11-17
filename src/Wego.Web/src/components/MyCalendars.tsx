import { Alert, Button, CopyButton, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { MyCalendar } from '../api/types'

/** "17.11. 07:15" */
const when = (iso: string) => {
  const at = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}. ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Mein Bereich, "Meine Kalender": the plan in the own calendar (a link to subscribe to, read only), and the own
 * calendar in the plan (its appointments shown there as "belegt", only the times).
 */
export function MyCalendars() {
  const [calendar, setCalendar] = useState<MyCalendar | null>(null)
  const [url, setUrl] = useState('')
  const [renewing, setRenewing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.myCalendar().then((c) => {
      setCalendar(c)
      setUrl(c.externalUrl ?? '')
    }, (e) => setError(messageOf(e)))
  }, [])

  const run = async (change: Promise<MyCalendar>, message?: string) => {
    setError('')
    try {
      const c = await change
      setCalendar(c)
      setUrl(c.externalUrl ?? '')
      if (c.error) setError(c.error)
      else if (message) notifications.show({ message, color: 'teal' })
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (!calendar) return error ? <Alert color="red" variant="light">{error}</Alert> : null
  // Apple's calendar opens the link itself when it starts with webcal://.
  const webcal = calendar.link?.replace(/^https?:\/\//, 'webcal://')

  return (
    <Stack gap="md" mt="xl" className="my-calendars">
      <Title order={3} className="section-heading">Meine Kalender</Title>
      {error && <Alert color="red" variant="light" withCloseButton onClose={() => setError('')}>{error}</Alert>}

      <Paper withBorder radius="md" p="md">
        <Text fw={700} mb={4}>Meine WEGO-Termine in meinem Kalender</Text>
        <Text size="sm" c="dimmed" mb="sm">
          Baustellen, Besichtigungen, Angebotstermine und Wiederholungstermine erscheinen in Ihrem Apple-, Google- oder
          Outlook-Kalender. Nur zum Ansehen: geändert wird hier. Der Kalender holt Änderungen nach 15–60 Minuten.
        </Text>
        {calendar.link ? (
          <Stack gap="xs">
            <Group gap="xs">
              <Button component="a" href={webcal}>Im Apple-Kalender abonnieren</Button>
              <CopyButton value={calendar.link}>
                {({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? 'Kopiert' : 'Link kopieren'}</Button>}
              </CopyButton>
            </Group>
            <Text size="xs" c="dimmed">
              Am iPhone auch: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen,
              dort den Link einfügen. Der Link ist persönlich: bitte nicht weitergeben.
            </Text>
            {renewing ? (
              <Group gap="xs">
                <Text size="sm">Der alte Link funktioniert danach nicht mehr.</Text>
                <Button size="compact-sm" color="red" onClick={() => run(api.makeCalendarLink(true), 'Neuer Link erzeugt.').then(() => setRenewing(false))}>
                  Neuen Link erzeugen
                </Button>
                <Button size="compact-sm" variant="default" onClick={() => setRenewing(false)}>Abbrechen</Button>
              </Group>
            ) : (
              <Button variant="subtle" size="compact-sm" w="fit-content" onClick={() => setRenewing(true)}>Link erneuern …</Button>
            )}
          </Stack>
        ) : (
          <Button onClick={() => run(api.makeCalendarLink())}>Link erzeugen</Button>
        )}
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={700} mb={4}>Meine eigenen Termine im Plan als „belegt“</Text>
        <Text size="sm" c="dimmed" mb="sm">
          Termine aus Ihrem eigenen Kalender erscheinen im Plan als „belegt“, nur mit der Uhrzeit, ohne Titel. Die
          Planer sehen so, wann Sie nicht können, und Überschneidungen werden rot markiert.
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          iPhone: Kalender-App → unten „Kalender“ → beim gewünschten Kalender auf ⓘ → „Öffentlicher Kalender“ einschalten
          → „Link teilen“ → kopieren und hier einfügen.
        </Text>
        <Stack gap="xs">
          <TextInput placeholder="webcal://p…-caldav.icloud.com/published/…" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
          <Group gap="xs">
            <Button disabled={!url.trim() || url.trim() === calendar.externalUrl}
              onClick={() => run(api.setOwnCalendar(url.trim()), 'Kalender verbunden.')}>
              Verbinden
            </Button>
            {calendar.externalUrl && (
              <Button variant="default" onClick={() => run(api.setOwnCalendar(null), 'Kalender getrennt.')}>Trennen</Button>
            )}
          </Group>
          {calendar.externalUrl && !calendar.error && calendar.syncedAt && (
            <Text size="xs" c="teal.8">
              Verbunden · zuletzt abgeglichen {when(calendar.syncedAt)} · {calendar.busy} belegte Zeiten in den nächsten Monaten
            </Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}
