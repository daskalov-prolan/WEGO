import { Alert, Button, Chip, Group, Radio, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { Planner, SiteInput, SiteNameSource, SiteStatus } from '../api/types'
import { siteName } from '../lib/sites'

/** How the customer is addressed (as on the server). */
const SALUTATIONS = ['Herr', 'Frau', 'Familie']
import { SCOPES } from '../lib/activities'
import { Sheet } from './Sheet'

interface Props {
  title: string
  initial: SiteInput
  onClose: () => void
  /** Saves the site; a rejected promise keeps the form open and shows the message. */
  onSave: (input: SiteInput) => Promise<void>
  /** An enquiry of the offer phase: it starts in the offer, nothing to choose. */
  enquiry?: boolean
  /** A further action at the left of the buttons (e.g. "Kunde hat abgesagt" for an enquiry). */
  extra?: ReactNode
}

/** A group of fields on a white card with a petrol edge and a small heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      <Stack gap="sm">{children}</Stack>
    </section>
  )
}

/** The record of a construction site: client, address, and which of the two names it in the plan. */
export function SiteForm({ title, initial, onClose, onSave, enquiry = false, extra }: Props) {
  // Street and house number are one field; a house number kept apart before joins the street.
  const [site, setSite] = useState<SiteInput>(() => ({
    ...initial,
    street: [initial.street, initial.houseNumber].filter(Boolean).join(' ') || null,
    houseNumber: null,
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The planner in charge must be chosen before the site is saved.
  const [planners, setPlanners] = useState<Planner[]>([])
  useEffect(() => {
    api.planners().then((answer) => setPlanners(Array.isArray(answer) ? answer : []), () => {})
  }, [])

  const field = (key: Exclude<keyof SiteInput, 'isService' | 'isTentative'>) => ({
    value: site[key] ?? '',
    onChange: (event: { currentTarget: { value: string } }) => {
      // Read the value now: React clears the event before the state update below runs.
      const value = event.currentTarget.value || null
      setSite((current) => ({ ...current, [key]: value }))
    },
  })

  // Five digits of a postal code fill in the town with its borough; a town typed in by hand stays.
  const filledCity = useRef<string | null>(null)
  const changePostalCode = (value: string) => {
    const code = value.trim() || null
    setSite((current) => ({ ...current, postalCode: code }))
    if (!code || !/^\d{5}$/.test(code)) return
    api.postalCode(code, site.street).then(
      ({ city }) =>
        setSite((current) => {
          if (current.postalCode !== code || (current.city && current.city !== filledCity.current)) return current
          filledCity.current = city
          return { ...current, city }
        }),
      () => {},
    )
  }

  // The name comes from the chosen source; without a client (e.g. a first visit) the street names the site.
  const other: SiteNameSource = site.nameSource === 'Strasse' ? 'Auftraggeber' : 'Strasse'
  const named = siteName(site) || !siteName({ ...site, nameSource: other }) ? site : { ...site, nameSource: other }
  const name = siteName(named)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Opened from the day of an employee, the form is a child of that form in React: its submit stays here.
    event.stopPropagation()
    if (!named.responsiblePlannerId) {
      setError('Bitte den zuständigen Planer wählen.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(named)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>{title}</Text>}>
      <form onSubmit={submit}>
        <Stack gap="sm">
          {initial.status !== undefined && !enquiry && (
            <div>
              <Text size="sm" fw={500} mb={4}>
                Beginnt als
              </Text>
              <SegmentedControl
                value={site.status}
                onChange={(value) => setSite((current) => ({ ...current, status: value as SiteStatus }))}
                data={[{ value: 'Angebot', label: 'Angebotsphase' }, 'Bauphase']}
              />
            </div>
          )}
          <Section title="Kunde">
            {/* How the customer is addressed: once more a click on the chosen one takes it off. */}
            <div>
              <Text size="sm" fw={500} mb={4}>
                Anrede
              </Text>
              <SegmentedControl
                size="sm"
                value={site.salutation ?? ''}
                onChange={(value) => setSite((current) => ({ ...current, salutation: value || null }))}
                data={[
                  { value: '', label: 'keine' },
                  ...SALUTATIONS.map((salutation) => ({ value: salutation, label: salutation })),
                ]}
              />
            </div>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput label="Auftraggeber" maxLength={200} data-autofocus {...field('client')} />
              <TextInput label="Telefon Kunde" type="tel" maxLength={50} {...field('clientPhone')} />
            </SimpleGrid>
          </Section>
          <Section title="Adresse">
            <TextInput label="Straße und Hausnummer" maxLength={200} {...field('street')} />
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <TextInput
                label="PLZ"
                maxLength={10}
                inputMode="numeric"
                value={site.postalCode ?? ''}
                onChange={(event) => changePostalCode(event.currentTarget.value)}
              />
              <TextInput label="Ort" maxLength={100} style={{ gridColumn: 'span 2' }} {...field('city')} />
            </SimpleGrid>
          </Section>
          <Section title="Name im Plan">
            <Radio.Group
              label="Name in den Übersichten"
              value={site.nameSource}
              onChange={(value) => setSite((current) => ({ ...current, nameSource: value as SiteNameSource }))}
            >
              <Group gap="lg" mt={4}>
                <Radio value="Auftraggeber" label="Auftraggeber" />
                <Radio value="Strasse" label="Straße" />
              </Group>
            </Radio.Group>
            <Text size="sm" c={name ? 'wego.9' : 'red.7'}>
              {name ? (
                <>
                  Im Plan steht: <strong>{name}</strong>
                </>
              ) : (
                'Bitte einen Auftraggeber oder eine Straße angeben.'
              )}
            </Text>
          </Section>
          <Section title="Planung">
            <Select
              label="Zuständiger Planer"
              placeholder="Planer wählen"
              required
              error={error && !site.responsiblePlannerId ? 'Bitte wählen' : undefined}
              maw={320}
              data={planners.map((planner) => ({ value: String(planner.id), label: planner.name }))}
              value={site.responsiblePlannerId ? String(site.responsiblePlannerId) : null}
              onChange={(value) => setSite((current) => ({ ...current, responsiblePlannerId: value ? Number(value) : null }))}
              allowDeselect={false}
            />
            {/* The day the enquiry came in: where the offer phase begins (a new site: today). */}
            {!site.isService && (
              <DateInput
                label="Anfrage am"
                description="Wann die Anfrage des Kunden reinkam"
                valueFormat="DD.MM.YYYY"
                maw={220}
                maxDate={new Date()}
                placeholder="heute"
                value={site.requestedOn ?? null}
                onChange={(value) => setSite((current) => ({ ...current, requestedOn: value }))}
              />
            )}
            {/* What the customer would like done: for an enquiry (not a service call); the details in the description. */}
            {!site.isService && (
              <Chip.Group multiple value={site.scope ?? []} onChange={(scope) => setSite((current) => ({ ...current, scope }))}>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Gewünschter Umfang
                  </Text>
                  <Group gap={6}>
                    {SCOPES.map((scope) => (
                      <Chip key={scope} value={scope} size="sm" variant="outline">
                        {scope}
                      </Chip>
                    ))}
                  </Group>
                </Stack>
              </Chip.Group>
            )}
            {/* An enquiry gets its start with the customer's yes (Zusage): a start set here would move it into the
                construction phase by itself on that day, yes or no. */}
            {!enquiry && (
              <DateInput
                label="Geplanter Start"
                valueFormat="DD.MM.YYYY"
                clearable
                maw={220}
                value={site.plannedStart}
                // An end set before stays, unless it would now come before the start.
                onChange={(value) =>
                  setSite((current) => ({
                    ...current,
                    plannedStart: value,
                    plannedEnd: value && current.plannedEnd && current.plannedEnd < value ? null : current.plannedEnd,
                  }))
                }
              />
            )}
            <Textarea
              label="Beschreibung"
              description={site.isService ? 'Art des Umbaus, Fliesen, Hinweise' : 'Was genau: Größe, Wünsche, Fliesen, Hinweise'}
              placeholder={site.isService ? undefined : 'z. B. Bad 8 m², Wanne raus, bodengleiche Dusche'}
              autosize
              minRows={2}
              maxLength={1000}
              {...field('description')}
            />
          </Section>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            {extra && <div style={{ marginRight: 'auto' }}>{extra}</div>}
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy} disabled={!name}>
              Speichern
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
