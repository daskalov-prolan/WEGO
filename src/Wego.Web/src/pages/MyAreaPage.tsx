import { Alert, Badge, Group, Select, SimpleGrid, Table, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { MyVacation, User } from '../api/types'
import { Stat } from '../components/Stat'
import { CURRENT_YEAR, formatDate, todayIso } from '../lib/dates'

/** Days with halves: 24 and 31 December count half a day each. */
const days = (count: number) => (count === 0.5 ? '½' : count.toLocaleString('de-DE'))

/** Vacation days are counted from this year on (see the server). */
const COUNTED_FROM = 2027

/**
 * "Mein Bereich": what every employee sees about themselves. For now their vacation: how many days they
 * have, how many are used, how many are left, and when they take them, as stretches of days.
 */
export function MyAreaPage({ user }: { user: User }) {
  const first = Math.max(COUNTED_FROM, CURRENT_YEAR)
  // Five years to choose from, and later on always the year to come as well.
  const years = Array.from({ length: Math.max(COUNTED_FROM + 4, CURRENT_YEAR + 1) - COUNTED_FROM + 1 }, (_, i) => String(COUNTED_FROM + i))
  const [year, setYear] = useState(first)
  const [vacation, setVacation] = useState<MyVacation | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.myVacation(year).then(
      (result) => {
        setVacation(result)
        setError('')
      },
      (e) => setError(messageOf(e)),
    )
  }, [year])

  const today = todayIso()

  return (
    <div className="page">
      <Title order={2} mb={4}>
        Mein Bereich
      </Title>
      <Text c="dimmed" mb="md">
        {user.name}
      </Text>

      <Group justify="space-between" align="flex-end" mb="sm">
        <Title order={3}>Mein Urlaub</Title>
        <Select
          aria-label="Jahr"
          w={110}
          value={String(year)}
          onChange={(value) => value && setYear(Number(value))}
          allowDeselect={false}
          data={years}
        />
      </Group>

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}

      {vacation && (
        <>
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm" mb="lg">
            <Stat value={vacation.entitlement} label={`Urlaubstage ${vacation.year}`} />
            <Stat value={days(vacation.used)} label={`verbraucht bzw. eingeplant (davon ${days(vacation.taken)} schon genommen)`} />
            <Stat value={days(vacation.remaining)} label="noch verfügbar" negative={vacation.remaining < 0} />
          </SimpleGrid>

          <Title order={4} mb="xs">
            Wann
          </Title>
          {vacation.blocks.length === 0 ? (
            <Text c="dimmed">Für {vacation.year} ist noch kein Urlaub eingetragen.</Text>
          ) : (
            <Table.ScrollContainer minWidth={360}>
              <Table striped withTableBorder verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Zeitraum</Table.Th>
                    <Table.Th ta="right">Tage</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {vacation.blocks.map((block) => (
                    <Table.Tr key={block.from}>
                      <Table.Td>{block.from === block.to ? formatDate(block.from) : `${formatDate(block.from)} – ${formatDate(block.to)}`}</Table.Td>
                      <Table.Td ta="right">{days(block.days)}</Table.Td>
                      <Table.Td>
                        {block.to < today ? (
                          <Badge color="gray" variant="light">
                            genommen
                          </Badge>
                        ) : block.from <= today ? (
                          <Badge color="orange" variant="light">
                            läuft
                          </Badge>
                        ) : (
                          <Badge color="green" variant="light">
                            geplant
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Text size="sm" c="dimmed" mt="sm">
            Gezählt werden die Urlaubstage ab dem Jahr {COUNTED_FROM}. Der 24.12. und der 31.12. zählen je als halber Urlaubstag.
          </Text>
        </>
      )}
    </div>
  )
}
