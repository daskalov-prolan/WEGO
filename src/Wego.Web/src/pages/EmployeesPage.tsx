import { Alert, Badge, CloseButton, Group, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Employee } from '../api/types'
import { ActivityBadges } from '../components/EmployeeActivities'

/** Planner-only: all employees with their activities; each opens the page of the employee. */
export function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  useEffect(() => {
    api.employees().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])

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
      <Table.ScrollContainer minWidth={560}>
        <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Tätigkeiten</Table.Th>
              <Table.Th w={130}>Rolle</Table.Th>
              <Table.Th w={150} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((employee) => (
              <Table.Tr key={employee.id} className="site-row" opacity={employee.isActive ? 1 : 0.55} onClick={() => (window.location.hash = `#/mitarbeiter/${employee.id}`)}>
                <Table.Td fw={600}>
                  <a href={`#/mitarbeiter/${employee.id}`} onClick={(event) => event.stopPropagation()}>
                    {employee.name}
                  </a>
                </Table.Td>
                <Table.Td>
                  <ActivityBadges mainActivity={employee.mainActivity} additionalActivities={employee.additionalActivities} />
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={employee.role === 'Planer' ? 'wego' : 'gray'}>
                    {employee.role}
                  </Badge>
                </Table.Td>
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
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  )
}
