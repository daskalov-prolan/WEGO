import { Alert, Anchor, Select, SimpleGrid, Table, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { EmployeeReport, NamedItem, Vacation } from '../api/types'
import { Stat } from '../components/Stat'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'

interface Props {
  year: number
  employeeId: number | null
}

/** Planner-only: where one employee worked during the year, with vacation and sick days. */
export function EmployeeReportPage({ year, employeeId }: Props) {
  const [employees, setEmployees] = useState<NamedItem[]>([])
  const [report, setReport] = useState<EmployeeReport | null>(null)
  const [overview, setOverview] = useState<Vacation[]>([])
  const [error, setError] = useState('')

  const selectedId = employeeId ?? employees[0]?.id ?? null

  useEffect(() => {
    api.employeeNames().then(setEmployees, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    if (selectedId === null) return
    api.employeeReport(selectedId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [selectedId, year])

  useEffect(() => {
    api.vacationOverview(year).then(setOverview, (e) => setError(messageOf(e)))
  }, [year])

  const current = report && report.employeeId === selectedId && report.year === year ? report : null

  return (
    <div className="page">
      <Title order={2} mb="md">
        Auswertung nach Mitarbeiter
      </Title>

      <Select
        label="Mitarbeiter"
        searchable
        maw={320}
        mb="md"
        value={selectedId === null ? null : String(selectedId)}
        onChange={(value) => value && (window.location.hash = `#/mitarbeiter/${value}`)}
        data={employees.map((employee) => ({ value: String(employee.id), label: employee.name }))}
      />

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      {current && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm" mb="lg">
            <Stat value={current.totalDays} label={`Tage auf Baustellen ${current.year}`} />
            <Stat value={current.sites.length} label="Baustellen" />
            <Stat
              value={`${current.vacation.used} / ${current.vacation.entitlement}`}
              label="Urlaubstage verbraucht bzw. eingeplant"
            />
            <Stat
              value={current.vacation.remaining}
              label="Urlaubstage noch verfügbar"
              negative={current.vacation.remaining < 0}
            />
            <Stat value={current.vacation.sickDays} label="Krankheitstage" />
          </SimpleGrid>

          <Title order={4} mb="xs">
            Nach Baustelle
          </Title>
          <Table.ScrollContainer minWidth={420} mb="lg">
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Baustelle</Table.Th>
                  <Table.Th ta="right">Einsatztage</Table.Th>
                  <Table.Th ta="right">Stunden</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.sites.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td>
                      <Anchor href={`#/baustellen/${row.id}`}>{row.name}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.days}</Table.Td>
                    <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
                  </Table.Tr>
                ))}
                {current.sites.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>Keine Einsätze in {current.year}.</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Title order={4} mb="xs">
            Alle Einsätze
          </Title>
          <Table.ScrollContainer minWidth={420} mb="lg">
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tag</Table.Th>
                  <Table.Th>Baustelle</Table.Th>
                  <Table.Th>Zeitfenster</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.entries.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{formatDate(entry.date)}</Table.Td>
                    <Table.Td>{entry.siteName}</Table.Td>
                    <Table.Td>{formatTimeRange(entry) || 'ganztägig'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}

      {overview.length > 0 && (
        <>
          <Title order={4} mb="xs">
            Urlaubsübersicht {year}
          </Title>
          <Table.ScrollContainer minWidth={520}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th ta="right">Anspruch</Table.Th>
                  <Table.Th ta="right">Verbraucht / eingeplant</Table.Th>
                  <Table.Th ta="right">Verfügbar</Table.Th>
                  <Table.Th ta="right">Krankheitstage</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {overview.map((row) => (
                  <Table.Tr key={row.employeeId}>
                    <Table.Td>
                      <Anchor href={`#/mitarbeiter/${row.employeeId}`}>{row.employeeName}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.entitlement}</Table.Td>
                    <Table.Td ta="right">{row.used}</Table.Td>
                    <Table.Td ta="right" c={row.remaining < 0 ? 'red.7' : undefined}>
                      {row.remaining}
                    </Table.Td>
                    <Table.Td ta="right">{row.sickDays}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </div>
  )
}
