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

/** Whose calendar a link is, after its address. */
const provider = (url: string) =>
  /icloud\.com/i.test(url) ? 'Apple-Kalender' : /google\.com/i.test(url) ? 'Google-Kalender' : /outlook/i.test(url) ? 'Outlook-Kalender' : 'Kalender'

/**
 * Mein Bereich, "Meine Kalender": the plan in the own calendar (a link to subscribe to, read only), and the own
 * calendars in the plan (their appointments shown there as "belegt", only the times); several can be shared, e.g.
 * Privat and Arbeit, each read on its own.
 */
export function MyCalendars() {
  const [calendar, setCalendar] = useState<MyCalendar | null>(null)
  const [url, setUrl] = useState('')
  const [renewing, setRenewing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.myCalendar().then(setCalendar, (e) => setError(messageOf(e)))
  }, [])

  /** True when it went through. */
  const run = async (change: Promise<MyCalendar>, message?: string) => {
    setError('')
    try {
      const c = await change
      setCalendar(c)
      if (message) notifications.show({ message, color: 'teal' })
      return true
    } catch (e) {
      setError(messageOf(e))
      return false
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
        <Text size="xs" c="dimmed" mb="xs">
          Es erscheinen nur Termine aus den verbundenen Kalendern. Haben Sie mehrere (z. B. „Privat“, „Arbeit“, „Familie“),
          verbinden Sie jeden einzeln mit seinem eigenen Link.
        </Text>
        <Stack gap="xs">
          {calendar.calendars.map((own, i) => (
            <div key={own.id} className="own-calendar">
              <Group gap="xs" justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700}>{i + 1}. {provider(own.url)}</Text>
                  {own.error ? (
                    <Text size="xs" c="red.8">{own.error}</Text>
                  ) : own.syncedAt ? (
                    <Text size="xs" c="teal.8">
                      Verbunden · zuletzt abgeglichen {when(own.syncedAt)} · {own.busy} belegte Zeiten in den nächsten Monaten
                    </Text>
                  ) : (
                    <Text size="xs" c="dimmed">Wird abgeglichen …</Text>
                  )}
                </div>
                <Button size="compact-sm" variant="default" style={{ flex: "none" }} aria-label={`Kalender ${i + 1} trennen`}
                  onClick={() => run(api.removeOwnCalendar(own.id), 'Kalender getrennt.')}>
                  Trennen
                </Button>
              </Group>
            </div>
          ))}
          <TextInput
            label={calendar.calendars.length === 0 ? 'Link des Kalenders' : 'Weiteren Kalender verbinden'}
            placeholder="webcal://p…-caldav.icloud.com/published/…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <Group gap="xs">
            <Button disabled={!url.trim()}
              onClick={() => run(api.addOwnCalendar(url.trim()), 'Kalender verbunden.').then((ok) => ok && setUrl(''))}>
              {calendar.calendars.length === 0 ? 'Verbinden' : '+ Weiteren Kalender verbinden'}
            </Button>
            {calendar.calendars.length > 0 && (
              <Button variant="default" onClick={() => run(api.syncOwnCalendar(), 'Kalender abgeglichen.')}>Jetzt abgleichen</Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </Stack>
  )
}
