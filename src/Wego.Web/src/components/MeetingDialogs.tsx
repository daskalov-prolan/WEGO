import { Alert, Badge, Button, Group, MultiSelect, Select, Stack, Text, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Meeting, MeetingInput, MeetingRequest, MeetingWeek } from '../api/types'
import { formatDateLong, todayIso } from '../lib/dates'
import { useIsPhone } from '../lib/useIsPhone'
import { shortDate } from '../lib/visitText'
import { Sheet } from './Sheet'
import { TimeSelect } from './TimeSelect'

/**
 * Meetings that come back every week (e.g. the Bauberatung on Wednesdays 9:00-10:30): the list of them for the
 * planners, a meeting being written, one week of it; a craftsman taking part asks to be let off one week, a planner
 * of group G decides.
 */

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const hm = (time: string) => time.slice(0, 5)
/** "9:00–10:30" */
export const meetingTime = (start: string, end: string) => `${hm(start)}–${hm(end)}`

export interface Person {
  id: number
  name: string
}

const names = (ids: number[], people: Person[]) =>
  ids.map((id) => people.find((p) => p.id === id)?.name ?? '?').join(', ')

/** The day picker: on a phone as a window of its own, without the keyboard over it. */
function DayPicker({ label, value, onChange, clearable = false, description }: {
  label: string; value: string | null; onChange: (value: string | null) => void; clearable?: boolean; description?: string
}) {
  const isPhone = useIsPhone()
  return (
    <DatePickerInput label={label} description={description} valueFormat="DD.MM.YYYY" value={value} onChange={onChange}
      clearable={clearable} dropdownType={isPhone ? 'modal' : 'popover'} />
  )
}

/** "Wiederholungstermine": the meetings, a new one; for a planner of group G the requests to be let off first. */
export function MeetingsDialog({ people, decides, onClose, onChanged }: {
  people: Person[]; decides: boolean; onClose: () => void; onChanged: () => void
}) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [requests, setRequests] = useState<MeetingRequest[]>([])
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    api.meetings().then(setMeetings, (e) => setError(messageOf(e)))
    if (decides) api.meetingRequests().then(setRequests, () => {})
  }
  useEffect(load, [decides])

  const decide = async (request: MeetingRequest, approve: boolean) => {
    try {
      await api.decideMeetingOff(request.meetingId, request.date, request.employeeId, approve)
      notifications.show({ message: approve ? `${request.employee} ist am ${shortDate(request.date)} frei.` : 'Abgelehnt.', color: 'teal' })
      load()
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (editing)
    return (
      <MeetingEditor
        meeting={editing === 'new' ? null : editing}
        people={people}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
          onChanged()
        }}
      />
    )

  return (
    <Sheet title="Wiederholungstermine" onClose={onClose} size="lg">
      <Stack gap="sm" className="meetings">
        {error && <Alert color="red" variant="outline">{error}</Alert>}
        {requests.length > 0 && (
          <div className="meeting-requests">
            <Text fw={700} size="lg">Offene Anfragen</Text>
            {requests.map((request) => (
              <div key={`${request.meetingId}|${request.date}|${request.employeeId}`} className="meeting-request">
                <Text size="sm">
                  <b>{request.employee}</b> kann nicht zu <b>{request.title}</b> am {shortDate(request.date)}
                  {request.reason ? ` · ${request.reason}` : ''}
                </Text>
                <Group gap={6}>
                  <Button size="compact-sm" onClick={() => decide(request, true)}>Freigeben</Button>
                  <Button size="compact-sm" variant="default" onClick={() => decide(request, false)}>Ablehnen</Button>
                </Group>
              </div>
            ))}
          </div>
        )}
        <Group justify="space-between">
          <Text fw={700} size="lg">Termin-Reihen</Text>
          <Button onClick={() => setEditing('new')}>+ Neuer Wiederholungstermin</Button>
        </Group>
        {meetings?.length === 0 && <Text c="dimmed" size="sm">Noch keine Wiederholungstermine.</Text>}
        {meetings?.map((meeting) => (
          <button type="button" key={meeting.id} className="meeting-row" onClick={() => setEditing(meeting)}>
            <span className="meeting-row-title">⟳ {meeting.title}</span>
            <span className="meeting-row-when">
              jeden {WEEKDAYS[meeting.weekday - 1]} · {meetingTime(meeting.startTime, meeting.endTime)}
              {meeting.endsOn ? ` · bis ${shortDate(meeting.endsOn)}` : ''}
            </span>
            <span className="meeting-row-who">{names(meeting.participantIds, people)}</span>
          </button>
        ))}
      </Stack>
    </Sheet>
  )
}

