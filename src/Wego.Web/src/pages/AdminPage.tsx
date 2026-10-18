import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
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
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api/client'
import type { Access, Customer, Employee, EmployeeInput, Role, SchoolHoliday } from '../api/types'
import { Sheet } from '../components/Sheet'
import { formatDate } from '../lib/dates'
import { siteStyle } from '../lib/ui'

/** Planner-only: employees and their rights, school holidays, construction sites. */
export function AdminPage({ year }: { year: number }) {
  return (
    <div className="page">
      <Title order={2} mb="md">
        Verwaltung
      </Title>
      <Tabs defaultValue="employees" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="employees">Mitarbeiter</Tabs.Tab>
          <Tabs.Tab value="sites">Baustellen</Tabs.Tab>
          <Tabs.Tab value="holidays">Schulferien</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="employees">
          <EmployeesSection />
        </Tabs.Panel>
        <Tabs.Panel value="sites">
          <CustomersSection />
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
  role: 'Mitarbeiter',
  password: null,
}

function EmployeesSection() {
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
        Gesamtplan nur zum Lesen.
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
            <Table withTableBorder bg="white">
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

      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Benutzername</Table.Th>
              <Table.Th>Rolle</Table.Th>
              <Table.Th ta="right">Urlaubstage</Table.Th>
              <Table.Th ta="right">Reihenfolge</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {employees.map((employee) => (
              <Table.Tr key={employee.id} opacity={employee.isActive ? 1 : 0.55}>
                <Table.Td fw={600}>{employee.name}</Table.Td>
                <Table.Td>
                  {employee.userName ?? (
                    <Text size="sm" c="dimmed">
                      keine Anmeldung
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={employee.role === 'Planer' ? 'wego' : 'gray'}>
                    {employee.role}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{employee.vacationDaysPerYear}</Table.Td>
                <Table.Td ta="right">{employee.sortOrder}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {!employee.isActive && <Badge color="gray">inaktiv</Badge>}
                    {!employee.showInPlan && (
                      <Badge color="gray" variant="outline">
                        nicht im Plan
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Button
                      size="compact-sm"
                      variant="default"
                      onClick={() =>
                        setEditing({
                          id: employee.id,
                          input: {
                            name: employee.name,
                            sortOrder: employee.sortOrder,
                            isActive: employee.isActive,
                            showInPlan: employee.showInPlan,
                            vacationDaysPerYear: employee.vacationDaysPerYear,
                            userName: employee.userName,
                            role: employee.role,
                            password: null,
                          },
                        })
                      }
                    >
                      Bearbeiten
                    </Button>
                    {employee.isActive && (
                      <Button
                        size="compact-sm"
                        variant="light"
                        onClick={() =>
                          (!employee.hasPassword ||
                            window.confirm(
                              `Neues Startpasswort für ${employee.name} erzeugen? Das bisherige Passwort gilt dann nicht mehr.`,
                            )) &&
                          createAccesses([employee])
                        }
                      >
                        {employee.hasPassword ? 'Passwort zurücksetzen' : 'Zugang anlegen'}
                      </Button>
                    )}
                  </Group>
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
                  data={['Mitarbeiter', 'Planer']}
                  allowDeselect={false}
                />
                <NumberInput
                  label="Urlaubstage pro Jahr"
                  min={0}
                  max={366}
                  value={editing.input.vacationDaysPerYear}
                  onChange={(value) => change({ vacationDaysPerYear: Number(value) || 0 })}
                />
                <NumberInput
                  label="Reihenfolge im Plan"
                  value={editing.input.sortOrder}
                  onChange={(value) => change({ sortOrder: Number(value) || 0 })}
                />
              </SimpleGrid>
              <Checkbox
                label="Spalte im Gesamtplan (wird auf Baustellen eingeplant)"
                checked={editing.input.showInPlan}
                onChange={(e) => change({ showInPlan: e.currentTarget.checked })}
              />
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

function SchoolHolidaysSection({ year }: { year: number }) {
  const [holidays, setHolidays] = useState<SchoolHoliday[]>([])
  const [name, setName] = useState('')
  const [range, setRange] = useState<[string | null, string | null]>([null, null])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    void run(async () => {
      await api.addSchoolHoliday(name, start, end)
      setName('')
      setRange([null, null])
      return 'Ferien eingetragen.'
    })
  }

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Button
          loading={busy}
          onClick={() =>
            run(async () => {
              const result = await api.importSchoolHolidays(year)
              return `${result.imported} von ${result.total} Ferienzeiträumen neu übernommen.`
            })
          }
        >
          Schulferien Berlin {year} automatisch abrufen
        </Button>
        <Text size="sm" c="dimmed">
          Quelle: openholidaysapi.org
        </Text>
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Table.ScrollContainer minWidth={460}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Bezeichnung</Table.Th>
              <Table.Th>Von</Table.Th>
              <Table.Th>Bis</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {holidays.map((holiday) => (
              <Table.Tr key={holiday.id}>
                <Table.Td>{holiday.name}</Table.Td>
                <Table.Td>{formatDate(holiday.startDate)}</Table.Td>
                <Table.Td>{formatDate(holiday.endDate)}</Table.Td>
                <Table.Td ta="right">
                  <Button
                    size="compact-sm"
                    color="red"
                    variant="subtle"
                    onClick={() =>
                      run(async () => {
                        await api.deleteSchoolHoliday(holiday.id)
                        return ''
                      })
                    }
                  >
                    Löschen
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {holidays.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>Für {year} sind noch keine Schulferien eingetragen.</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Paper withBorder p="sm" component="form" onSubmit={add}>
        <Text fw={600} size="sm" mb="xs">
          Ferien von Hand eintragen
        </Text>
        <Group align="flex-end" gap="sm">
          <TextInput label="Bezeichnung" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <DatePickerInput
            type="range"
            label="Zeitraum"
            value={range}
            onChange={(value) => setRange(value as [string | null, string | null])}
            valueFormat="DD.MM.YYYY"
            miw={220}
            required
          />
          <Button type="submit" variant="light" disabled={!range[0] || !range[1]}>
            Hinzufügen
          </Button>
        </Group>
      </Paper>
    </Stack>
  )
}

function CustomersSection() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [editing, setEditing] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(() => {
    api.customers().then(setCustomers, (e) => setError(messageOf(e)))
  }, [])
  useEffect(load, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      await api.updateCustomer(editing.id, {
        name: editing.name,
        location: editing.location,
        description: editing.description,
      })
      setEditing(null)
      setFormError('')
      notifications.show({ message: 'Baustelle gespeichert.', color: 'green' })
      load()
    } catch (e) {
      setFormError(messageOf(e))
    }
  }

  const needle = search.trim().toLowerCase()
  const visible = needle ? customers.filter((customer) => customer.name.toLowerCase().includes(needle)) : customers

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Baustellen entstehen beim Eintragen im Gesamtplan. Ort und Beschreibung sehen die Handwerker in „Mein
        Plan“. Wer einer Baustelle den Namen einer anderen gibt, führt beide zusammen – so lassen sich
        Schreibvarianten bereinigen.
      </Text>

      <Group gap="sm" align="flex-end">
        <TextInput
          label="Suchen"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Kundenname"
        />
        <Text size="sm" c="dimmed">
          {visible.length} von {customers.length} Baustellen
        </Text>
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Table.ScrollContainer minWidth={620}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kunde</Table.Th>
              <Table.Th>Ort / Adresse</Table.Th>
              <Table.Th>Beschreibung</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((customer) => (
              <Table.Tr key={customer.id}>
                <Table.Td>
                  <Group gap={8} wrap="nowrap">
                    <span className="site-dot" style={siteStyle(customer.id)} />
                    <Anchor href={`#/baustellen/${customer.id}`}>{customer.name}</Anchor>
                  </Group>
                </Table.Td>
                <Table.Td>{customer.location}</Table.Td>
                <Table.Td>{customer.description}</Table.Td>
                <Table.Td ta="right">
                  <Button size="compact-sm" variant="default" onClick={() => setEditing(customer)}>
                    Bearbeiten
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {editing && (
        <Sheet onClose={() => setEditing(null)} title={<Text fw={700}>Baustelle bearbeiten</Text>}>
          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="Kunde"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })}
                required
                maxLength={200}
              />
              <TextInput
                label="Ort / Adresse"
                placeholder="z. B. Musterstraße 5, 13125 Berlin"
                value={editing.location ?? ''}
                onChange={(e) => setEditing({ ...editing, location: e.currentTarget.value || null })}
                maxLength={200}
              />
              <TextInput
                label="Beschreibung"
                description="Art des Umbaus, Fliesen, Hinweise"
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.currentTarget.value || null })}
                maxLength={1000}
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
