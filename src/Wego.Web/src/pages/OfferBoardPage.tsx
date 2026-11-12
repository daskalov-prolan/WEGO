import { Alert, Anchor, Badge, Button, Group, Loader, MultiSelect, Radio, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Activity, Entry, Offers, OfferStep, PlanEmployee, Planner, Site, StepInput } from '../api/types'
import { OfferSteps } from '../components/OfferSteps'
import { Sheet } from '../components/Sheet'
import { SiteForm } from '../components/SiteForm'
import { TimeSelect } from '../components/TimeSelect'
import { activityInfo, activityLabel, DECLINE_REASONS, textOfActivity } from '../lib/activities'
import { addDays, CURRENT_YEAR, formatDate, todayIso } from '../lib/dates'
import { offerSteps, waitingDays } from '../lib/offerSteps'
import { emptySite, formatAddress, toSiteInput } from '../lib/sites'

/** Where an enquiry stands: its column, the step to plan next, or the appointments of the step ahead. */
interface Stage {
  column: string
  next: Activity | null
  planned: OfferStep[] | null
}

const WAITING = 'Wartet'

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
interface StepDraft {
  site: Site
  activity: Activity
  /** The appointment it replaces (moved), if planned before. */
  current: OfferStep[]
  /** One more appointment of the step (a second Objektauswahl). */
  another?: boolean
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
export function OfferBoardPage() {
  const [offers, setOffers] = useState<Offers | null>(null)
  const [people, setPeople] = useState<PlanEmployee[]>([])
  const [planners, setPlanners] = useState<Planner[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Site | null>(null)
  const [step, setStep] = useState<StepDraft | null>(null)
  const [accepting, setAccepting] = useState<Site | null>(null)
  const [declining, setDeclining] = useState<Site | null>(null)
  const today = todayIso()

  const load = useCallback(() => {
    api.offers().then(setOffers, (e) => setError(messageOf(e)))
  }, [])
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
    // The dots and the waiting days, worked out as in the calendar.
    const lib = offerSteps(site, own as unknown as Entry[], today)
    const waiting = stage.column === WAITING ? null : waitingDays(lib, today)
    const address = formatAddress(site)
    const appointments = appointmentsOf(own, order)
    const columnActivity = columns.find((c) => c.key === stage.column)?.activity
    const colour = (columnActivity ? activityInfo(columnActivity)?.background : undefined) ?? '#b8c6ca'
    // One more appointment of a step that may have several, until the step after it is planned.
    const repeat = REPEATABLE.find((activity) => {
      const after = order[order.indexOf(activity) + 1]
      return own.some((s) => s.activity === activity) && !own.some((s) => s.activity === after)
    })
    return (
      <article
        key={site.id}
        className="offer-card"
        style={{ '--card-edge': colour } as CSSProperties}
        onClick={(event) => onCard(event) && setEditing(site)}
      >
        <button type="button" className="offer-card-name" onClick={() => setEditing(site)} title="Anfrage öffnen">
          {site.name}
        </button>
        {address && <Text size="xs" c="dimmed">{address}</Text>}
        {site.clientPhone && (
          <Anchor href={`tel:${site.clientPhone.replace(/[^\d+]/g, '')}`} size="xs" className="offer-phone">
            ☎ {site.clientPhone}
          </Anchor>
        )}
        {(site.scope?.length ?? 0) > 0 && (
          <Group gap={4}>
            {site.scope!.map((scope) => (
              <Badge key={scope} size="sm" variant="light" color="gray" radius="sm">
                {scope}
              </Badge>
            ))}
          </Group>
        )}
        {site.description && (
          <Text size="xs" fs="italic" c="dimmed" lineClamp={3}>
            {site.description}
          </Text>
        )}
        <ul className="offer-history">
          {site.requestedOn && <li>Anfrage {shortDate(site.requestedOn)}</li>}
          {appointments.map(({ activity, date, entries }) => {
            const ofStep = appointments.filter((a) => a.activity === activity)
            const label = `${activityLabel(activity)}${ofStep.length > 1 ? ` ${ofStep.findIndex((a) => a.date === date) + 1}` : ''}`
            const text = `${label} ${shortDate(date)}${date > today ? ` ${hm(entries[0].startTime)} · ${entries.map((e) => e.employeeName).join(', ')}` : ''}`
            return (
              <li key={`${activity}-${date}`} className={date > today ? 'ahead' : ''}>
                {date > today ? (
                  // An appointment ahead can be moved from here.
                  <button type="button" title="Termin verschieben" onClick={() => setStep({ site, activity, current: entries })}>
                    {text}
                  </button>
                ) : (
                  text
                )}
              </li>
            )
          })}
        </ul>
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c="dimmed">Planer:</Text>
          <Select
            size="xs"
            variant="unstyled"
            className="offer-planner"
            aria-label={`Zuständiger Planer für ${site.name}`}
            data={planners.map((planner) => ({ value: String(planner.id), label: planner.name }))}
            value={site.responsiblePlannerId ? String(site.responsiblePlannerId) : null}
            placeholder="wählen"
            allowDeselect={false}
            onChange={(value) => value && changePlanner(site, Number(value))}
            comboboxProps={{ withinPortal: true }}
          />
        </Group>
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
              <Button size="compact-xs" color="green" onClick={() => setAccepting(site)}>
                Zusage
              </Button>
              <Button size="compact-xs" color="red" onClick={() => setDeclining(site)}>
                Abgelehnt
              </Button>
            </>
          )}
        </Group>
        {stage.column !== WAITING && (
          <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setDeclining(site)} className="offer-decline">
            Kunde hat abgesagt
          </Anchor>
        )}
      </article>
    )
  }

  const accepted = offers.decided.filter((d) => d.status === 'Bauphase')
  const declined = offers.decided.filter((d) => d.status === 'Abgelehnt')

  return (
    <div className="offer-board-page">
      <Group justify="space-between" align="flex-start" className="offer-intro">
        <Text size="sm" c="dimmed" maw={640}>
          Jede Anfrage ist eine Karte. Pro Karte gibt es die Taste für den nächsten Schritt; ist der Tag eines Termins
          vorbei, wandert die Karte von selbst weiter. Abgesagt werden kann jederzeit.
        </Text>
        <Button onClick={() => setCreating(true)}>+ Neue Anfrage</Button>
      </Group>

      <div className="offer-board">
        {columns.map((column) => {
          const list = offers.sites.filter((site) => stageOf(site, offers.steps, order, today).column === column.key)
          const info = column.activity ? activityInfo(column.activity) : null
          return (
            <section key={column.key} className="offer-column" aria-label={column.label}>
              <h3
                style={{
                  background: info?.background ?? '#d9e3e6',
                  color: column.activity ? textOfActivity(column.activity) : '#102a33',
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
                  {d.declineNote ? ` (${d.declineNote})` : ''}{' '}
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() => decide(api.reopenOffer(d.siteId), `${d.name} ist wieder im Angebot.`).catch((e) =>
                      notifications.show({ message: messageOf(e), color: 'red' }),
                    )}
                  >
                    wieder ins Angebot
                  </Anchor>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

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
          onClose={() => setDeclining(null)}
          onSave={async (reason, note) => {
            await decide(api.declineOffer(declining.id, reason, note), `${declining.name}: abgelehnt.`)
            setDeclining(null)
          }}
        />
      )}
    </div>
  )
}

/** Adds an hour to "HH:MM": an appointment of the offer phase takes about an hour on site. */
const plusHour = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function StepDialog({
  draft,
  steps,
  order,
  people,
  onClose,
  onSave,
}: {
  draft: StepDraft
  steps: OfferStep[]
  order: Activity[]
  people: PlanEmployee[]
  onClose: () => void
  onSave: (input: StepInput) => Promise<void>
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
  const [date, setDate] = useState<string | null>(current[0]?.date ?? (earliest > todayIso() ? earliest : addDays(todayIso(), 1)))
  const [start, setStart] = useState(hm(current[0]?.startTime ?? null) || '09:00')
  const [end, setEnd] = useState(hm(current[0]?.endTime ?? null) || '10:00')
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
            value={start}
            onChange={(value) => {
              setStart(value)
              // An hour on site, unless the end was set later already.
              if (value && (!end || end <= value)) setEnd(plusHour(value))
              else if (value && end === plusHour(start)) setEnd(plusHour(value))
            }}
          />
          <TimeSelect label="bis" value={end} onChange={setEnd} after={start} />
        </Group>
        <MultiSelect
          label="Wer"
          data={able.map((person) => ({ value: String(person.id), label: person.isPlaner ? `${person.name} (Planer)` : person.name }))}
          value={who}
          onChange={setWho}
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
            color="green"
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

function DeclineDialog({
  site,
  onClose,
  onSave,
}: {
  site: Site
  onClose: () => void
  onSave: (reason: string, note: string | null) => Promise<void>
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsNote = reason === 'Sonstiges' && !note.trim()
  return (
    <Sheet title={`Abgelehnt · ${site.name}`} onClose={onClose} size="sm">
      <Stack gap="sm">
        <Text size="sm">Der Kunde hat abgesagt. Die Anfrage verschwindet aus der Übersicht, Termine, die noch kommen, werden aus dem Kalender genommen.</Text>
        <Radio.Group label="Grund der Absage" value={reason} onChange={setReason} required>
          <Stack gap={6} mt={4}>
            {DECLINE_REASONS.map((r) => (
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
