import { Alert, Anchor, Button, Group, Loader, Menu, MultiSelect, Radio, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, DeclineReport, Entry, Offers, OfferStep, PlanEmployee, Planner, Site, StepInput } from '../api/types'
import { OfferSteps } from '../components/OfferSteps'
import { Sheet } from '../components/Sheet'
import { VisitPlanner } from '../components/VisitPlanner'
import { useLiveChanges } from '../lib/useLiveChanges'
import { callLine } from '../lib/visitText'
import { SiteForm } from '../components/SiteForm'
import { TimeSelect } from '../components/TimeSelect'
import { activityInfo, activityLabel, DECLINE_REASONS, textOfActivity } from '../lib/activities'
import { addDays, CURRENT_YEAR, formatDate, todayIso } from '../lib/dates'
import { FullViewButton } from '../components/FullViewButton'
import { useFullView } from '../lib/fullView'
import { offerSteps, waitingDays } from '../lib/offerSteps'
import { customerName, emptySite, formatAddress, toSiteInput } from '../lib/sites'

/** Where an enquiry stands: its column, the step to plan next, or the appointments of the step ahead. */
interface Stage {
  column: string
  next: Activity | null
  planned: OfferStep[] | null
}

const WAITING = 'Wartet'
/** Waiting for the yes: slate, calm (the customer's turn), with white writing. */
const WAITING_COLOUR = '#5b6f77'

/** "2026-11-19" -> "Do 19.11." */
const shortDate = (iso: string) => formatDate(iso).slice(0, -4)
/** "09:00:00" -> "09:00" */
const hm = (time: string | null) => time?.slice(0, 5) ?? ''

function stageOf(site: Site, steps: OfferStep[], order: Activity[], today: string): Stage {
  for (const [index, activity] of order.entries()) {
    const own = steps.filter((step) => step.siteId === site.id && step.activity === activity)
    if (own.length === 0) return { column: index === 0 ? 'Anfrage' : activity, next: activity, planned: null }
    // The next appointment ahead (a step may have several, e.g. a second Objektauswahl).
    const ahead = own.filter((step) => step.date > today)
    if (ahead.length > 0) return { column: activity, next: null, planned: ahead.filter((step) => step.date === ahead[0].date) }
  }
  return { column: WAITING, next: null, planned: null }
}

/** Sorts a card by its next appointment (date and time); cards without one go last ("~" sorts after digits). */
const appointmentKey = (stage: Stage) =>
  stage.planned ? `${stage.planned[0].date} ${stage.planned[0].startTime ?? ''}` : '~'

/** Sorts a waiting card by when its offer was handed over (the last Angebotsübergabe). */
const handedOverKey = (site: Site, steps: OfferStep[]) =>
  steps
    .filter((step) => step.siteId === site.id && step.activity === 'Angebotsuebergabe')
    .map((step) => `${step.date} ${step.startTime ?? ''}`)
    .sort()
    .at(-1) ?? '~'

/** Steps that may need more than one appointment (as on the server). */
const REPEATABLE: Activity[] = ['Objektauswahl']

/** The appointments of an enquiry: the entries of one step on one day (one per employee). */
function appointmentsOf(own: OfferStep[], order: Activity[]) {
  const list: { activity: Activity; date: string; entries: OfferStep[] }[] = []
  for (const activity of order) {
    for (const step of own.filter((s) => s.activity === activity)) {
      const same = list.find((a) => a.activity === activity && a.date === step.date)
      if (same) same.entries.push(step)
      else list.push({ activity, date: step.date, entries: [step] })
    }
  }
  return list
}

/** The step dialog: which step, for whom, when. */
export interface StepDraft {
  site: Site
  activity: Activity
  /** The appointment it replaces (moved), if planned before. */
  current: OfferStep[]
  /** One more appointment of the step (a second Objektauswahl). */
  another?: boolean
}

