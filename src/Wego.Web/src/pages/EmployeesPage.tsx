import { Alert, Anchor, Badge, CloseButton, Group, Select, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee, EmployeeOverview } from '../api/types'
import { canPlanRole, roleLabel } from '../lib/roles'

/** Which employees the list shows; the inactive ones only when asked for. */
type Show = 'active' | 'craftsmen' | 'planners' | 'inactive' | 'all'

function shows(employee: EmployeeOverview, show: Show): boolean {
  if (show === 'all') return true
  if (show === 'inactive') return !employee.isActive
  if (!employee.isActive) return false
  if (show === 'craftsmen') return employee.showInPlan
  if (show === 'planners') return canPlanRole(employee.role)
  return true
}

const euroPerHour = (rate: number) =>
  `${rate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/Std.`

/**
 * All employees with their role and telephone, for everybody. Planer G see the wage per hour as well and
 * open an employee in the administration to change them.
 */
export function EmployeesPage({ canEdit = false }: { canEdit?: boolean }) {
  // Planer G get the full records, with the wage per hour.
  const [employees, setEmployees] = useState<(EmployeeOverview & Pick<Employee, 'hourlyRate'>)[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('active')

  useEffect(() => {
    const list = canEdit ? api.employees() : api.employeesOverview()
    list.then(setEmployees, (e) => setError(messageOf(e)))
  }, [canEdit])

  const needle = search.trim().toLowerCase()
  const shown = employees
    .filter((employee) => shows(employee, show))
    .filter((employee) => !needle || employee.name.toLowerCase().includes(needle))

  return (
    <div className="page">
      <Title order={2} mb="md">
        Mitarbeiter
      </Title>
      <Group gap="md" mb="md" align="flex-end">
        <TextInput
          placeholder="Name suchen"
          aria-label="Mitarbeiter suchen"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          rightSection={search ? <CloseButton size="sm" aria-label="Suche leeren" onClick={() => setSearch('')} /> : null}
          w={260}
        />
        <Select
          aria-label="Anzeigen"
          w={220}
          value={show}
          onChange={(value) => value && setShow(value as Show)}
          allowDeselect={false}
          data={[
            { value: 'active', label: 'Aktive Mitarbeiter' },
            { value: 'craftsmen', label: 'Handwerker' },
            { value: 'planners', label: 'Planer' },
            { value: 'inactive', label: 'Inaktive Mitarbeiter' },
            { value: 'all', label: 'Alle Mitarbeiter' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {shown.length} von {employees.length}
        </Text>
      </Group>
      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}
      <Table.ScrollContainer minWidth={560}>
        <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={190}>Rolle</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Telefon</Table.Th>
              {canEdit && (
                <Table.Th w={130} ta="right">
                  Stundensatz
                </Table.Th>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((employee) => (
              <Table.Tr
                key={employee.id}
                className={canEdit ? 'site-row' : undefined}
                opacity={employee.isActive ? 1 : 0.55}
                onClick={canEdit ? () => (window.location.hash = `#/verwaltung/${employee.id}`) : undefined}
              >
                <Table.Td>
                  <Group gap={4}>
                    <Badge variant="light" color={employee.role === 'Handwerker' ? 'gray' : 'wego'}>
                      {roleLabel(employee.role)}
                    </Badge>
                    {/* A planner with a row in the plan works on the sites as well. */}
                    {canPlanRole(employee.role) && employee.showInPlan && (
                      <Badge variant="light" color="gray">
                        Handwerker
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td fw={600}>
                  {canEdit ? (
                    <a href={`#/verwaltung/${employee.id}`} onClick={(event) => event.stopPropagation()}>
                      {employee.name}
                    </a>
                  ) : (
                    employee.name
                  )}
                  {!employee.isActive && (
                    <Badge color="gray" size="xs" ml={6}>
                      inaktiv
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {employee.phone && (
                    <Anchor
                      href={`tel:${employee.phone.replace(/[^+0-9]/g, '')}`}
                      onClick={(event) => event.stopPropagation()}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {employee.phone}
                    </Anchor>
                  )}
                </Table.Td>
                {canEdit && (
                  <Table.Td ta="right">{employee.hourlyRate == null ? '–' : euroPerHour(employee.hourlyRate)}</Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  )
}
