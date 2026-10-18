import { Alert, Anchor, ColorSwatch, Group, Paper, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Customer, CustomerReport } from '../api/types'
import { SiteLocation } from '../components/SiteLocation'
import { Stat } from '../components/Stat'
import { ACTIVITIES, activityLabel } from '../lib/activities'
import { formatDate, formatHours, formatTimeRange } from '../lib/dates'

interface Props {
  year: number
  customerId: number | null
}

/** How many days were worked on one construction site, and by whom. */
export function CustomerReportPage({ year, customerId }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [report, setReport] = useState<CustomerReport | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.customers().then(setCustomers, (e) => setError(messageOf(e)))
  }, [])

  useEffect(() => {
    if (customerId === null) return
    api.customerReport(customerId, year).then(setReport, (e) => setError(messageOf(e)))
  }, [customerId, year])

  const site = customers.find((customer) => customer.id === customerId)
  const current = report && report.customerId === customerId && report.year === year ? report : null

  // How far the job has come: employee days per activity, in the order of the job.
  const byActivity = ACTIVITIES.map((activity) => ({
    ...activity,
    days: current?.entries.filter((entry) => entry.activity === activity.value).length ?? 0,
    last: current?.entries.filter((entry) => entry.activity === activity.value).at(-1)?.date,
  })).filter((row) => row.days > 0)

  return (
    <div className="page">
      <Title order={2} mb="md">
        Auswertung nach Baustelle
      </Title>

      <Select
        label="Baustelle (Kunde)"
        placeholder="Kunden suchen"
        searchable
        limit={50}
        maw={360}
        mb="md"
        value={customerId === null ? null : String(customerId)}
        onChange={(value) => value && (window.location.hash = `#/baustellen/${value}`)}
        data={customers.map((customer) => ({ value: String(customer.id), label: customer.name }))}
      />

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      {site && (site.location || site.description) && (
        <Paper withBorder p="sm" mb="md" className="site-card">
          <Stack gap={2}>
            {site.location && <SiteLocation location={site.location} />}
            {site.description && <Text size="sm">{site.description}</Text>}
          </Stack>
        </Paper>
      )}

      {current && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm" mb="xs">
            <Stat value={current.totalDays} label={`Einsatztage ${current.year}`} />
            <Stat value={current.employees.length} label="Mitarbeiter" />
            <Stat value={formatHours(current.totalHours)} label="Stunden laut Zeitfenstern" />
          </SimpleGrid>
          <Text size="sm" c="dimmed" mb="lg">
            Ein Einsatztag ist ein Tag, an dem ein Mitarbeiter auf dieser Baustelle eingeplant war, auch bei geteilten
            Tagen. Stunden werden nur aus Einträgen mit Zeitfenster berechnet.
          </Text>

          <Title order={4} mb="xs">
            Nach Mitarbeiter
          </Title>
          <Table.ScrollContainer minWidth={380} mb="lg">
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th ta="right">Einsatztage</Table.Th>
                  <Table.Th ta="right">Stunden</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.employees.map((row) => (
                  <Table.Tr key={row.id}>
                    <Table.Td>
                      <Anchor href={`#/mitarbeiter/${row.id}`}>{row.name}</Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{row.days}</Table.Td>
                    <Table.Td ta="right">{formatHours(row.hours)}</Table.Td>
                  </Table.Tr>
                ))}
                {current.employees.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={3}>Keine Einsätze in {current.year}.</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th>Summe</Table.Th>
                  <Table.Th ta="right">{current.totalDays}</Table.Th>
                  <Table.Th ta="right">{formatHours(current.totalHours)}</Table.Th>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>

          {byActivity.length > 0 && (
            <>
              <Title order={4} mb="xs">
                Nach Tätigkeit
              </Title>
              <Table.ScrollContainer minWidth={380} mb="lg">
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Tätigkeit</Table.Th>
                      <Table.Th ta="right">Einsatztage</Table.Th>
                      <Table.Th>Zuletzt</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {byActivity.map((row) => (
                      <Table.Tr key={row.value}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <ColorSwatch color={row.background} size={12} withShadow={false} />
                            {row.label}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{row.days}</Table.Td>
                        <Table.Td>{row.last && formatDate(row.last)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}

          <Title order={4} mb="xs">
            Alle Einsätze
          </Title>
          <Table.ScrollContainer minWidth={380}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tag</Table.Th>
                  <Table.Th>Mitarbeiter</Table.Th>
                  <Table.Th>Tätigkeit</Table.Th>
                  <Table.Th>Zeitfenster</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {current.entries.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{formatDate(entry.date)}</Table.Td>
                    <Table.Td>{entry.employeeName}</Table.Td>
                    <Table.Td>{activityLabel(entry.activity)}</Table.Td>
                    <Table.Td>{formatTimeRange(entry) || 'ganztägig'}</Table.Td>
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
