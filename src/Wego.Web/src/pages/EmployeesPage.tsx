import { Alert, Badge, CloseButton, Group, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee, Plan } from '../api/types'
import { Chip } from '../components/Chip'
import { ActivityBadges } from '../components/EmployeeActivities'
import { isOpen } from '../lib/activities'
import { todayIso } from '../lib/dates'
import { workRuns, type WorkRun } from '../lib/tasks'

/** How many stretches of work a row shows before "+ N". */
const FIRST_RUNS = 6

const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

/**
 * Planner-only: all employees with their role, what is planned for them on open sites from today on (in
 * the order of the days, each stretch in the colour of its activity) and what they can do; each row opens
 * the page of the employee.
 */
export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const today = todayIso()

  useEffect(() => {
    api.employees().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])

  // From today on: this year and the next.
  useEffect(() => {
    const year = Number(today.slice(0, 4))
    Promise.all([year, year + 1].map((one) => api.plan(one))).then(setPlans, (e) => setError(messageOf(e)))
  }, [today])

  const runsByEmployee = useMemo(() => {
    const openSites = new Set(plans.flatMap((plan) => plan.sites ?? []).filter((site) => isOpen(site.status)).map((site) => site.id))
    const upcoming = plans
      .flatMap((plan) => plan.entries ?? [])
      .filter((entry) => entry.date >= today && entry.siteId !== null && openSites.has(entry.siteId))
    const result = new Map<number, WorkRun[]>()
    for (const employee of employees) result.set(employee.id, workRuns(upcoming.filter((entry) => entry.employeeId === employee.id)))
    return result
  }, [plans, employees, today])

  const needle = search.trim().toLowerCase()
  const shown = employees
    .filter((employee) => !activeOnly || employee.isActive)
    .filter((employee) => !needle || employee.name.toLowerCase().includes(needle))

  return (
    <div className="page">
      <Title order={2} mb="md">
        Mitarbeiter
      </Title>
      <Group gap="md" mb="md">
        <TextInput
          placeholder="Name suchen"
          aria-label="Mitarbeiter suchen"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          rightSection={search ? <CloseButton size="sm" aria-label="Suche leeren" onClick={() => setSearch('')} /> : null}
          w={260}
        />
        <Switch label="Nur aktive" checked={activeOnly} onChange={(event) => setActiveOnly(event.currentTarget.checked)} />
        <Text size="sm" c="dimmed">
          {shown.length} von {employees.length}
        </Text>
      </Group>
      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={120}>Rolle</Table.Th>
              <Table.Th w={170}>Name</Table.Th>
              <Table.Th>Geplant auf offenen Baustellen</Table.Th>
              <Table.Th w={300}>Fähigkeiten</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((employee) => {
              const runs = runsByEmployee.get(employee.id) ?? []
              return (
                <Table.Tr
                  key={employee.id}
                  className="site-row"
                  opacity={employee.isActive ? 1 : 0.55}
                  onClick={() => (window.location.hash = `#/mitarbeiter/${employee.id}`)}
                >
                  <Table.Td>
                    <Badge variant="light" color={employee.role === 'Planer' ? 'wego' : 'gray'}>
                      {employee.role}
                    </Badge>
                  </Table.Td>
                  <Table.Td fw={600}>
                    <a href={`#/mitarbeiter/${employee.id}`} onClick={(event) => event.stopPropagation()}>
                      {employee.name}
                    </a>
                    {!employee.isActive && (
                      <Badge color="gray" size="xs" ml={6}>
                        inaktiv
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <span className="employee-runs" aria-label={`Geplant für ${employee.name}`}>
                      {runs.slice(0, FIRST_RUNS).map((run) => (
                        <Chip
                          key={run.first.id}
                          entry={run.first}
                          label={`${run.from === run.to ? short(run.from) : `${short(run.from)}–${short(run.to)}`}: ${run.first.siteName}`}
                        />
                      ))}
                      {runs.length > FIRST_RUNS && (
                        <Text span size="xs" c="dimmed">
                          + {runs.length - FIRST_RUNS}
                        </Text>
                      )}
                      {plans.length > 0 && runs.length === 0 && employee.showInPlan && (
                        <Text span size="xs" c="dimmed">
                          nichts geplant
                        </Text>
                      )}
                    </span>
                  </Table.Td>
                  <Table.Td>
                    <ActivityBadges mainActivity={employee.mainActivity} additionalActivities={employee.additionalActivities} />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  )
}
