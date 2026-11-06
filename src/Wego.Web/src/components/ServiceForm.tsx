import { Alert, Button, Group, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Site, SiteInput } from '../api/types'
import { formatDateLong, HALF_DAYS } from '../lib/dates'
import { emptySite } from '../lib/sites'
import { Sheet } from './Sheet'

/** When the service call is: the whole day or one half (see HALF_DAYS). */
export type ServiceTime = 'day' | 'morning' | 'afternoon'

export const serviceTimes = (time: ServiceTime) =>
  time === 'morning' ? HALF_DAYS[0] : time === 'afternoon' ? HALF_DAYS[1] : { start: '', end: '' }

interface Props {
  date: string
  /** Creates the service call (a site marked as such) and puts it on the day. */
  onCreate: (input: SiteInput, time: ServiceTime) => Promise<Site>
  onClose: () => void
}

/**
 * A service call (Serviceeinsatz): work done at one appointment, without the record of a whole site. Only what is
 * needed to get there and to call: the customer, the address, the telephone and what is to do.
 */
export function ServiceForm({ date, onCreate, onClose }: Props) {
  const [service, setService] = useState<SiteInput>({ ...emptySite, status: 'Bauphase', plannedStart: date, isService: true })
  const [time, setTime] = useState<ServiceTime>('day')
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
      await onCreate(service, time)
      onClose()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Serviceeinsatz · {formatDateLong(date)}</Text>} size="md">
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Für Arbeiten an einem Termin, ohne eigene Baustelle. Er steht im Plan als „SE: Kunde“.
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
              Service eintragen
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
