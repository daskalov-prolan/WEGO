import { Alert, Button, Chip, Group, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Site, SiteInput } from '../api/types'
import { activityLabel } from '../lib/activities'
import { formatDateLong, HALF_DAYS } from '../lib/dates'
import { emptySite } from '../lib/sites'
import { Sheet } from './Sheet'
import { TimeSelect } from './TimeSelect'

/** When the service call is: the whole day, one half (see HALF_DAYS), or a time of its own (e.g. 14–16). */
export type ServiceTime = 'day' | 'morning' | 'afternoon' | 'custom'

const SERVICE_TIMES: { value: ServiceTime; label: string }[] = [
  { value: 'day', label: 'Ganzer Tag' },
  { value: 'morning', label: '½ vormittags' },
  { value: 'afternoon', label: '½ nachmittags' },
  { value: 'custom', label: 'Andere Zeit' },
]

export const serviceTimes = (time: ServiceTime) =>
  time === 'morning' ? HALF_DAYS[0] : time === 'afternoon' ? HALF_DAYS[1] : { start: '', end: '' }

interface Props {
  date: string
  /** An appointment the customer has not confirmed yet, in place of a service call. */
  tentative?: boolean
  /** Creates the service call (a site marked as such) and puts it on the day. */
  onCreate: (input: SiteInput, times: { start: string; end: string }, activity: Activity | null) => Promise<Site>
  onClose: () => void
  /** The time chosen first: the afternoon when the day has a site already. */
  initialTime?: Exclude<ServiceTime, 'custom'>
  /** What the employee can do there (its colour in the plan); a service call asks for one of them. */
  activities?: Activity[]
  /** The one chosen first: the main activity of the employee. */
  initialActivity?: Activity | null
}

/**
 * A service call (Serviceeinsatz): work done at one appointment, without the record of a whole site. Only what is
 * needed to get there and to call: the customer, the address, the telephone and what is to do.
 */
export function ServiceForm({ date, tentative = false, onCreate, onClose, initialTime = 'day', activities = [], initialActivity = null }: Props) {
  // Not confirmed yet: an offer without a start; it becomes a site or a service call when it is confirmed.
  const [service, setService] = useState<SiteInput>(
    tentative ? { ...emptySite, status: 'Angebot', isTentative: true } : { ...emptySite, status: 'Bauphase', plannedStart: date, isService: true },
  )
  const [time, setTime] = useState<ServiceTime>(initialTime)
  // A time of its own: from and to ("HH:mm").
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const customMissing = time === 'custom' && (!from || !to)
  const [activity, setActivity] = useState<Activity | null>(initialActivity)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The town filled in from the postal code; one typed by hand is not replaced.
  const filledCity = useRef<string | null>(null)

  const field = (key: 'client' | 'clientPhone' | 'clientPhone2' | 'street' | 'city' | 'description') => ({
    value: service[key] ?? '',
    onChange: (event: { currentTarget: { value: string } }) => {
      const value = event.currentTarget.value
      setService((current) => ({ ...current, [key]: value || null }))
    },
  })

  const changePostalCode = (value: string) => {
    const code = value.trim() || null
    setService((current) => ({ ...current, postalCode: code }))
    if (!code || !/^\d{5}$/.test(code)) return
    api.postalCode(code, service.street).then(
      ({ city }) =>
        setService((current) => {
          if (current.postalCode !== code || (current.city && current.city !== filledCity.current)) return current
          filledCity.current = city
          return { ...current, city }
        }),
      () => {},
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Only this form, not the day around it.
    event.stopPropagation()
    setBusy(true)
    setError('')
    try {
      await onCreate(service, time === 'custom' ? { start: from, end: to } : serviceTimes(time), tentative ? null : activity)
      onClose()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        <Text fw={700}>
          {tentative ? 'Termin (unbestätigt)' : 'Serviceeinsatz'} · {formatDateLong(date)}
        </Text>
      }
      size="md"
    >
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {tentative
              ? 'Ein Termin, den der Kunde noch nicht bestätigt hat. Er steht im Plan ohne Farbe als „? Kunde“ und wird beim Bestätigen zur Baustelle oder zum Serviceauftrag.'
              : 'Für Arbeiten an einem Termin, ohne eigene Baustelle.'}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput label="Kunde" maxLength={200} required data-autofocus {...field('client')} />
            <TextInput label="Telefon Kunde (z. B. Handy)" type="tel" maxLength={50} {...field('clientPhone')} />
            <TextInput label="Telefon 2 (z. B. Festnetz)" type="tel" maxLength={50} {...field('clientPhone2')} />
          </SimpleGrid>
          <TextInput label="Straße und Hausnummer" maxLength={200} {...field('street')} />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <TextInput
              label="PLZ"
              maxLength={10}
              inputMode="numeric"
              value={service.postalCode ?? ''}
              onChange={(event) => changePostalCode(event.currentTarget.value)}
            />
            <TextInput label="Ort" maxLength={100} style={{ gridColumn: 'span 2' }} {...field('city')} />
          </SimpleGrid>
          <Textarea label="Was ist zu tun" autosize minRows={2} maxLength={1000} {...field('description')} />
          {/* The work of a service call, in its colour in the plan; an appointment not confirmed yet has none. */}
          {!tentative && activities.length > 0 && (
            <Select
              label="Tätigkeit"
              allowDeselect={false}
              value={activity}
              onChange={(value) => setActivity(value as Activity | null)}
              data={activities.map((value) => ({ value, label: activityLabel(value) ?? value }))}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          {/* Some service calls the craftsman confirms first: until then dashed in the plan. */}
          {!tentative && (
            <div className="confirm-question">
              <Text size="sm" fw={700} mb={4}>
                Muss der Handwerker den Einsatz bestätigen?
              </Text>
              <SegmentedControl
                value={service.needsConfirmation ? 'ja' : 'nein'}
                onChange={(value) => setService((current) => ({ ...current, needsConfirmation: value === 'ja' }))}
                data={[
                  { value: 'nein', label: 'Nein' },
                  { value: 'ja', label: 'Ja, erst anfragen' },
                ]}
              />
            </div>
          )}
          <div>
            <Text size="sm" fw={500} mb={4}>
              Wann
            </Text>
            {/* Choices that go on to a second line when the window is narrow: none of them cut short. */}
            <Chip.Group value={time} onChange={(value) => setTime(value as ServiceTime)}>
              <Group gap={6} className="service-times">
                {SERVICE_TIMES.map(({ value, label }) => (
                  <Chip key={value} value={value} variant="filled" radius="sm">
                    {label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            {time === 'custom' && (
              <Group grow gap="xs" mt="xs">
                <TimeSelect label="von" value={from} required
                  onChange={(start) => { setFrom(start); if (to && start && to <= start) setTo('') }} />
                <TimeSelect label="bis" value={to} required onChange={setTo} after={from} />
              </Group>
            )}
          </div>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy} disabled={!service.client?.trim() || customMissing}>
              {tentative ? 'Termin eintragen' : 'Service eintragen'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
