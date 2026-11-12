import { Alert, Anchor, Button, Group, SegmentedControl, Select, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, messageOf } from '../api/client'
import type { Absence, AbsenceType, Employee, Vacation } from '../api/types'
import { formatDate } from '../lib/dates'

/** "Fr 20.11." */
const short = (iso: string) => formatDate(iso).slice(0, -4)

interface Draft {
  employeeId: string | null
  type: AbsenceType
  from: string | null
  to: string | null
  /** The stretch being changed, if any. */
  replaces: Absence | null
}

const empty: Draft = { employeeId: null, type: 'Urlaub', from: null, to: null, replaces: null }

/**
 * Urlaub and Krank, entered by Planer G only: a stretch of days for one employee (weekends and public holidays
 * leave themselves out). Below, the stretches of the year and how many days each employee has taken.
 */
export function AbsencesAdmin({ year }: { year: number }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [absences, setAbsences] = useState<Absence[] | null>(null)
  const [sums, setSums] = useState<Vacation[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [conflict, setConflict] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.absences(year).then(setAbsences, (e) => setError(messageOf(e)))
    api.vacationOverview(year).then(setSums, () => {})
  }, [year])
  useEffect(() => {
    load()
    api.employees().then((list) => setEmployees(list.filter((e) => e.isActive && e.showInPlan)), () => {})
  }, [load])

  const change = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }))
    setConflict('')
    setError('')
  }

  const save = async (force: boolean) => {
    if (!draft.employeeId || !draft.from) return
    const to = draft.to && draft.to >= draft.from ? draft.to : draft.from
    setBusy(true)
    setError('')
    try {
      const result = await api.saveAbsence({
        employeeId: Number(draft.employeeId),
        type: draft.type,
        from: draft.from,
        to,
        force,
        replaces: draft.replaces
          ? { employeeId: draft.replaces.employeeId, type: draft.replaces.type, from: draft.replaces.from, to: draft.replaces.to }
          : null,
      })
      const name = employees.find((e) => e.id === Number(draft.employeeId))?.name ?? ''
      notifications.show({
        color: 'green',
        message: `${name}: ${result.days} ${result.days === 1 ? 'Tag' : 'Tage'} ${draft.type === 'Urlaub' ? 'Urlaub' : 'krank'} eingetragen.`,
      })
      setDraft(empty)
      setConflict('')
      load()
    } catch (e) {
      // Sites planned on those days: asked first.
      if (e instanceof ApiError && e.status === 409) setConflict(e.message)
      else setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (absence: Absence) => {
    try {
      await api.removeAbsence({ employeeId: absence.employeeId, type: absence.type, from: absence.from, to: absence.to })
      notifications.show({ color: 'green', message: `${absence.employeeName}: ${absence.type} ${short(absence.from)}–${short(absence.to)} gelöscht.` })
      if (draft.replaces === absence) setDraft(empty)
      load()
    } catch (e) {
      notifications.show({ color: 'red', message: messageOf(e) })
    }
  }

  return (
    <Stack gap="md">
      <section className="form-section">
        <h3>{draft.replaces ? 'Abwesenheit ändern' : 'Urlaub oder Krank eintragen'}</h3>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Select
            label="Mitarbeiter"
            placeholder="wählen"
            searchable
            w={220}
            data={employees.map((e) => ({ value: String(e.id), label: e.name }))}
            value={draft.employeeId}
            onChange={(employeeId) => change({ employeeId })}
            comboboxProps={{ withinPortal: true }}
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Art
            </Text>
            <SegmentedControl
              value={draft.type}
              onChange={(type) => change({ type: type as AbsenceType })}
              data={['Urlaub', 'Krank']}
              aria-label="Art der Abwesenheit"
            />
          </div>
          <DateInput label="von" valueFormat="DD.MM.YYYY" w={140} value={draft.from} onChange={(from) => change({ from })} />
          <DateInput
            label="bis"
            valueFormat="DD.MM.YYYY"
            w={140}
            placeholder="gleicher Tag"
            minDate={draft.from ? new Date(draft.from) : undefined}
            value={draft.to}
            onChange={(to) => change({ to })}
          />
          <Button loading={busy && !conflict} disabled={!draft.employeeId || !draft.from} onClick={() => save(false)}>
            {draft.replaces ? 'Speichern' : 'Eintragen'}
          </Button>
          {draft.replaces && (
            <Button variant="default" onClick={() => change(empty)}>
              Abbrechen
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          Wochenenden und Feiertage zählen nicht mit. Im Kalender stehen Urlaub und Krank für alle sichtbar, geändert werden sie nur hier.
        </Text>
        {conflict && (
          <Alert color="orange" variant="light">
            <Stack gap="xs">
              <Text size="sm">{conflict}</Text>
              <Group gap="xs">
                <Button size="xs" color="orange" loading={busy} onClick={() => save(true)}>
                  Trotzdem eintragen
                </Button>
                <Button size="xs" variant="default" onClick={() => setConflict('')}>
                  Abbrechen
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}
        {error && <Alert color="red" variant="light">{error}</Alert>}
      </section>

      <section>
        <Title order={4} mb="xs">
          Abwesenheiten {year}
        </Title>
        {absences === null ? null : absences.length === 0 ? (
          <Text c="dimmed" size="sm">
            Noch keine eingetragen.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th>Art</Table.Th>
                  <Table.Th>von</Table.Th>
                  <Table.Th>bis</Table.Th>
                  <Table.Th ta="right">Arbeitstage</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {absences.map((absence) => (
                  <Table.Tr key={`${absence.employeeId}-${absence.type}-${absence.from}`}>
                    <Table.Td>{absence.employeeName}</Table.Td>
                    <Table.Td>
                      <span className={`absence-badge ${absence.type === 'Urlaub' ? 'vacation' : 'sick'}`}>{absence.type}</span>
                    </Table.Td>
                    <Table.Td>{short(absence.from)}</Table.Td>
                    <Table.Td>{short(absence.to)}</Table.Td>
                    <Table.Td ta="right">{absence.workDays}</Table.Td>
                    <Table.Td>
                      <Group gap="sm" justify="flex-end" wrap="nowrap">
                        <Anchor
                          component="button"
                          type="button"
                          size="sm"
                          onClick={() =>
                            change({ employeeId: String(absence.employeeId), type: absence.type, from: absence.from, to: absence.to, replaces: absence })
                          }
                        >
                          ändern
                        </Anchor>
                        <Anchor component="button" type="button" size="sm" c="red" onClick={() => remove(absence)}>
                          löschen
                        </Anchor>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </section>

      <section>
        <Title order={4} mb="xs">
          Summen {year}
        </Title>
        <Table.ScrollContainer minWidth={480}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mitarbeiter</Table.Th>
                <Table.Th ta="right">Urlaubsanspruch</Table.Th>
                <Table.Th ta="right">Urlaub genommen</Table.Th>
                <Table.Th ta="right">Rest</Table.Th>
                <Table.Th ta="right">Krank</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sums.map((row) => (
                <Table.Tr key={row.employeeId}>
                  <Table.Td>{row.employeeName}</Table.Td>
                  <Table.Td ta="right">{row.entitlement}</Table.Td>
                  <Table.Td ta="right">{row.used}</Table.Td>
                  <Table.Td ta="right" c={row.remaining < 0 ? 'red' : undefined}>
                    {row.remaining}
                  </Table.Td>
                  <Table.Td ta="right">{row.sickDays}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </section>
    </Stack>
  )
}
