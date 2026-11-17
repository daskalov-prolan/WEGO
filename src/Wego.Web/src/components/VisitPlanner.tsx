import { Alert, Button, Group, Loader, Radio, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { VisitDay, VisitEnquiry, VisitPlan } from '../api/types'
import { addDays, formatDate, isoWeek, todayIso } from '../lib/dates'
import { callLine, shortDate, waiting } from '../lib/visitText'
import { Sheet } from './Sheet'
import { VisitMap } from './VisitMap'

/**
 * Planning the visits of the enquiries, for whoever goes out to them (or a planner for them). The first page: how
 * many customers wait (all, per region) and the days of visits planned for everybody. Then the customers, all or
 * those of a region, one at a time on any day (16:00 by default), as a list or on the map; who visits sets the
 * tours himself. Each visit is an hour on site.
 */

/** The customers: all (region null) or those of a region; as a list or on the map. */
type Mode = { region: string | null; map: boolean }

const SINGLE_TIME = '16:00'
/** An hour on site. */
const ON_SITE = 60

const hm = (time: string) => time.slice(0, 5)
const toMin = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
const dayKey = (day: Pick<VisitDay, 'employeeId' | 'date'>) => `${day.employeeId}|${day.date}`

/** date: opened from a visit in the calendar, the first page shows that day of the visitor open. */
export function VisitPlanner({ employeeId, date, onClose, onChanged }: { employeeId?: number; date?: string; onClose: () => void; onChanged?: () => void }) {
  const [plan, setPlan] = useState<VisitPlan | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  // The customer whose appointment is being entered (also from the map).
  const [open, setOpen] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(date && employeeId ? `${employeeId}|${date}` : null)
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
  const list = mode === null ? '' : mode.region ? `Besichtigungen ${mode.region}` : 'Alle Besichtigungen'
  const title = mode === null ? 'Besichtigungen planen' : mode.map ? `${list} · Karte` : list
  const region = mode?.region ?? null
  const enquiries = useMemo(() => (plan ? plan.enquiries.filter((e) => !region || e.region === region) : []), [plan, region])
  const visits = useMemo(
    () => (plan ? plan.days.flatMap((day) => day.visits.filter((v) => !region || v.region === region).map((visit) => ({ visit, day }))) : []),
    [plan, region],
  )

  return (
    <Sheet title={title} onClose={close} size="xl" full>
      {!plan ? (
        error ? <Alert color="red" variant="light">{error}</Alert> : <Loader />
      ) : (
        <Stack gap="sm" className="visit-planner">
          {plan.visitors.length > 0 && !mode?.map && (
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
            <>
              <ModeChoice plan={plan} onChoose={(region) => setMode({ region, map: false })} />
              <PlannedDays plan={plan} expanded={expanded} onExpand={setExpanded} run={run} />
            </>
          ) : (
            <>
              <Group gap="xs" justify="space-between">
                <Group gap="xs">
                  <Button className="visit-back" variant="default" onClick={() => setMode(mode.map ? { ...mode, map: false } : null)}>
                    ‹ {mode.map ? 'zurück zur Liste' : 'zurück'}
                  </Button>
                  {visitorName && !mode.map && <Text size="sm" c="dimmed">für {visitorName}</Text>}
                </Group>
                {!mode.map && (
                  <Button variant="outline" color="red" onClick={() => setMode({ ...mode, map: true })}>
                    Auf Karte anzeigen
                  </Button>
                )}
              </Group>
              {mode.map ? (
                <VisitMap
                  enquiries={enquiries}
                  visits={visits}
                  branches={plan.branches}
                  onPlan={(siteId) => {
                    setMode({ ...mode, map: false })
                    setOpen(siteId)
                  }}
                />
              ) : (
                <CustomerList plan={plan} enquiries={enquiries} open={open} onOpen={setOpen} run={run} />
              )}
            </>
          )}
        </Stack>
      )}
    </Sheet>
  )
}

type Run = (change: Promise<VisitPlan>) => Promise<boolean>

/** "Was möchten Sie planen?": all customers waiting, or those of a region; the number in red. */
function ModeChoice({ plan, onChoose }: { plan: VisitPlan; onChoose: (region: string | null) => void }) {
  const count = (n: number) => <span className="visit-count">{n}</span>
  return (
    <Stack gap="xs">
      <Text fw={600}>Was möchten Sie planen?</Text>
      <Button variant="light" size="md" justify="space-between" onClick={() => onChoose(null)} rightSection={count(plan.enquiries.length)}>
        Alle Besichtigungen
      </Button>
      {plan.regions.map((region) => (
        <Button key={region} variant="light" size="md" justify="space-between" onClick={() => onChoose(region)}
          rightSection={count(plan.enquiries.filter((e) => e.region === region).length)}>
          Besichtigungen {region}
        </Button>
      ))}
    </Stack>
  )
}

/**
 * "Geplante Besichtigungstage": the days of visits of everybody, by week; a tap shows the customers of the day. A day
 * set aside without customers can be released (by a planner, or by who visits on his own day).
 */
function PlannedDays({ plan, expanded, onExpand, run }: { plan: VisitPlan; expanded: string | null; onExpand: (key: string | null) => void; run: Run }) {
  const planner = plan.visitors.length > 0
  return (
    <Stack gap={6} mt="sm">
      <div>
        <Text fw={700} size="lg">Geplante Besichtigungstage</Text>
        <Text size="xs" c="dimmed">Alle Besichtiger · antippen zeigt die Kunden</Text>
      </div>
      {plan.days.length === 0 && <Text size="sm" c="dimmed">Noch keine Besichtigungen geplant.</Text>}
      {plan.days.map((day, index) => {
        const key = dayKey(day)
        const week = isoWeek(day.date)
        const newWeek = index === 0 || isoWeek(plan.days[index - 1].date) !== week || plan.days[index - 1].date.slice(0, 4) !== day.date.slice(0, 4)
        const isOpen = expanded === key
        const count = day.visits.length
        return (
          <div key={key}>
            {newWeek && <div className="visit-week">KW {week}</div>}
            <div className={isOpen ? 'visit-day-card open' : 'visit-day-card'}>
              <div className="visit-day-row">
                <button type="button" className="visit-day-toggle" disabled={count === 0} aria-expanded={count > 0 ? isOpen : undefined}
                  onClick={() => onExpand(isOpen ? null : key)}>
                  <span className="visit-day-date">{shortDate(day.date)}</span>
                  <span className="visit-day-who">{day.employee}</span>
                  {count > 0 ? (
                    <span className="visit-day-count">{count === 1 ? '1 Kunde' : `${count} Kunden`} {isOpen ? '▴' : '▾'}</span>
                  ) : (
                    <span className="visit-day-count free">reserviert, frei</span>
                  )}
                </button>
                {count === 0 && (planner || day.employeeId === plan.employeeId) && (
                  <Button size="compact-sm" variant="default" onClick={() => run(api.removeVisitDay(day.employeeId, day.date))}>
                    freigeben
                  </Button>
                )}
              </div>
              {isOpen && (
                <div className="visit-day-visits">
                  {day.visits.map((v) => (
                    <div key={v.entryId}>
                      <Text size="sm"><b className="visit-time">{hm(v.from)}</b> {v.name}</Text>
                      {v.address && <Text size="xs" c="dimmed">{v.address}</Text>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </Stack>
  )
}

/** The customers without a visit, the longest waiting on top; one opened to enter the appointment. */
function CustomerList({ plan, enquiries, open, onOpen, run }: {
  plan: VisitPlan; enquiries: VisitEnquiry[]; open: number | null; onOpen: (siteId: number | null) => void; run: Run
}) {
  // Opened from the map: the customer scrolled into view.
  useEffect(() => {
    if (open !== null) document.querySelector(`[data-visit-site="${open}"]`)?.scrollIntoView({ block: 'center' })
  }, [open])
  if (enquiries.length === 0) return <Text c="dimmed">Alle Anfragen haben einen Besichtigungstermin.</Text>
  return (
    <Stack gap="xs">
      {enquiries.map((enquiry) => (
        <Customer key={enquiry.siteId} enquiry={enquiry} plan={plan} run={run}
          actions={open !== enquiry.siteId && <Button size="compact-sm" onClick={() => onOpen(enquiry.siteId)}>Termin eintragen</Button>}>
          {open === enquiry.siteId && (
            <AppointmentForm plan={plan} siteId={enquiry.siteId} initialDate={addDays(todayIso(), 1)} initialTime={SINGLE_TIME}
              run={run} onDone={() => onOpen(null)} />
          )}
        </Customer>
      ))}
    </Stack>
  )
}

/**
 * The customer with what is needed for the call: address, telephone, planner, how long waiting, calls not reached.
 * Below: calling and not reached; the appointment (actions) with the map; what opens for it (children); at the
 * bottom, when the customer says no, the reason (reported by who visits, entered at once by a planner).
 */
function Customer({ enquiry, plan, run, actions, children }: {
  enquiry: VisitEnquiry; plan: VisitPlan; run: Run; actions?: React.ReactNode; children?: React.ReactNode
}) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // A planner (who may plan for others) declines at once; who visits reports it for a planner to confirm.
  const confirms = plan.visitors.length > 0
  return (
    <div className="visit-customer" data-visit-site={enquiry.siteId}>
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
      </Group>
      {(actions || enquiry.address) && (
        <Group gap={6} mt={6}>
          {actions}
          {enquiry.address && (
            <Button component="a" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enquiry.address)}`}
              target="_blank" rel="noreferrer" size="compact-sm" variant="default">
              Karte
            </Button>
          )}
        </Group>
      )}
      {children}
      {!enquiry.report && (
        <Button size="compact-sm" color="red" mt={6} onClick={() => setDeclining(!declining)}>
          Kunde sagt ab
        </Button>
      )}
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
    </div>
  )
}

/** What else is in the plan of the visitor at that time. */
function overlap(plan: VisitPlan, date: string | null, start: string) {
  if (!date || !start) return null
  const from = toMin(start)
  return plan.busy.find((b) => b.date === date && (!b.from || !b.to || (toMin(b.from) < from + ON_SITE && from < toMin(b.to)))) ?? null
}

/** Day and time agreed on the telephone; what is planned that day already, and a warning when something else is then. */
function AppointmentForm({ plan, siteId, initialDate, initialTime, run, onDone }: {
  plan: VisitPlan; siteId: number; initialDate: string; initialTime: string; run: Run; onDone: () => void
}) {
  const [date, setDate] = useState<string | null>(initialDate)
  const [time, setTime] = useState(initialTime)
  const clash = overlap(plan, date, time)
  // Everything the visitor has that day, by time (the whole day first).
  const that = date ? plan.busy.filter((b) => b.date === date).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? '')) : []
  return (
    <Stack gap={6} mt={8} className="visit-form">
      <Group grow align="flex-end">
        <DateInput label="Tag" valueFormat="DD.MM.YYYY" minDate={new Date(todayIso())} value={date} onChange={setDate} />
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
