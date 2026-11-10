import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
  Menu,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { DateInput, DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Access, Activity, Employee, EmployeeInput, HolidayKind, Role, SchoolHoliday } from '../api/types'
import { activitiesOfStatus, activityLabel } from '../lib/activities'
import { toEmployeeInput } from '../lib/employees'
import { ActivitiesAdmin } from '../components/ActivitiesAdmin'
import { Sheet } from '../components/Sheet'
import { YearPicker } from '../components/YearPicker'
import { formatDate, PLAN_YEARS } from '../lib/dates'
import { canPlanRole, roleLabel, ROLES } from '../lib/roles'

/** Planer G only: employees and their rights, activities, school and public holidays. Sites have their own page. */
interface AdminPageProps {
  year: number
  /** An employee to open right away, e.g. from the list of employees. */
  employeeId?: number | null
  onActivitiesChanged: () => Promise<void>
}

export function AdminPage({ year, employeeId = null, onActivitiesChanged }: AdminPageProps) {
  return (
    <div className="page">
      <Title order={2} mb={4} className="page-title">
        Verwaltung
      </Title>
      <Text c="dimmed" mb="md">
        Mitarbeiter, Tätigkeiten, Ferien und Feiertage
      </Text>
      <Tabs defaultValue="employees" keepMounted={false} className="brand-tabs">
        <Tabs.List mb="md">
          <Tabs.Tab value="employees">Mitarbeiter</Tabs.Tab>
          <Tabs.Tab value="activities">Tätigkeiten</Tabs.Tab>
          <Tabs.Tab value="holidays">Ferien & Feiertage</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="employees">
          <EmployeesSection openId={employeeId} />
        </Tabs.Panel>
        <Tabs.Panel value="activities">
          <ActivitiesAdmin onChanged={onActivitiesChanged} />
        </Tabs.Panel>
        <Tabs.Panel value="holidays">
          <SchoolHolidaysSection year={year} />
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}

const newEmployee: EmployeeInput = {
  name: '',
  sortOrder: 0,
  isActive: true,
  showInPlan: true,
  vacationDaysPerYear: 30,
  userName: null,
  role: 'Handwerker',
  password: null,
  mainActivity: null,
  hourlyRate: null,
  phone: null,
  birthDate: null,
}

function EmployeesSection({ openId = null }: { openId?: number | null }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  // id 0 = new employee
  const [editing, setEditing] = useState<{ id: number; input: EmployeeInput } | null>(null)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  // Initial passwords exist only here until the page is left: the server stores hashes.
  const [accesses, setAccesses] = useState<Access[]>([])

  const load = useCallback(() => {
    api.employees().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])
  useEffect(load, [load])

  // Opened from the list of employees: that employee's form, once.
  const opened = useRef(false)
  useEffect(() => {
    const employee = employees.find((candidate) => candidate.id === openId && !candidate.isDeleted)
    if (!employee || opened.current) return
    opened.current = true
    setEditing({ id: employee.id, input: toEmployeeInput(employee) })
  }, [employees, openId])

  const createAccesses = async (targets: Employee[]) => {
    setError('')
    try {
      const created: Access[] = []
      for (const employee of targets) created.push(await api.createAccess(employee.id))
      setAccesses((current) => [
        ...created,
        ...current.filter((a) => !created.some((c) => c.employeeId === a.employeeId)),
      ])
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  // The entries in the plan stay; the employee stands at the end of the lists as deleted.
  const remove = async (employee: Employee) => {
    if (
      !window.confirm(
        `${employee.name} löschen? Die Einträge im Kalender bleiben erhalten. Die Anmeldung wird entfernt, und ${employee.name} steht in der Mitarbeiterliste am Ende als gelöscht.`,
      )
    )
      return
    setError('')
    try {
      await api.deleteEmployee(employee.id)
      notifications.show({ message: `${employee.name} gelöscht.`, color: 'green' })
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  // A deleted employee for good: gone everywhere, with their entries in the calendar.
  const removeForGood = async (employee: Employee) => {
    if (
      !window.confirm(
        `${employee.name} endgültig löschen? ${employee.name} erscheint danach nirgends mehr, auch nicht in den Listen. Alle Einträge und Notizen von ${employee.name} im Kalender werden mit gelöscht. Das lässt sich nicht rückgängig machen.`,
      )
    )
      return
    setError('')
    try {
      await api.deleteEmployeePermanently(employee.id)
      notifications.show({ message: `${employee.name} endgültig gelöscht.`, color: 'green' })
      load()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const change = (patch: Partial<EmployeeInput>) =>
    setEditing((current) => current && { ...current, input: { ...current.input, ...patch } })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      if (editing.id === 0) await api.createEmployee(editing.input)
      else await api.updateEmployee(editing.id, editing.input)
      setEditing(null)
      setFormError('')
      notifications.show({ message: 'Mitarbeiter gespeichert.', color: 'green' })
      load()
    } catch (e) {
      setFormError(messageOf(e))
    }
  }

  const withoutLogin = employees.filter((employee) => employee.isActive && !employee.hasPassword)

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Planer dürfen die Planung ändern und sehen alle Auswertungen. Mitarbeiter sehen „Mein Plan“ und den
        die Planung nur zum Lesen.
      </Text>

      <Group gap="xs">
        <Button onClick={() => setEditing({ id: 0, input: newEmployee })}>+ Mitarbeiter anlegen</Button>
        {withoutLogin.length > 0 && (
          <Button variant="light" onClick={() => createAccesses(withoutLogin)}>
            Zugänge für alle ohne Anmeldung anlegen ({withoutLogin.length})
          </Button>
        )}
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {accesses.length > 0 && (
        <Alert color="green" variant="light" title="Neue Zugangsdaten – bitte jetzt notieren oder weitergeben">
          <Text size="sm" mb="xs">
            Die Startpasswörter werden nicht gespeichert und nach dem Verlassen dieser Seite nicht wieder angezeigt.
            Bei der ersten Anmeldung wählt jeder sein eigenes Passwort.
          </Text>
          <Table.ScrollContainer minWidth={420}>
            <Table withTableBorder bg="white" className="brand-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Benutzername</Table.Th>
                  <Table.Th>Startpasswort</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accesses.map((access) => (
                  <Table.Tr key={access.employeeId}>
                    <Table.Td>{access.name}</Table.Td>
                    <Table.Td>
                      <Code fz="sm">{access.userName}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Code fz="sm">{access.initialPassword}</Code>
                        <CopyButton value={`${access.userName} / ${access.initialPassword}`}>
                          {({ copied, copy }) => (
                            <Button size="compact-xs" variant="subtle" onClick={copy}>
                              {copied ? 'kopiert' : 'kopieren'}
                            </Button>
                          )}
                        </CopyButton>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Alert>
      )}

      {/* Calm rows: the state under the name, the role written out, one button and a menu for the rest. */}
      <Table.ScrollContainer minWidth={820}>
        <Table striped highlightOnHover withTableBorder verticalSpacing="sm" className="brand-table admin-employees">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Rolle</Table.Th>
              <Table.Th>Benutzername</Table.Th>
              <Table.Th>Telefon</Table.Th>
              <Table.Th ta="right">Urlaubstage</Table.Th>
              <Table.Th ta="right">Stundensatz</Table.Th>
              <Table.Th ta="right">Reihenfolge</Table.Th>
              <Table.Th w={150} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {employees.map((employee) => (
              <Table.Tr key={employee.id} className={employee.isActive ? undefined : 'admin-employee-off'}>
                <Table.Td>
                  <Text fw={600} size="sm">
                    {employee.name}
                  </Text>
                  {(employee.isDeleted || !employee.isActive || !employee.showInPlan) && (
                    <Group gap={4} mt={2}>
                      {employee.isDeleted ? (
                        <Badge size="xs" color="red" variant="light">
                          gelöscht
                        </Badge>
                      ) : (
                        !employee.isActive && (
                          <Badge size="xs" color="gray">
                            inaktiv
                          </Badge>
                        )
                      )}
                      {!employee.isDeleted && !employee.showInPlan && (
                        <Badge size="xs" color="gray" variant="outline">
                          nicht im Plan
                        </Badge>
                      )}
                    </Group>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={employee.role === 'Handwerker' ? 'gray' : 'wego'} className="admin-role">
                    {roleLabel(employee.role)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {employee.userName ?? (
                    <Text size="sm" c="dimmed">
                      –
                    </Text>
                  )}
                </Table.Td>
                <Table.Td className="nowrap">{employee.phone}</Table.Td>
                <Table.Td ta="right">{employee.vacationDaysPerYear}</Table.Td>
                <Table.Td ta="right" className="nowrap">
                  {employee.hourlyRate == null ? (
                    <Text size="sm" c="dimmed">
                      –
                    </Text>
                  ) : (
                    `${employee.hourlyRate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/Std.`
                  )}
                </Table.Td>
                <Table.Td ta="right">{employee.sortOrder}</Table.Td>
                <Table.Td>
                  {/* A deleted employee is no longer changed; only deleted for good. */}
                  {employee.isDeleted && (
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      <Button size="compact-sm" color="red" variant="outline" onClick={() => void removeForGood(employee)}>
                        Endgültig löschen …
                      </Button>
                    </Group>
                  )}
                  {!employee.isDeleted && (
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      <Button
                        size="compact-sm"
                        variant="default"
                        onClick={() => setEditing({ id: employee.id, input: toEmployeeInput(employee) })}
                      >
                        Bearbeiten
                      </Button>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="default" radius="xl" aria-label={`Weitere Aktionen: ${employee.name}`}>
                            ⋯
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {employee.isActive && (
                            <Menu.Item
                              onClick={() =>
                                (!employee.hasPassword ||
                                  window.confirm(
                                    `Neues Startpasswort für ${employee.name} erzeugen? Das bisherige Passwort gilt dann nicht mehr.`,
                                  )) &&
                                createAccesses([employee])
                              }
                            >
                              {employee.hasPassword ? 'Passwort zurücksetzen' : 'Zugang anlegen'}
                            </Menu.Item>
                          )}
                          <Menu.Item color="red" onClick={() => void remove(employee)}>
                            Löschen …
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {editing && (
        <Sheet
          onClose={() => setEditing(null)}
          title={<Text fw={700}>{editing.id === 0 ? 'Mitarbeiter anlegen' : editing.input.name}</Text>}
        >
          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="Name"
                value={editing.input.name}
                onChange={(e) => change({ name: e.currentTarget.value })}
                required
                data-autofocus
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Benutzername"
                  description="leer = keine Anmeldung"
                  value={editing.input.userName ?? ''}
                  onChange={(e) => change({ userName: e.currentTarget.value || null })}
                  autoComplete="off"
                />
                <PasswordInput
                  label={editing.id === 0 ? 'Passwort' : 'Neues Passwort'}
                  description={editing.id === 0 ? 'oder später „Zugang anlegen“' : 'leer = unverändert'}
                  value={editing.input.password ?? ''}
                  onChange={(e) => change({ password: e.currentTarget.value || null })}
                  minLength={8}
                  autoComplete="new-password"
                />
                <Select
                  label="Rolle"
                  value={editing.input.role}
                  onChange={(value) => value && change({ role: value as Role })}
                  data={ROLES.map((role) => ({ value: role.value, label: `${role.label} – ${role.description}` }))}
                  allowDeselect={false}
                />
                <TextInput
                  label="Telefon"
                  type="tel"
                  maxLength={50}
                  value={editing.input.phone ?? ''}
                  onChange={(e) => change({ phone: e.currentTarget.value || null })}
                />
                <DateInput
                  label="Geburtsdatum"
                  description="Der Geburtstag steht für alle in der Mitarbeiterliste und im Kalender"
                  placeholder="TT.MM.JJJJ"
                  valueFormat="DD.MM.YYYY"
                  clearable
                  defaultLevel="decade"
                  maxDate={new Date()}
                  value={editing.input.birthDate ?? null}
                  onChange={(value) => change({ birthDate: value || null })}
                />
                <NumberInput
                  label="Urlaubstage pro Jahr"
                  min={0}
                  max={366}
                  value={editing.input.vacationDaysPerYear}
                  onChange={(value) => change({ vacationDaysPerYear: Number(value) || 0 })}
                />
                <NumberInput
                  label="Stundensatz"
                  description="für die Nachkalkulation, je Baustelle änderbar"
                  min={0}
                  max={1000}
                  decimalScale={2}
                  decimalSeparator=","
                  thousandSeparator="."
                  suffix=" €/Std."
                  hideControls
                  placeholder="€/Std."
                  value={editing.input.hourlyRate ?? ''}
                  onChange={(value) => change({ hourlyRate: value === '' ? null : Number(value) })}
                />
                <NumberInput
                  label="Reihenfolge im Plan"
                  value={editing.input.sortOrder}
                  onChange={(value) => change({ sortOrder: Number(value) || 0 })}
                />
              </SimpleGrid>
              {/* Craftsmen do all activities of the construction phase, planners all of the offer phase. */}
              <Checkbox
                label="Handwerker: Zeile im Kalender, kann alle Tätigkeiten der Bauphase (Planer können alle der Angebotsphase)"
                checked={editing.input.showInPlan}
                onChange={(e) => change({ showInPlan: e.currentTarget.checked })}
              />
              {editing.input.showInPlan && (
                <Select
                  label="Haupttätigkeit"
                  description="Damit kommt der Handwerker auf eine neue Baustelle, in ihrer Farbe."
                  placeholder="keine (erste Tätigkeit der Bauphase)"
                  clearable
                  maw={320}
                  data={activitiesOfStatus('Bauphase').map((activity) => ({ value: activity, label: activityLabel(activity) ?? activity }))}
                  value={editing.input.mainActivity}
                  onChange={(value) => change({ mainActivity: (value as Activity | null) ?? null })}
                />
              )}
              {/* A craftsman who does visits as well: he is in the offer phase too, for them only. */}
              {editing.input.showInPlan && !canPlanRole(editing.input.role) && (
                <Checkbox
                  label="Macht auch Besichtigungen (erscheint dafür auch in der Angebotsphase)"
                  checked={editing.input.additionalActivities?.includes('Besichtigung') ?? false}
                  onChange={(e) => {
                    const others = (editing.input.additionalActivities ?? []).filter((activity) => activity !== 'Besichtigung')
                    change({ additionalActivities: e.currentTarget.checked ? [...others, 'Besichtigung'] : others })
                  }}
                />
              )}
              <Checkbox
                label="Aktiv"
                checked={editing.input.isActive}
                onChange={(e) => change({ isActive: e.currentTarget.checked })}
              />
              {formError && (
                <Alert color="red" variant="light">
                  {formError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">Speichern</Button>
              </Group>
            </Stack>
          </form>
        </Sheet>
      )}
    </Stack>
  )
}

/** The years the holidays can be kept for: from 2026 on, five years ahead of the current one. */
const HOLIDAY_YEARS = PLAN_YEARS

export function SchoolHolidaysSection({ year: planYear }: { year: number }) {
  const [year, setYear] = useState(planYear)
  const [holidays, setHolidays] = useState<SchoolHoliday[]>([])
  const [name, setName] = useState('')
  const [range, setRange] = useState<[string | null, string | null]>([null, null])
  const [kind, setKind] = useState<HolidayKind>('Feiertag')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState<SchoolHoliday | null>(null)

  const load = useCallback(() => {
    api.plan(year).then((plan) => setHolidays(plan.schoolHolidays), (e) => setError(messageOf(e)))
  }, [year])
  useEffect(load, [load])

  const run = async (action: () => Promise<string>) => {
    setError('')
    setBusy(true)
    try {
      const message = await action()
      if (message) notifications.show({ message, color: 'green' })
      load()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    const [start, end] = range
    if (!start || !end) return
    const closure = kind === 'Betriebsferien'
    if (
      closure &&
      !window.confirm('Betriebsferien: Alle Handwerker bekommen an den Werktagen Urlaub eingetragen. Was an diesen Tagen geplant ist, wird ersetzt. Fortfahren?')
    )
      return
    void run(async () => {
      await api.addSchoolHoliday(name, start, end, kind)
      setName('')
      setRange([null, null])
      return closure ? 'Betriebsferien eingetragen: Urlaub für alle Handwerker.' : 'Ferien eingetragen.'
    })
  }

  return (
    <Stack gap="md">
      {/* Schulferien and Feiertage come by themselves (the server fetches every new year). As in "Mein Bereich":
          the heading on the left, the year on the right. */}
      <Group justify="space-between" align="center">
        <Title order={3} className="section-heading">
          Ferien & Feiertage {year}
        </Title>
        <YearPicker year={year} years={HOLIDAY_YEARS} onChange={setYear} />
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {/* Fixed columns: the table looks the same in every year, whatever the names. */}
      <Table.ScrollContainer minWidth={560}>
        <Table striped withTableBorder layout="fixed" className="brand-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Bezeichnung</Table.Th>
              <Table.Th w={160}>Art</Table.Th>
              <Table.Th w={150}>Von</Table.Th>
              <Table.Th w={150}>Bis</Table.Th>
              <Table.Th w={190} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {holidays.map((holiday) => (
              <Table.Tr key={holiday.id}>
                <Table.Td>{holiday.name}</Table.Td>
                <Table.Td>
                  {holiday.kind === 'Betriebsferien' ? (
                    // Yellow like the Urlaub it gives.
                    <Badge color="yellow" c="dark" variant="filled">
                      {holiday.kind}
                    </Badge>
                  ) : (
                    <Badge color="green" variant={holiday.kind === 'Feiertag' ? 'filled' : 'light'}>
                      {holiday.kind}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{formatDate(holiday.startDate)}</Table.Td>
                <Table.Td>{formatDate(holiday.endDate)}</Table.Td>
                <Table.Td>
                  {/* Framed buttons, as in the list of employees: to be seen as such. */}
                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    {/* Betriebsferien can be moved; their vacation moves along. */}
                    {holiday.kind === 'Betriebsferien' && holiday.id > 0 && (
                      <Button size="compact-sm" variant="default" onClick={() => setChanging(holiday)}>
                        Bearbeiten
                      </Button>
                    )}
                    <Button
                      size="compact-sm"
                      color="red"
                      variant="outline"
                      onClick={() => {
                        // Betriebsferien take the vacation they gave with them.
                        if (holiday.kind === 'Betriebsferien' && !window.confirm('Betriebsferien löschen? Der Urlaub aller Handwerker an diesen Tagen wird wieder entfernt.'))
                          return
                        void run(async () => {
                          await api.deleteSchoolHoliday(holiday.id)
                          return ''
                        })
                      }}
                    >
                      Löschen
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {holidays.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>Für {year} sind noch keine Ferien oder Feiertage eingetragen.</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed" ta="right" mt={-8}>
        Schulferien und Feiertage: openholidaysapi.org
      </Text>

      <Paper withBorder p="sm" component="form" onSubmit={add}>
        <Title order={4} className="section-heading" mb={4}>
          Von Hand eintragen
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          z. B. Brückentag, Betriebsferien: Urlaub für alle Handwerker
        </Text>
        <Group align="flex-end" gap="sm">
          <TextInput label="Bezeichnung" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Select
            label="Art"
            value={kind}
            onChange={(value) => value && setKind(value as HolidayKind)}
            data={['Feiertag', 'Schulferien', 'Betriebsferien']}
            allowDeselect={false}
            w={150}
          />
          <DatePickerInput
            type="range"
            label="Zeitraum"
            value={range}
            onChange={(value) => setRange(value as [string | null, string | null])}
            valueFormat="DD.MM.YYYY"
            miw={220}
            required
          />
          <Button type="submit" variant="light" loading={busy} disabled={!range[0] || !range[1]}>
            Hinzufügen
          </Button>
        </Group>
      </Paper>

      {changing && (
        <ClosureEditor
          closure={changing}
          onClose={() => setChanging(null)}
          onSaved={() => {
            setChanging(null)
            notifications.show({ message: 'Betriebsferien geändert: Der Urlaub der Handwerker ist angepasst.', color: 'green' })
            load()
          }}
        />
      )}
    </Stack>
  )
}

/**
 * Changes the name and days of Betriebsferien. The vacation they gave goes from the old days and comes on the new
 * ones; what is planned on the new days is replaced, as when they are entered.
 */
function ClosureEditor({ closure, onClose, onSaved }: { closure: SchoolHoliday; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(closure.name)
  const [range, setRange] = useState<[string | null, string | null]>([closure.startDate, closure.endDate])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [start, end] = range

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!start || !end) return
    setBusy(true)
    setError('')
    try {
      await api.updateSchoolHoliday(closure.id, name, start, end, 'Betriebsferien')
      onSaved()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose} title={<Text fw={700}>Betriebsferien bearbeiten</Text>} size="md">
      <form onSubmit={save}>
        <Stack gap="sm">
          <TextInput label="Bezeichnung" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} required data-autofocus />
          <DatePickerInput
            type="range"
            label="Zeitraum"
            value={range}
            onChange={(value) => setRange(value as [string | null, string | null])}
            valueFormat="DD.MM.YYYY"
            required
          />
          <Text size="sm" c="dimmed">
            Der Urlaub aller Handwerker wird an den neuen Zeitraum angepasst: An weggefallenen Tagen wird er entfernt, an
            neuen Werktagen eingetragen. Was an neuen Tagen geplant ist, wird ersetzt.
          </Text>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" loading={busy} disabled={!start || !end || !name.trim()}>
              Speichern
            </Button>
          </Group>
        </Stack>
      </form>
    </Sheet>
  )
}