/**
 * The heads of the columns stay right below the row at the top while the enquiries scroll by: told how far down
 * that row reaches (it may take two lines on a phone).
 */
function followIntro(intro: HTMLDivElement | null) {
  if (!intro || typeof ResizeObserver === 'undefined') return
  const page = intro.parentElement!
  const measure = () => {
    const top = parseFloat(getComputedStyle(intro).top) || 0
    page.style.setProperty('--offer-intro-bottom', `${intro.offsetHeight + top}px`)
  }
  const observer = new ResizeObserver(measure)
  observer.observe(intro)
  measure()
  return () => observer.disconnect()
}

/** A click on the card itself, not on one of its buttons, fields or menus. */
const onCard = (event: MouseEvent<HTMLElement>) => {
  const target = event.target as HTMLElement
  return event.currentTarget.contains(target) && !target.closest('button, a, input, textarea, [role="combobox"], [role="option"]')
}

/**
 * The offer phase as an overview: every enquiry a card, in the column of its step. The steps come in their
 * fixed order and each once; when the day of a step has passed, the card moves on by itself. At the end the
 * customer says yes (Bauphase from its start) or no (with a reason), at any step.
 */
export function OfferBoardPage({ head }: { head?: ReactNode }) {
  const [offers, setOffers] = useState<Offers | null>(null)
  const [people, setPeople] = useState<PlanEmployee[]>([])
  const [planners, setPlanners] = useState<Planner[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [visiting, setVisiting] = useState(false)
  const [editing, setEditing] = useState<Site | null>(null)
  const { full, toggle: toggleFull } = useFullView()
  const [step, setStep] = useState<StepDraft | null>(null)
  const [accepting, setAccepting] = useState<Site | null>(null)
  const [declining, setDeclining] = useState<Site | null>(null)
  // A reported no being confirmed: its reason preset.
  const [confirming, setConfirming] = useState<DeclineReport | null>(null)
  const today = todayIso()

  const load = useCallback(() => {
    api.offers().then(setOffers, (e) => setError(messageOf(e)))
  }, [])
  // Changed by somebody else: the enquiries loaded anew.
  useLiveChanges(load)
  useEffect(() => {
    load()
    api.planners().then(setPlanners, () => {})
    // Who can do a step: the planners, and craftsmen with the activity (e.g. Besichtigung).
    api.plan(CURRENT_YEAR).then((plan) => {
      const all = [...plan.employees, ...(plan.planners ?? [])]
      setPeople(all.filter((person, index) => all.findIndex((other) => other.id === person.id) === index))
    }, () => {})
  }, [load])

  const order = useMemo(() => offers?.stepActivities ?? [], [offers])
  const columns = useMemo(
    () => [
      { key: 'Anfrage', label: activityLabel('Anfrage') ?? 'Anfrage', activity: 'Anfrage' as Activity },
      ...order.map((activity) => ({ key: activity, label: activityLabel(activity) ?? activity, activity })),
      { key: WAITING, label: 'Wartet auf Zusage', activity: null },
    ],
    [order],
  )
  const plannerName = (id: number | null | undefined) => planners.find((planner) => planner.id === id)?.name

  if (error) return <Alert color="red" m="md">{error}</Alert>
  if (!offers) return <Loader m="md" />

  const decide = async (work: Promise<Offers>, message: string) => {
    const next = await work
    setOffers(next)
    notifications.show({ message, color: 'green' })
  }

  const changePlanner = async (site: Site, plannerId: number) => {
    try {
      await api.updateSite(site.id, { ...toSiteInput(site), responsiblePlannerId: plannerId })
      notifications.show({ message: `${site.name}: jetzt bei ${plannerName(plannerId)}.`, color: 'green' })
      load()
    } catch (e) {
      notifications.show({ message: messageOf(e), color: 'red' })
    }
  }

  const card = (site: Site) => {
    const stage = stageOf(site, offers.steps, order, today)
    const own = offers.steps.filter((s) => s.siteId === site.id)
    const call = offers.calls?.find((c) => c.siteId === site.id)
    const report = offers.reports?.find((r) => r.siteId === site.id)
    // The dots and the waiting days, worked out as in the calendar.
    const lib = offerSteps(site, own as unknown as Entry[], today)
    const waiting = stage.column === WAITING ? null : waitingDays(lib, today)
    const address = formatAddress(site)
    const appointments = appointmentsOf(own, order)
    const columnActivity = columns.find((c) => c.key === stage.column)?.activity
    const colour = (columnActivity ? activityInfo(columnActivity)?.background : undefined) ?? WAITING_COLOUR
    // One more appointment of a step that may have several: only while the card is in its column (the steps
    // before it done, e.g. not while the visit is still ahead); moved on to the next step, it is no longer offered.
    const repeat = REPEATABLE.find((activity) => {
      const after = order[order.indexOf(activity) + 1]
      return stage.column === activity && own.some((s) => s.activity === activity) && !own.some((s) => s.activity === after)
    })
    const labelOf = (activity: Activity, date: string) => {
      const ofStep = appointments.filter((a) => a.activity === activity)
      return `${activityLabel(activity)}${ofStep.length > 1 ? ` ${ofStep.findIndex((a) => a.date === date) + 1}` : ''}`
    }
    const done = appointments.filter((a) => a.date <= today)
    const ahead = appointments.filter((a) => a.date > today)
    return (
      <article
        key={site.id}
        className="offer-card"
        style={{ '--card-edge': colour } as CSSProperties}
        onClick={(event) => onCard(event) && setEditing(site)}
      >
        <button type="button" className="offer-card-name" onClick={() => setEditing(site)} title="Anfrage öffnen">
          {customerName(site)}
        </button>
        {(address || site.clientPhone) && (
          <div className="offer-meta">
            {address && <span>{address}</span>}
            {site.clientPhone && (
              <a href={`tel:${site.clientPhone.replace(/[^\d+]/g, '')}`} className="offer-phone">
                ☎ {site.clientPhone}
              </a>
            )}
          </div>
        )}
        {/* What the customer would like done: the scope as small labels, the details below. */}
        {((site.scope?.length ?? 0) > 0 || site.description) && (
          <div className="offer-scope">
            {site.scope?.map((scope) => <span key={scope}>{scope}</span>)}
            {site.description && <em>{site.description}</em>}
          </div>
        )}
        <ul className="offer-history">
          {site.requestedOn && <li>Anfrage {shortDate(site.requestedOn)}</li>}
          {done.map(({ activity, date }) => (
            <li key={`${activity}-${date}`}>
              {labelOf(activity, date)} {shortDate(date)}
            </li>
          ))}
        </ul>
        {/* The appointments ahead: a click moves one. */}
        {ahead.map(({ activity, date, entries }) => (
          <button
            key={`${activity}-${date}`}
            type="button"
            className="offer-appointment"
            title="Termin verschieben"
            onClick={() => setStep({ site, activity, current: entries })}
          >
            <b>{labelOf(activity, date)}</b> {shortDate(date)} {hm(entries[0].startTime)} · {entries.map((e) => e.employeeName).join(', ')}
          </button>
        ))}
        {/* A no reported by who visits: a planner confirms it (the reason preset) or discards it. */}
        {report && (
          <div className="offer-report">
            <span>
              <b>Absage gemeldet</b> von {report.by}: {report.reason}
              {report.note ? ` (${report.note})` : ''}
            </span>
            <Group gap={6} mt={4}>
              <Button size="compact-xs" color="red" onClick={() => {
                setConfirming(report)
                setDeclining(site)
              }}>
                Absage bestätigen
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => api.discardDeclineReport(site.id).then(setOffers, (e) => notifications.show({ color: 'red', message: messageOf(e) }))}>
                Verwerfen
              </Button>
            </Group>
          </div>
        )}
        {/* Called for the visit and not reached: the planners can answer when the customer asks. */}
        {call && !own.some((s) => s.activity === 'Besichtigung') && <div className="offer-call">{callLine(call)}</div>}
        <div className="offer-meta offer-meta-row">
          <span>
            Planer: <b>{plannerName(site.responsiblePlannerId) ?? '–'}</b>
          </span>
          {/* The planner in charge; a click changes it. */}
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <button type="button" className="offer-link" aria-label={`Zuständigen Planer für ${site.name} ändern`}>
                ändern
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Zuständiger Planer</Menu.Label>
              {planners.map((p) => (
                <Menu.Item key={p.id} onClick={() => p.id !== site.responsiblePlannerId && changePlanner(site, p.id)}>
                  {p.id === site.responsiblePlannerId ? '✓ ' : ''}
                  {p.name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>
        <Group gap={8}>
          <OfferSteps steps={lib} waiting={waiting} />
        </Group>
        <Group gap={6}>
          {stage.planned && (
            <Button size="compact-xs" variant="default" onClick={() => setStep({ site, activity: stage.planned![0].activity, current: stage.planned! })}>
              Termin verschieben
            </Button>
          )}
          {stage.next && (
            <Button size="compact-xs" onClick={() => setStep({ site, activity: stage.next!, current: [] })}>
              {activityLabel(stage.next)} planen
            </Button>
          )}
          {repeat && (
            <Button size="compact-xs" variant="light" onClick={() => setStep({ site, activity: repeat, current: [], another: true })}>
              + weitere {activityLabel(repeat)}
            </Button>
          )}
          {stage.column === WAITING && (
            <>
              <Button size="compact-xs" onClick={() => setAccepting(site)}>
                Zusage
              </Button>
              <Button size="compact-xs" color="red" onClick={() => setDeclining(site)}>
                Abgelehnt
              </Button>
            </>
          )}
        </Group>
      </article>
    )
  }

  const accepted = offers.decided.filter((d) => d.status === 'Bauphase')
  const declined = offers.decided.filter((d) => d.status === 'Abgelehnt')

  return (
    <div className="offer-board-page">
      {/* One row: the switch to the calendar, a new enquiry, Vollbild. */}
      <Group justify="space-between" gap="sm" className="offer-intro" ref={followIntro}>
        {head ?? <span />}
        <Group gap="sm">
          <Button variant="light" onClick={() => setVisiting(true)}>Besichtigungen planen</Button>
          <Button onClick={() => setCreating(true)}>+ Neue Anfrage</Button>
          <FullViewButton full={full} onToggle={toggleFull} what="die Übersicht" />
        </Group>
      </Group>

      <div className="offer-board">
        {columns.map((column) => {
          const list = offers.sites
            .map((site) => ({ site, stage: stageOf(site, offers.steps, order, today) }))
            .filter(({ stage }) => stage.column === column.key)
            // The next appointment on top, enquiries still to plan after them in the order they came in; waiting for
            // the yes, the offer handed over longest ago on top.
            .sort((a, b) =>
              column.key === WAITING
                ? handedOverKey(a.site, offers.steps).localeCompare(handedOverKey(b.site, offers.steps))
                : appointmentKey(a.stage).localeCompare(appointmentKey(b.stage)),
            )
            .map(({ site }) => site)
          const info = column.activity ? activityInfo(column.activity) : null
          return (
            <section key={column.key} className="offer-column" aria-label={column.label}>
              <h3
                style={{
                  background: info?.background ?? WAITING_COLOUR,
                  color: column.activity ? textOfActivity(column.activity) : '#ffffff',
                }}
              >
                {column.label}
                <span className="offer-count">{list.length}</span>
              </h3>
              {list.length > 0 ? list.map(card) : <div className="offer-empty">Keine</div>}
            </section>
          )
        })}
      </div>

      <div className="offer-decided">
        <section>
          <h4>Zusage → Bauphase (letzte 60 Tage)</h4>
          {accepted.length === 0 ? (
            <Text size="sm" c="dimmed">Noch keine.</Text>
          ) : (
            <ul>
              {accepted.map((d) => (
                <li key={d.siteId}>
                  <Anchor href={`#/baustellen/${d.siteId}`}>{d.name}</Anchor>
                  {d.plannedStart ? `: Baubeginn ${formatDate(d.plannedStart)}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>Abgelehnt (letzte 60 Tage)</h4>
          {declined.length === 0 ? (
            <Text size="sm" c="dimmed">Noch keine.</Text>
          ) : (
            <ul>
              {declined.map((d) => (
                <li key={d.siteId}>
                  {d.name}: {d.declineReason}
                  {d.declineNote ? ` (${d.declineNote})` : ''}
                  {d.declineStep && DECLINE_STEPS[d.declineStep] ? <Text span size="xs" c="dimmed"> · {DECLINE_STEPS[d.declineStep]}</Text> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {visiting && <VisitPlanner onClose={() => setVisiting(false)} onChanged={load} />}
      {creating && (
        <SiteForm
          title="Neue Anfrage"
          initial={{ ...emptySite, status: 'Angebot', scope: [] }}
          enquiry
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const site = await api.createSite({ ...input, status: 'Angebot', isService: false, isTentative: false })
            setCreating(false)
            notifications.show({ message: `Anfrage „${site.name}“ angelegt.`, color: 'green' })
            load()
          }}
        />
      )}
      {editing && (
        <SiteForm
          title={`Anfrage · ${editing.name}`}
          initial={toSiteInput(editing)}
          enquiry
          extra={
            <Button
              variant="subtle"
              color="red"
              onClick={() => {
                setDeclining(editing)
                setEditing(null)
              }}
            >
              Kunde hat abgesagt
            </Button>
          }
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await api.updateSite(editing.id, input)
            setEditing(null)
            notifications.show({ message: 'Anfrage gespeichert.', color: 'green' })
            load()
          }}
        />
      )}
      {step && (
        <StepDialog
          draft={step}
          steps={offers.steps}
          order={order}
          people={people}
          onClose={() => setStep(null)}
          onDecline={() => {
            setDeclining(step.site)
            setStep(null)
          }}
          onSave={async (input) => {
            setOffers(await api.planOfferStep(step.site.id, input))
            setStep(null)
            notifications.show({
              message: `${activityLabel(input.activity)} für ${step.site.name} am ${formatDate(input.date)} eingetragen.`,
              color: 'green',
            })
          }}
        />
      )}
      {accepting && (
        <AcceptDialog
          site={accepting}
          onClose={() => setAccepting(null)}
          onSave={async (start) => {
            await decide(api.acceptOffer(accepting.id, start), `${accepting.name} ist jetzt in der Bauphase, Baubeginn ${formatDate(start)}.`)
            setAccepting(null)
          }}
        />
      )}
      {declining && (
        <DeclineDialog
          site={declining}
          preset={confirming?.siteId === declining.id ? confirming : undefined}
          onClose={() => {
            setDeclining(null)
            setConfirming(null)
          }}
          onSave={async (reason, note) => {
            await decide(api.declineOffer(declining.id, reason, note), `${declining.name}: abgelehnt.`)
            setDeclining(null)
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}

/** How long an appointment of a step takes: the Objektauswahl three hours, the others an hour. */
const durationOf = (activity: Activity) => (activity === 'Objektauswahl' ? 180 : 60)

/** "HH:MM" that many minutes later (at most 23:59). */
const plusMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function StepDialog({
  draft,
  steps,
  order,
  people,
  onClose,
  onSave,
  onDecline,
}: {
  draft: StepDraft
  steps: OfferStep[]
  order: Activity[]
  people: PlanEmployee[]
  onClose: () => void
  onSave: (input: StepInput) => Promise<void>
  /** The customer says no on the telephone instead: the window of the reason. */
  onDecline?: () => void
}) {
  const { site, activity, current, another = false } = draft
  const index = order.indexOf(activity)
  const before = index > 0 ? steps.filter((s) => s.siteId === site.id && s.activity === order[index - 1]) : []
  // One more appointment: after the ones there are (the step before is behind them anyway).
  const earlier = another ? steps.filter((s) => s.siteId === site.id && s.activity === activity) : before
  const earliest = earlier.length ? earlier.map((s) => s.date).sort().at(-1)! : todayIso()
  // Who does it: craftsmen given this activity, and the planners; the planner in charge first.
  const able = people
    .filter((person) => person.isPlaner || person.additionalActivities.includes(activity))
    .sort((a, b) => Number(!!a.isPlaner) - Number(!!b.isPlaner) || a.name.localeCompare(b.name))
  const preset =
    current.length > 0
      ? current.map((s) => String(s.employeeId))
      : activity === 'Besichtigung'
        ? able.filter((p) => !p.isPlaner).slice(0, 1).map((p) => String(p.id))
        : site.responsiblePlannerId
          ? [String(site.responsiblePlannerId)]
          : []
  const [who, setWho] = useState<string[]>(preset)
  // The list of who closes once someone is picked, so the buttons below can be reached.
  const [choosing, setChoosing] = useState(false)
  const [date, setDate] = useState<string | null>(current[0]?.date ?? (earliest > todayIso() ? earliest : addDays(todayIso(), 1)))
  const [start, setStart] = useState(hm(current[0]?.startTime ?? null) || '09:00')
  const later = (time: string) => plusMinutes(time, durationOf(activity))
  const [end, setEnd] = useState(hm(current[0]?.endTime ?? null) || later('09:00'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!date || !start || !end || who.length === 0) {
      setError('Bitte Tag, Uhrzeit und wer angeben.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave({
        activity,
        employeeIds: who.map(Number),
        date,
        startTime: start,
        endTime: end,
        another: another || undefined,
        from: current[0]?.date,
      })
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet title={`${another ? 'Weitere ' : ''}${activityLabel(activity)} · ${site.name}`} onClose={onClose} size="md">
      <Stack gap="sm">
        <DateInput
          label="Tag"
          valueFormat="DD.MM.YYYY"
          minDate={new Date(earliest > todayIso() ? earliest : todayIso())}
          value={date}
          onChange={setDate}
        />
        <Group grow>
          <TimeSelect
            label="von"
            quarter
            value={start}
            onChange={(value) => {
              setStart(value)
              // The usual length of the step, unless the end was set otherwise already.
              if (value && (!end || end <= value)) setEnd(later(value))
              else if (value && end === later(start)) setEnd(later(value))
            }}
          />
          <TimeSelect label="bis" quarter value={end} onChange={setEnd} after={start} />
        </Group>
        <MultiSelect
          label="Wer"
          data={able.map((person) => ({ value: String(person.id), label: person.isPlaner ? `${person.name} (Planer)` : person.name }))}
          value={who}
          onChange={(value) => {
            setWho(value)
            setChoosing(false)
          }}
          dropdownOpened={choosing}
          onDropdownOpen={() => setChoosing(true)}
          onDropdownClose={() => setChoosing(false)}
          comboboxProps={{ withinPortal: true }}
        />
        <Text size="xs" c="dimmed">
          {current.length > 0
            ? 'Der Termin wird verschoben, es entsteht kein zweiter.'
            : another
              ? `Ein weiterer Termin, nach dem am ${formatDate(earliest)}.`
              : before.length > 0
              ? `Nach ${activityLabel(order[index - 1])} am ${formatDate(earliest)}.`
              : 'Der Termin kommt in den Kalender der gewählten Mitarbeiter.'}
        </Text>
        {error && <Alert color="red" variant="light">{error}</Alert>}
        <Group justify="flex-end">
          {onDecline && (
            <Button color="red" mr="auto" onClick={onDecline}>
              Kunde sagt ab
            </Button>
          )}
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={busy} onClick={save}>
            {current.length > 0 ? 'Verschieben' : 'In den Kalender eintragen'}
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

function AcceptDialog({ site, onClose, onSave }: { site: Site; onClose: () => void; onSave: (start: string) => Promise<void> }) {
  const [start, setStart] = useState<string | null>(site.plannedStart ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Sheet title={`Zusage · ${site.name}`} onClose={onClose} size="sm">
      <Stack gap="sm">
        <DateInput label="Baubeginn" valueFormat="DD.MM.YYYY" required value={start} onChange={setStart} />
        <Text size="xs" c="dimmed">Die Baustelle wechselt in die Bauphase und bekommt ihre Tätigkeiten. In der Statistik zählt sie als Zusage.</Text>
        {error && <Alert color="red" variant="light">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            loading={busy}
            disabled={!start}
            onClick={() => {
              setBusy(true)
              onSave(start!).catch((e) => {
                setError(messageOf(e))
                setBusy(false)
              })
            }}
          >
            Bauphase beginnen
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

/** Where the customer said no, in words. */
export const DECLINE_STEPS: Record<string, string> = {
  Besichtigung: 'bei der Terminvereinbarung zur Besichtigung',
  Objektauswahl: 'bei der Objektauswahl',
  Angebotsuebergabe: 'bei der Angebotsübergabe',
  Wartet: 'nach der Angebotsübergabe',
}

export function DeclineDialog({
  site,
  preset,
  onClose,
  onSave,
}: {
  site: Site
  /** A no reported by who visits: its reason and words, to confirm. */
  preset?: { reason: string; note: string | null }
  onClose: () => void
  onSave: (reason: string, note: string | null) => Promise<void>
}) {
  const [reason, setReason] = useState<string | null>(preset?.reason ?? null)
  const [note, setNote] = useState(preset?.note ?? '')
  // The reasons of the step where the customer stands (the list of the offer until they are there).
  const [step, setStep] = useState<{ step: string; reasons: string[] } | null>(null)
  useEffect(() => {
    api.declineReasons(site.id).then(setStep, () => setStep({ step: 'Wartet', reasons: DECLINE_REASONS }))
  }, [site.id])
  const reasons = step?.reasons ?? DECLINE_REASONS
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsNote = reason === 'Sonstiges' && !note.trim()
  return (
    <Sheet title={`Abgelehnt · ${site.name}`} onClose={onClose} size="sm">
      <Stack gap="sm">
        <Text size="sm">
          Der Kunde hat abgesagt{step && DECLINE_STEPS[step.step] ? ` ${DECLINE_STEPS[step.step]}` : ''}. Die Anfrage verschwindet aus
          der Übersicht, Termine, die noch kommen, werden aus dem Kalender genommen.
        </Text>
        <Radio.Group label="Grund der Absage" value={reason} onChange={setReason} required>
          <Stack gap={6} mt={4}>
            {reasons.map((r) => (
              <Radio key={r} value={r} label={r} />
            ))}
          </Stack>
        </Radio.Group>
        <TextInput
          label="Bemerkung"
          description={reason === 'Sonstiges' ? 'Bei „Sonstiges“ bitte angeben' : undefined}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        {error && <Alert color="red" variant="light">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            color="red"
            loading={busy}
            disabled={!reason || needsNote}
            onClick={() => {
              setBusy(true)
              onSave(reason!, note.trim() || null).catch((e) => {
                setError(messageOf(e))
                setBusy(false)
              })
            }}
          >
            Abgelehnt
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}
