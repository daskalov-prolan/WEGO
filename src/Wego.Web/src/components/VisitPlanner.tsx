import { Alert, Anchor, Badge, Button, Group, Loader, Radio, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { CallAttempt, VisitDay, VisitEnquiry, VisitPlan } from '../api/types'
import { addDays, formatDate, todayIso } from '../lib/dates'
import { mapsLink, ON_SITE, toMin, toTime } from '../lib/visitRoute'
import { LUNCH, nextFree, suggestTour, type Tour, type TourStop } from '../lib/visitTour'
import { Sheet } from './Sheet'

/**
 * Planning the visits of the enquiries, for whoever goes out to them (or a planner for them): first the question
 * what to plan, then one customer at a time on any day (16:00 by default), or a tour through a region on a day the
 * planners set aside. Each visit is an hour on site; only what the customer agreed to is saved.
 */

/** One customer at a time; or a day (of a region, or opened from the calendar with all customers, region null). */
type Mode = { kind: 'single' } | { kind: 'region'; region: string | null; date: string | null }

const SINGLE_TIME = '16:00'

/** "15.11. 10:15": when the customer was called last (the server keeps UTC). */
function callTime(call: CallAttempt) {
  const at = new Date(call.at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}. ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Not reached: when, by whom, how often. */
export const callLine = (call: CallAttempt) =>
  `Nicht erreicht: ${callTime(call)} · ${call.by}${call.count > 1 ? ` (${call.count}×)` : ''}`

const daysSince = (iso: string) => Math.round((Date.parse(todayIso()) - Date.parse(iso)) / 86_400_000)
/** "wartet seit heute", "seit 1 Tag", "seit 5 Tagen". */
const waiting = (iso: string) => {
  const days = daysSince(iso)
  return days <= 0 ? 'wartet seit heute' : days === 1 ? 'wartet seit 1 Tag' : `wartet seit ${days} Tagen`
}
const hm = (time: string) => time.slice(0, 5)
const stopOf = (enquiry: VisitEnquiry): TourStop => ({ siteId: enquiry.siteId, latitude: enquiry.latitude, longitude: enquiry.longitude })
const agreedOf = (day: VisitDay | undefined): TourStop[] =>
  (day?.visits ?? []).map((visit) => ({ siteId: visit.siteId, latitude: visit.latitude, longitude: visit.longitude, from: toMin(visit.from) }))
const onMap = (enquiry: VisitEnquiry) => enquiry.latitude !== null && enquiry.longitude !== null

/** date: opened from a day of visits in the calendar, it starts at that day. */
export function VisitPlanner({ employeeId, date, onClose, onChanged }: { employeeId?: number; date?: string; onClose: () => void; onChanged?: () => void }) {
  const [plan, setPlan] = useState<VisitPlan | null>(null)
  const [mode, setMode] = useState<Mode | null>(date ? { kind: 'region', region: null, date } : null)
  const [error, setError] = useState('')
  // Something saved: the page behind loads again once the window closes (not before, so it stays open for the next call).
  const [changed, setChanged] = useState(false)
  const close = () => {
    if (changed) onChanged?.()
    onClose()
  }

  const load = useCallback((id?: number) => api.visits(id).then(setPlan, (e) => setError(messageOf(e))), [])
  useEffect(() => {
    void load(employeeId)
  }, [employeeId, load])

  /** Runs a change on the server: the plan comes back; the page behind is told when the window closes. */
  const run = async (change: Promise<VisitPlan>) => {
    setError('')
    try {
      setPlan(await change)
      setChanged(true)
      return true
    } catch (e) {
      setError(messageOf(e))
      return false
    }
  }

  const visitorName = plan?.visitors.find((v) => v.id === plan.employeeId)?.name
  const title = mode === null ? 'Besichtigungen planen'
    : mode.kind === 'single' ? 'Einzelne Besichtigung'
      : `Besichtigungen${mode.region ? ` Region ${mode.region}` : ''}${mode.date ? ` · ${formatDate(mode.date)}` : ''}`

  return (
    <Sheet title={title} onClose={close} size="xl">
      {!plan ? (
        error ? <Alert color="red" variant="light">{error}</Alert> : <Loader />
      ) : (
        <Stack gap="sm" className="visit-planner">
          {plan.visitors.length > 0 && (
            <Select
              label="Wer besichtigt"
              data={plan.visitors.map((v) => ({ value: String(v.id), label: v.name }))}
              value={String(plan.employeeId)}
              allowDeselect={false}
              onChange={(value) => value && load(Number(value))}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          {error && <Alert color="red" variant="light" withCloseButton onClose={() => setError('')}>{error}</Alert>}
          {plan.pending > 0 && (
            <Text size="xs" c="dimmed">{plan.pending} Adressen werden noch auf der Karte gesucht (beim nächsten Öffnen).</Text>
          )}

          {mode === null ? (
            <ModeChoice plan={plan} onChoose={setMode} />
          ) : (
            <Group gap="xs">
              <Button size="compact-sm" variant="subtle" onClick={() => setMode(mode.kind === 'region' && mode.date && mode.region ? { ...mode, date: null } : null)}>
                ‹ zurück
              </Button>
              {visitorName && <Text size="sm" c="dimmed">für {visitorName}</Text>}
            </Group>
          )}

          {mode?.kind === 'single' && <SingleVisits plan={plan} run={run} />}
          {mode?.kind === 'region' && mode.region && !mode.date && (
            <DayChoice plan={plan} region={mode.region} onChoose={(date) => setMode({ ...mode, date })} run={run} />
          )}
          {mode?.kind === 'region' && mode.date && <RegionDay plan={plan} region={mode.region} date={mode.date} run={run} />}
        </Stack>
      )}
    </Sheet>
  )
}

type Run = (change: Promise<VisitPlan>) => Promise<boolean>

/** "Was möchten Sie planen?" */
function ModeChoice({ plan, onChoose }: { plan: VisitPlan; onChoose: (mode: Mode) => void }) {
  return (
    <Stack gap="xs">
      <Text fw={600}>Was möchten Sie planen?</Text>
      <Button variant="light" justify="space-between" onClick={() => onChoose({ kind: 'single' })}
        rightSection={<Badge variant="white">{plan.enquiries.length}</Badge>}>
        Einzelne Besichtigung
      </Button>
      {plan.regions.map((region) => (
        <Button key={region} variant="light" justify="space-between" onClick={() => onChoose({ kind: 'region', region, date: null })}
          rightSection={<Badge variant="white">{plan.enquiries.filter((e) => e.region === region).length}</Badge>}>
          Besichtigungen Region {region}
        </Button>
      ))}
    </Stack>
  )
}

/**
 * The customer with what is needed for the call: address, telephone, map, planner, how long waiting, calls not
 * reached; and when the customer says no, the reason (reported by who visits, entered at once by a planner).
 */
function Customer({ enquiry, plan, run, children }: { enquiry: VisitEnquiry; plan: VisitPlan; run: Run; children?: React.ReactNode }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // A planner (who may plan for others) declines at once; who visits reports it for a planner to confirm.
  const confirms = plan.visitors.length > 0
  return (
    <div className="visit-customer">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={700}>{enquiry.name}</Text>
          {enquiry.address && <Text size="sm">{enquiry.address}</Text>}
          <Text size="xs" c="dimmed">
            {[enquiry.scope.join(', '), enquiry.planner && `Planer: ${enquiry.planner}`].filter(Boolean).join(' · ')}
          </Text>
          {/* How long the customer has been waiting: on a line of its own, in red. */}
          {enquiry.requestedOn && <Text size="xs" c="red" fw={600}>{waiting(enquiry.requestedOn)}</Text>}
          {enquiry.description && <Text size="xs" fs="italic">{enquiry.description}</Text>}
          {enquiry.call && <Text size="xs" c="red">{callLine(enquiry.call)}</Text>}
          {!onMap(enquiry) && <Text size="xs" c="dimmed">Adresse nicht auf der Karte: Fahrzeit geschätzt.</Text>}
          {enquiry.report && (
            <Text size="xs" c="red" fw={600}>
              Absage gemeldet: {enquiry.report.reason}{enquiry.report.note ? ` (${enquiry.report.note})` : ''} · wartet auf Bestätigung durch den Planer
            </Text>
          )}
        </div>
      </Group>
      <Group gap={6} mt={6}>
        {enquiry.phone && (
          <Button component="a" href={`tel:${enquiry.phone.replace(/[^\d+]/g, '')}`} size="compact-sm" variant="light">
            Anrufen {enquiry.phone}
          </Button>
        )}
        <Button size="compact-sm" variant="default" onClick={() => run(api.notReached(plan.employeeId, enquiry.siteId))}>
          Nicht erreicht
        </Button>
        {!enquiry.report && (
          <Button size="compact-sm" color="red" onClick={() => setDeclining(!declining)}>
            Kunde sagt ab
          </Button>
        )}
        {/* The map last: the call and its outcome belong together. */}
        {enquiry.address && (
          <Button component="a" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enquiry.address)}`}
            target="_blank" rel="noreferrer" size="compact-sm" variant="default">
            Karte
          </Button>
        )}
      </Group>
      {declining && (
        <Stack gap={6} mt={8} className="visit-form">
          <Radio.Group label="Grund der Absage" value={reason} onChange={setReason} required>
            <Stack gap={4} mt={4}>
              {plan.declineReasons.map((r) => <Radio key={r} value={r} label={r} />)}
            </Stack>
          </Radio.Group>
          <TextInput label="Bemerkung" description={reason === 'Sonstiges' ? 'Bei „Sonstiges“ bitte angeben' : undefined}
            maxLength={500} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">
            {confirms ? 'Die Anfrage wird abgelehnt, Termine, die noch kommen, werden aus dem Kalender genommen.'
              : 'Die Absage geht an den Planer; er bestätigt sie.'}
          </Text>
          <Group gap="xs">
            <Button size="compact-sm" color="red" disabled={!reason || (reason === 'Sonstiges' && !note.trim())}
              onClick={async () => (await run(api.declineVisit(plan.employeeId, enquiry.siteId, reason!, note.trim() || null))) && setDeclining(false)}>
              {confirms ? 'Absage eintragen' : 'Absage melden'}
            </Button>
            <Button size="compact-sm" variant="default" onClick={() => setDeclining(false)}>Abbrechen</Button>
          </Group>
        </Stack>
      )}
      {children}
    </div>
  )
}

/** What else is in the plan of the visitor at that time. */
function overlap(plan: VisitPlan, date: string | null, start: string) {
  if (!date || !start) return null
  const from = toMin(start)
  return plan.busy.find((b) => b.date === date && (!b.from || !b.to || (toMin(b.from) < from + ON_SITE && from < toMin(b.to)))) ?? null
}

/** One customer at a time: the list of all enquiries without a visit, the longest waiting on top. */
function SingleVisits({ plan, run }: { plan: VisitPlan; run: Run }) {
  const [open, setOpen] = useState<number | null>(null)
  if (plan.enquiries.length === 0) return <Text c="dimmed">Alle Anfragen haben einen Besichtigungstermin.</Text>
  return (
    <Stack gap="xs">
      {plan.enquiries.map((enquiry) => (
        <Customer key={enquiry.siteId} enquiry={enquiry} plan={plan} run={run}>
          {open === enquiry.siteId ? (
            <AppointmentForm plan={plan} siteId={enquiry.siteId} initialDate={addDays(todayIso(), 1)} initialTime={SINGLE_TIME}
              run={run} onDone={() => setOpen(null)} />
          ) : (
            <Button size="compact-sm" mt={6} onClick={() => setOpen(enquiry.siteId)}>Termin eintragen</Button>
          )}
        </Customer>
      ))}
    </Stack>
  )
}

/** Day and time agreed on the telephone; a warning when something else is planned then. */
function AppointmentForm({ plan, siteId, initialDate, initialTime, fixedDate = false, run, onDone }: {
  plan: VisitPlan; siteId: number; initialDate: string; initialTime: string; fixedDate?: boolean; run: Run; onDone: () => void
}) {
  const [date, setDate] = useState<string | null>(initialDate)
  const [time, setTime] = useState(initialTime)
  const clash = overlap(plan, date, time)
  // Everything the visitor has that day, by time (the whole day first).
  const that = date ? plan.busy.filter((b) => b.date === date).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? '')) : []
  return (
    <Stack gap={6} mt={8} className="visit-form">
      <Group grow align="flex-end">
        {!fixedDate && (
          <DateInput label="Tag" valueFormat="DD.MM.YYYY" minDate={new Date(todayIso())} value={date} onChange={setDate} />
        )}
        <TextInput label="Uhrzeit" type="time" step={900} value={time} onChange={(e) => setTime(e.currentTarget.value)} />
      </Group>
      {date && (
        <div className="visit-that-day">
          <Text size="xs" fw={600}>An diesem Tag schon geplant:</Text>
          {that.length === 0 ? (
            <Text size="xs" c="dimmed">noch nichts</Text>
          ) : (
            that.map((b, i) => (
              <Text key={i} size="xs">
                {b.from && b.to ? `${hm(b.from)}–${hm(b.to)}` : 'ganzer Tag'} · {b.name}
              </Text>
            ))
          )}
        </div>
      )}
      {clash && (
        <Text size="xs" c="orange.8">
          Achtung: am {formatDate(clash.date)} ist schon {clash.name}
          {clash.from && clash.to ? ` (${hm(clash.from)}–${hm(clash.to)})` : ' (ganzer Tag)'}.
        </Text>
      )}
      <Group gap="xs">
        <Button size="compact-sm" disabled={!date || !time}
          onClick={async () => (await run(api.planVisit({ employeeId: plan.employeeId, siteId, date: date!, start: time }))) && onDone()}>
          Speichern
        </Button>
        <Button size="compact-sm" variant="default" onClick={onDone}>Abbrechen</Button>
      </Group>
    </Stack>
  )
}

/** "Welchen Besichtigungstag möchten Sie planen?": the days the planners set aside; an empty one can be released. */
function DayChoice({ plan, region, onChoose, run }: { plan: VisitPlan; region: string; onChoose: (date: string) => void; run: Run }) {
  const open = plan.enquiries.filter((e) => e.region === region).length
  const reserved = plan.days.filter((d) => d.reserved !== false)
  return (
    <Stack gap="xs">
      <Text fw={600}>Welchen Besichtigungstag möchten Sie planen?</Text>
      <Text size="xs" c="dimmed">{open} Anfragen der Region ohne Termin.</Text>
      {reserved.length === 0 && (
        <Text c="dimmed">Keine Besichtigungstage reserviert. Die Planer reservieren sie im Kalender der Angebotsphase.</Text>
      )}
      {reserved.map((day) => (
        <Group key={day.date} gap="xs" wrap="nowrap">
          <Button variant="light" style={{ flex: 1 }} justify="space-between" onClick={() => onChoose(day.date)}
            rightSection={<Text size="xs">{day.visits.length === 0 ? 'noch frei' : `${day.visits.length} Kunden`}</Text>}>
            {formatDate(day.date)}
          </Button>
          {day.visits.length === 0 && (
            <Button variant="default" size="sm" onClick={() => run(api.removeVisitDay(plan.employeeId, day.date))}>
              freigeben
            </Button>
          )}
        </Group>
      ))}
    </Stack>
  )
}

/** A day of visits through a region: the customers agreed so far, a tour suggested, the other customers of the region. */
function RegionDay({ plan, region, date, run }: { plan: VisitPlan; region: string | null; date: string; run: Run }) {
  const day = plan.days.find((d) => d.date === date)
  const enquiries = useMemo(() => (region ? plan.enquiries.filter((e) => e.region === region) : plan.enquiries), [plan.enquiries, region])
  const [tour, setTour] = useState<Tour | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const company = plan.company

  // Customers who said no (reported) are not suggested.
  const suggest = () => setTour(suggestTour(enquiries.filter((e) => onMap(e) && !e.report).map(stopOf), agreedOf(day), company))
  const agreed = new Set(day?.visits.map((v) => v.siteId))
  const inTour = new Set(tour?.rows.flatMap((r) => (r.kind === 'visit' ? [r.siteId] : [])))
  const others = enquiries.filter((e) => !inTour.has(e.siteId))
  const byId = new Map(enquiries.map((e) => [e.siteId, e]))
  const visitById = new Map(day?.visits.map((v) => [v.siteId, v]))
  const freeAt = (enquiry: VisitEnquiry) => {
    const at = nextFree(stopOf(enquiry), agreedOf(day), company)
    return at === null ? null : toTime(at)
  }
  const route = tour
    ? tour.rows.flatMap((r) => (r.kind === 'visit' ? [byId.get(r.siteId)?.address ?? visitById.get(r.siteId)?.address ?? null] : []))
    : (day?.visits ?? []).map((v) => v.address)

  return (
    <Stack gap="sm">
      {day && day.visits.length > 0 && !tour && (
        <div className="visit-agreed">
          <Text fw={600} size="sm">Schon vereinbart</Text>
          {day.visits.map((v) => (
            <Text key={v.entryId} size="sm">✓ {hm(v.from)}–{hm(v.to)} {v.name}{v.address ? ` · ${v.address}` : ''}</Text>
          ))}
        </div>
      )}

      <Group gap="xs">
        <Button onClick={suggest}>{tour ? 'Rest neu berechnen' : 'Tour vorschlagen'}</Button>
        {route.some(Boolean) && (
          <Anchor href={mapsLink([company.address, ...route, company.address])} target="_blank" rel="noreferrer" size="sm">
            Route in Google Maps ›
          </Anchor>
        )}
        {tour && <Button variant="default" onClick={() => setTour(null)}>Vorschlag verwerfen</Button>}
      </Group>
      {tour && (
        <Text size="xs" c="dimmed">
          Abfahrt 7:30 ab {company.address} · je 60 Min. vor Ort · {tour.driving} Min. Fahrt geschätzt · zurück {tour.back} Min.
          Erst wenn der Kunde zusagt, wird der Termin eingetragen.
        </Text>
      )}

      {tour?.rows.map((row) =>
        row.kind === 'lunch' ? (
          <div key="lunch" className="visit-lunch">Mittagspause {toTime(row.start)}–{toTime(row.start + LUNCH)}</div>
        ) : agreed.has(row.siteId) ? (
          <div key={row.siteId} className="visit-row agreed">
            <Text size="sm">✓ {hm(visitById.get(row.siteId)!.from)} {visitById.get(row.siteId)!.name} · Termin angenommen</Text>
          </div>
        ) : byId.has(row.siteId) ? (
          <TourRow key={row.siteId} plan={plan} enquiry={byId.get(row.siteId)!} date={date} start={toTime(row.start)} drive={row.drive} run={run} />
        ) : (
          <div key={row.siteId} className="visit-row gone"><Text size="sm" c="dimmed">Kunde ist inzwischen anders geplant.</Text></div>
        ),
      )}

      <Text fw={600} size="sm" mt="xs">
        {tour ? (region ? 'Weitere Kunden der Region' : 'Weitere Kunden') : region ? `Kunden der Region ${region}, die ältesten oben` : 'Kunden ohne Termin, die ältesten oben'}
      </Text>
      {others.length === 0 && <Text size="sm" c="dimmed">Keine weiteren.</Text>}
      {others.map((enquiry) => {
        const at = freeAt(enquiry)
        return (
          <Customer key={enquiry.siteId} enquiry={enquiry} plan={plan} run={run}>
            {open === enquiry.siteId ? (
              <AppointmentForm plan={plan} siteId={enquiry.siteId} initialDate={date} initialTime={at ?? SINGLE_TIME} fixedDate
                run={run} onDone={() => setOpen(null)} />
            ) : (
              <Button size="compact-sm" mt={6} onClick={() => setOpen(enquiry.siteId)}>
                {at ? `Termin eintragen (frei ab ${at})` : 'Termin eintragen'}
              </Button>
            )}
          </Customer>
        )
      })}
    </Stack>
  )
}

/** A customer of the suggested tour: agreed as suggested, at another time, or on another day of visits. */
function TourRow({ plan, enquiry, date, start, drive, run }: {
  plan: VisitPlan; enquiry: VisitEnquiry; date: string; start: string; drive: number; run: Run
}) {
  const [choice, setChoice] = useState<'time' | 'day' | null>(null)
  const company = plan.company
  const laterDays = plan.days.filter((d) => d.reserved !== false && d.date !== date && d.date >= todayIso())
  return (
    <div className="visit-row">
      <Text size="sm" fw={700} className="visit-time">{start} <Text span size="xs" c="dimmed" fw={400}>· {drive} Min. Fahrt</Text></Text>
      <Customer enquiry={enquiry} plan={plan} run={run}>
        <Group gap={6} mt={6}>
          <Button size="compact-sm" onClick={() => run(api.planVisit({ employeeId: plan.employeeId, siteId: enquiry.siteId, date, start }))}>
            Termin angenommen
          </Button>
          <Button size="compact-sm" variant="default" onClick={() => setChoice(choice === 'time' ? null : 'time')}>Andere Uhrzeit</Button>
          <Button size="compact-sm" variant="default" onClick={() => setChoice(choice === 'day' ? null : 'day')}>Kann an diesem Tag nicht</Button>
        </Group>
        {choice === 'time' && (
          <AppointmentForm plan={plan} siteId={enquiry.siteId} initialDate={date} initialTime={start} fixedDate run={run} onDone={() => setChoice(null)} />
        )}
        {choice === 'day' && (
          <Stack gap={4} mt={8}>
            <Text size="xs" c="dimmed">Nächste Besichtigungstage, jeweils die erste freie Uhrzeit:</Text>
            {laterDays.length === 0 && <Text size="sm" c="dimmed">Keine weiteren Besichtigungstage reserviert: „Einzelne Besichtigung“ nehmen.</Text>}
            {laterDays.map((d) => {
              const at = nextFree(stopOf(enquiry), agreedOf(d), company)
              return (
                <Button key={d.date} size="compact-sm" variant="light" disabled={at === null} justify="flex-start"
                  onClick={() => run(api.planVisit({ employeeId: plan.employeeId, siteId: enquiry.siteId, date: d.date, start: toTime(at!) }))}>
                  {formatDate(d.date)} {at === null ? '· voll' : `um ${toTime(at)} eintragen`}
                </Button>
              )
            })}
          </Stack>
        )}
      </Customer>
    </div>
  )
}