/** A meeting written: name, day of the week, times, who takes part, from when (and until when). */
export function MeetingEditor({ meeting, people, onClose, onSaved }: {
  meeting: Meeting | null; people: Person[]; onClose: () => void; onSaved: () => void
}) {
  const [input, setInput] = useState<MeetingInput>(() => meeting ? {
    title: meeting.title, weekday: meeting.weekday, startTime: hm(meeting.startTime), endTime: hm(meeting.endTime),
    startsOn: meeting.startsOn, endsOn: meeting.endsOn, participantIds: meeting.participantIds,
  } : { title: '', weekday: 3, startTime: '09:00', endTime: '10:30', startsOn: todayIso(), endsOn: null, participantIds: [] })
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const change = (part: Partial<MeetingInput>) => setInput((current) => ({ ...current, ...part }))

  const save = async () => {
    setError('')
    try {
      if (meeting) await api.updateMeeting(meeting.id, input)
      else await api.createMeeting(input)
      notifications.show({ message: 'Wiederholungstermin gespeichert.', color: 'teal' })
      onSaved()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const remove = async () => {
    try {
      await api.deleteMeeting(meeting!.id)
      notifications.show({ message: 'Wiederholungstermin gelöscht.', color: 'teal' })
      onSaved()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <Sheet title={meeting ? 'Wiederholungstermin bearbeiten' : 'Neuer Wiederholungstermin'} onClose={onClose} size="lg">
      <Stack gap="sm" className="meetings">
        <TextInput label="Name" placeholder="z. B. Bauberatung" maxLength={100} value={input.title} onChange={(e) => change({ title: e.currentTarget.value })} />
        <Group grow align="flex-end">
          <Select label="Jeden" data={WEEKDAYS.map((day, i) => ({ value: String(i + 1), label: day }))} value={String(input.weekday)}
            allowDeselect={false} onChange={(value) => value && change({ weekday: Number(value) })} comboboxProps={{ withinPortal: true }} />
          <TimeSelect label="Von" quarter required value={input.startTime} onChange={(value) => change({ startTime: value })} />
          <TimeSelect label="Bis" quarter required value={input.endTime} after={input.startTime} onChange={(value) => change({ endTime: value })} />
        </Group>
        <MultiSelect label="Teilnehmer" placeholder="Wer ist dabei?" data={people.map((p) => ({ value: String(p.id), label: p.name }))}
          value={input.participantIds.map(String)} onChange={(values) => change({ participantIds: values.map(Number) })}
          searchable comboboxProps={{ withinPortal: true }} />
        <Group grow align="flex-start">
          <DayPicker label="Ab" value={input.startsOn} onChange={(value) => value && change({ startsOn: value })} />
          <DayPicker label="Bis (leer: ohne Ende)" value={input.endsOn} clearable onChange={(value) => change({ endsOn: value })} />
        </Group>
        <Text size="xs" c="dimmed">An Feiertagen und in Betriebsferien fällt der Termin aus, bei Urlaub oder Krankheit für den Teilnehmer.</Text>
        {error && <Alert color="red" variant="outline">{error}</Alert>}
        <Group justify="space-between">
          {meeting ? (
            deleting ? (
              <Group gap={6}>
                <Button color="red" onClick={remove}>Wirklich löschen</Button>
                <Button variant="default" onClick={() => setDeleting(false)}>Nein</Button>
              </Group>
            ) : (
              <Button color="red" variant="outline" onClick={() => setDeleting(true)}>Reihe löschen</Button>
            )
          ) : <span />}
          <Group gap={6}>
            <Button variant="default" onClick={onClose}>Abbrechen</Button>
            <Button onClick={save}>Speichern</Button>
          </Group>
        </Group>
      </Stack>
    </Sheet>
  )
}

/**
 * One week of a meeting, tapped in the plan. A planner cancels or moves it (or the whole series is opened); a planner
 * of group G lets off who asked. A craftsman taking part asks to be let off this week, or takes it back.
 */
export function MeetingWeekDialog({ week, people, me, plans, decides, onClose, onChanged }: {
  week: MeetingWeek; people: Person[]; me: number; plans: boolean; decides: boolean; onClose: () => void; onChanged: () => void
}) {
  const [moving, setMoving] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [date, setDate] = useState<string | null>(week.date)
  const [start, setStart] = useState(hm(week.startTime))
  const [end, setEnd] = useState(hm(week.endTime))
  const [series, setSeries] = useState<Meeting | null>(null)
  const [error, setError] = useState('')
  const takesPart = week.employeeIds.includes(me)
  const asked = week.requested.includes(me)

  const run = async (change: Promise<unknown>, message: string) => {
    setError('')
    try {
      await change
      notifications.show({ message, color: 'teal' })
      onChanged()
      onClose()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (series)
    return <MeetingEditor meeting={series} people={people} onClose={() => setSeries(null)} onSaved={() => { onChanged(); onClose() }} />

  return (
    <Sheet title={`⟳ ${week.title}`} onClose={onClose} size="md">
      <Stack gap="sm" className="meetings">
        <div>
          <Text fw={700}>{formatDateLong(week.date)} · {meetingTime(week.startTime, week.endTime)}</Text>
          {week.moved && <Text size="sm" c="orange.8">Verschoben (sonst {shortDate(week.originalDate)})</Text>}
        </div>
        <div>
          <Text size="sm" fw={600}>Teilnehmer</Text>
          {week.employeeIds.map((id) => (
            <Group key={id} gap={6} wrap="nowrap">
              <Text size="sm">{week.names[id] ?? people.find((p) => p.id === id)?.name ?? '?'}</Text>
              {week.requested.includes(id) && <Badge size="sm" color="orange" variant="light">Absage beantragt</Badge>}
              {decides && week.requested.includes(id) && (
                <>
                  <Button size="compact-xs" onClick={() => run(api.decideMeetingOff(week.meetingId, week.originalDate, id, true), 'Freigegeben.')}>Freigeben</Button>
                  <Button size="compact-xs" variant="default" onClick={() => run(api.decideMeetingOff(week.meetingId, week.originalDate, id, false), 'Abgelehnt.')}>Ablehnen</Button>
                </>
              )}
            </Group>
          ))}
        </div>

        {error && <Alert color="red" variant="outline">{error}</Alert>}

        {plans ? (
          <>
            {moving ? (
              <Stack gap={6} className="visit-form">
                <Group grow align="flex-end">
                  <DayPicker label="Tag" value={date} onChange={setDate} />
                  <TimeSelect label="Von" quarter required value={start} onChange={setStart} />
                  <TimeSelect label="Bis" quarter required value={end} after={start} onChange={setEnd} />
                </Group>
                <Group gap={6}>
                  <Button disabled={!date} onClick={() => run(api.changeMeetingWeek(week.meetingId,
                    { date: week.originalDate, cancelled: false, newDate: date!, newStartTime: start, newEndTime: end }), 'Termin verschoben.')}>
                    Speichern
                  </Button>
                  <Button variant="default" onClick={() => setMoving(false)}>Abbrechen</Button>
                </Group>
              </Stack>
            ) : (
              <Group gap={6}>
                <Button variant="default" onClick={() => setMoving(true)}>Nur diesen Termin verschieben</Button>
                <Button color="red" variant="outline" onClick={() => run(api.changeMeetingWeek(week.meetingId, { date: week.originalDate, cancelled: true }), 'Termin abgesagt.')}>
                  Nur diesen Termin absagen
                </Button>
                {week.moved && (
                  <Button variant="default" onClick={() => run(api.restoreMeetingWeek(week.meetingId, week.originalDate), 'Wieder wie in der Reihe.')}>
                    Wie in der Reihe
                  </Button>
                )}
              </Group>
            )}
            <Button variant="subtle" onClick={() => api.meetings().then((all) => setSeries(all.find((m) => m.id === week.meetingId) ?? null), (e) => setError(messageOf(e)))}>
              Ganze Reihe bearbeiten ›
            </Button>
          </>
        ) : takesPart && (
          asked ? (
            <Stack gap={6}>
              <Text size="sm" c="orange.8">Absage beantragt: wartet auf Freigabe durch Planer G.</Text>
              <Button variant="default" onClick={() => run(api.withdrawMeetingOff(week.meetingId, week.originalDate), 'Antrag zurückgenommen.')}>
                Antrag zurücknehmen
              </Button>
            </Stack>
          ) : asking ? (
            <Stack gap={6} className="visit-form">
              <TextInput label="Grund (freiwillig)" maxLength={300} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              <Group gap={6}>
                <Button color="red" onClick={() => run(api.askMeetingOff(week.meetingId, week.originalDate, reason.trim() || null), 'Absage beantragt: Planer G gibt sie frei.')}>
                  Absage beantragen
                </Button>
                <Button variant="default" onClick={() => setAsking(false)}>Abbrechen</Button>
              </Group>
            </Stack>
          ) : (
            <Button color="red" variant="outline" onClick={() => setAsking(true)}>Kann nicht teilnehmen</Button>
          )
        )}
      </Stack>
    </Sheet>
  )
}

/** A week of a meeting in a field of the plan: name and time, marked when a participant asked to be let off. */
export function MeetingChip({ week, employeeId, onOpen, clashes = [] }: {
  week: MeetingWeek; employeeId: number; onOpen?: (week: MeetingWeek) => void
  /** What else is planned for him then: the meeting in red. */
  clashes?: string[]
}) {
  const asked = week.requested.includes(employeeId)
  const clash = clashes.length > 0
  return (
    <span
      className={['meeting-chip', asked ? 'asked' : '', clash ? 'clash' : ''].filter(Boolean).join(' ')}
      title={`${week.title} ${meetingTime(week.startTime, week.endTime)}${asked ? ' · Absage beantragt' : ''}${week.moved ? ' · verschoben' : ''}${clash ? ` · Überschneidung mit ${clashes.join(', ')}` : ''}`}
      data-clickable={onOpen ? true : undefined}
      onClick={onOpen ? (event) => { event.stopPropagation(); onOpen(week) } : undefined}
    >
      <span className="meeting-chip-icon" aria-hidden>{asked ? '?' : clash ? '⚠' : '⟳'}</span>
      <span className="meeting-chip-name">{week.title}</span>
      <span className="meeting-chip-time">{meetingTime(week.startTime, week.endTime)}</span>
    </span>
  )
}
