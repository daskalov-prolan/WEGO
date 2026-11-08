import { Alert, Badge, Group, SimpleGrid, Table, Text, Title, UnstyledButton } from '@mantine/core'
import { YearPicker } from '../components/YearPicker'
import { Fragment, useEffect, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { EmployeeVacation, MyVacation, User, VacationBlock } from '../api/types'
import { ActivityIcon } from '../components/ActivityIcon'
import { Stat } from '../components/Stat'
import { CURRENT_YEAR, formatDate, PLAN_YEARS, todayIso } from '../lib/dates'

/** Days with halves: 24 and 31 December count half a day each. */
const days = (count: number) => (count === 0.5 ? '½' : count < 0 ? `−${(-count).toLocaleString('de-DE')}` : count.toLocaleString('de-DE'))

/** Vacation days are counted from this year on (see the server). */
const COUNTED_FROM = 2027

/**
 * "Mein Bereich": what every employee sees about themselves. For now their vacation: how many days they
 * have, how many are used, how many are left, and when they take them, as stretches of days.
 */
export function MyAreaPage({ user }: { user: User }) {
  const first = Math.max(COUNTED_FROM, CURRENT_YEAR)
  // The years of the calendar, from the first counted one on.
  const years = PLAN_YEARS.filter((y) => y >= COUNTED_FROM)
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

  return (
    // The same on the desktop as on a phone: one narrow column.
    <div className="page my-area">
      {/* In the colours of WEGO: the red under the title, the turquoise for the vacation. */}
      <Title order={2} mb={4} className="page-title">
        Mein Bereich
      </Title>
      <Text c="dimmed" mb="md">
        {user.name}
      </Text>

      <Group justify="space-between" align="center" mb="sm">
        <Title order={3} className="section-heading">
          <ActivityIcon type="Urlaub" size={20} /> Mein Urlaub
        </Title>
        <YearPicker year={year} years={years} onChange={setYear} />
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
            <Stat value={days(vacation.used)} label={`verbraucht bzw. eingeplant (davon ${days(vacation.taken)} schon genommen)`} tone="red" />
            <Stat value={days(vacation.remaining)} label="noch verfügbar" negative={vacation.remaining < 0} tone="filled" />
          </SimpleGrid>

          <Title order={4} mb="xs" className="section-heading">
            Wann
          </Title>
          {vacation.blocks.length === 0 ? (
            <Text c="dimmed">Für {vacation.year} ist noch kein Urlaub eingetragen.</Text>
          ) : (
            <VacationBlocks blocks={vacation.blocks} />
          )}
        </>
      )}

      {/* Planer G sees how everybody's vacation is planned. */}
      {user.role === 'PlanerG' && <TeamVacation year={year} />}
    </div>
  )
}

/** The stretches of vacation of a year, as in "Mein Bereich": when, how many days, taken or running. */
function VacationBlocks({ blocks }: { blocks: VacationBlock[] }) {
  const today = todayIso()
  return (
    // All in view on a phone, too: the state stands under the dates, the days at the right.
    <Table striped withTableBorder verticalSpacing="xs" className="brand-table my-area-table">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Zeitraum</Table.Th>
          <Table.Th ta="right" w={60}>
            Tage
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {blocks.map((block) => (
          <Table.Tr key={block.from}>
            <Table.Td>
              {block.from === block.to ? formatDate(block.from) : `${formatDate(block.from)} – ${formatDate(block.to)}`}
              {block.to < today ? (
                <Badge color="gray" variant="light" ml={6}>
                  genommen
                </Badge>
              ) : block.from <= today ? (
                <Badge color="wegoRed" variant="filled" ml={6}>
                  läuft
                </Badge>
              ) : null /* What is still to come needs no word. */}
            </Table.Td>
            <Table.Td ta="right" fw={700}>
              {days(block.days)}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/**
 * Planer G: the vacation of every active employee in the year. More days than allowed can be entered; what is
 * left is then below zero, in red. A click on a name shows when they take it.
 */
function TeamVacation({ year }: { year: number }) {
  const [team, setTeam] = useState<EmployeeVacation[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.teamVacation(year).then(
      (result) => {
        setTeam(result)
        setError('')
      },
      (e) => setError(messageOf(e)),
    )
  }, [year])

  return (
    <>
      <Title order={3} mt="xl" mb="sm" className="section-heading">
        <ActivityIcon type="Urlaub" size={20} /> Urlaub der Mitarbeiter {year}
      </Title>
      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}
      {team && (
        <Table withTableBorder verticalSpacing="xs" className="brand-table team-vacation">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Mitarbeiter</Table.Th>
              <Table.Th ta="right" w={80}>
                Tage
              </Table.Th>
              <Table.Th ta="right" w={100}>
                eingeplant
              </Table.Th>
              <Table.Th ta="right" w={130}>
                noch verfügbar
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {team.map(({ employeeId, name, vacation }) => (
              <Fragment key={employeeId}>
                <Table.Tr className={open === employeeId ? 'open' : undefined}>
                  <Table.Td>
                    <UnstyledButton
                      className="team-vacation-name"
                      aria-expanded={open === employeeId}
                      onClick={() => setOpen(open === employeeId ? null : employeeId)}
                    >
                      {open === employeeId ? '▾' : '▸'} {name}
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td ta="right">{vacation.entitlement}</Table.Td>
                  <Table.Td ta="right">{days(vacation.used)}</Table.Td>
                  <Table.Td ta="right" className={vacation.remaining < 0 ? 'team-vacation-over' : 'team-vacation-left'}>
                    {days(vacation.remaining)}
                  </Table.Td>
                </Table.Tr>
                {open === employeeId && (
                  <Table.Tr>
                    <Table.Td colSpan={4} className="team-vacation-blocks">
                      {vacation.blocks.length === 0 ? (
                        <Text c="dimmed" size="sm">
                          Für {year} ist noch kein Urlaub eingetragen.
                        </Text>
                      ) : (
                        <VacationBlocks blocks={vacation.blocks} />
                      )}
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </>
  )
}
