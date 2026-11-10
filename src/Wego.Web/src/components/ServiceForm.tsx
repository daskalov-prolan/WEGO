import { Alert, Button, Group, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Site, SiteInput } from '../api/types'
import { activityLabel } from '../lib/activities'
import { formatDateLong, HALF_DAYS } from '../lib/dates'
import { emptySite } from '../lib/sites'
import { Sheet } from './Sheet'

/** When the service call is: the whole day or one half (see HALF_DAYS). */
export type ServiceTime = 'day' | 'morning' | 'afternoon'

export const serviceTimes = (time: ServiceTime) =>
  time === 'morning' ? HALF_DAYS[0] : time === 'afternoon' ? HALF_DAYS[1] : { start: '', end: '' }

interface Props {
  date: string
  /** An appointment the customer has not confirmed yet, in place of a service call. */
  tentative?: boolean
  /** Creates the service call (a site marked as such) and puts it on the day. */
  onCreate: (input: SiteInput, time: ServiceTime, activity: Activity | null) => Promise<Site>
  onClose: () => void
  /** The time chosen first: the afternoon when the day has a site already. */
  initialTime?: ServiceTime
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
  const [activity, setActivity] = useState<Activity | null>(initialActivity)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The town filled in from the postal code; one typed by hand is not replaced.
  const filledCity = useRef<string | null>(null)

  const field = (key: 'client' | 'clientPhone' | 'street' | 'city' | 'description') => ({
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
      await onCreate(service, time, tentative ? null : activity)
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
            <TextInput label="Telefon Kunde" type="tel" maxLength={50} {...field('clientPhone')} />
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
          <div>
            <Text size="sm" fw={500} mb={4}>
              Wann
            </Text>
            <SegmentedControl
              value={time}
              onChange={(value) => setTime(value as ServiceTime)}
              data={[
                { value: 'day', label: 'Ganzer Tag' },
                { value: 'morning', label: '½ vormittags' },
                { value: 'afternoon', label: '½ nachmittags' },
              ]}
            />
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
            <Button type="submit" loading={busy} disabled={!service.client?.trim()}>
              {tentative ? 'Termin eintragen' : 'Service eintragen'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
