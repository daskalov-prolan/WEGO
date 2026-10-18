import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, Plan, User, Vacation } from '../api/types'
import { SiteLocation } from '../components/SiteLocation'
import { addDays, daysBetween, formatDateLong, formatTimeRange, todayIso, weekOf } from '../lib/dates'
import { siteStyle, useSwipe } from '../lib/ui'

interface Props {
  year: number
  user: User
}

/**
 * What a craftsman needs: their own week. For every day where they have to be, when, and who else
 * is on the same construction site that day.
 */
export function MyPlanPage({ year, user }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const inYear = (iso: string) => iso >= first && iso <= last

  const [plan, setPlan] = useState<Plan | null>(null)
  const [vacation, setVacation] = useState<Vacation | null>(null)
  const [error, setError] = useState('')
  const [anchor, setAnchor] = useState(inYear(today) ? today : first)

  useEffect(() => {
    api.plan(year).then(setPlan, (e) => setError(messageOf(e)))
    api.employeeReport(user.id, year).then((report) => setVacation(report.vacation), () => setVacation(null))
  }, [year, user.id])

  const ownByDate = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const entry of plan?.entries ?? []) {
      if (entry.employeeId !== user.id) continue
      const list = map.get(entry.date)
      if (list) list.push(entry)
      else map.set(entry.date, [entry])
    }
    return map
  }, [plan, user.id])

  // Everybody else on the same site on the same day, with their time window if they have one.
  const colleaguesOf = (entry: Entry) =>
    (plan?.entries ?? [])
      .filter(
        (other) =>
          other.employeeId !== user.id &&
          other.date === entry.date &&
          other.customerId !== null &&
          other.customerId === entry.customerId,
      )
      .map((other) => {
        const time = formatTimeRange(other)
        return time ? `${other.employeeName} (${time})` : other.employeeName
      })

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const holiday of plan?.schoolHolidays ?? []) {
      for (const day of daysBetween(holiday.startDate, holiday.endDate)) map.set(day.iso, holiday.name)
    }
    return map
  }, [plan])

  const go = (iso: string) => setAnchor(iso < first ? first : iso > last ? last : iso)
  const swipe = useSwipe(
    () => go(addDays(anchor, 7)),
    () => go(addDays(anchor, -7)),
  )

  const siteById = useMemo(() => new Map((plan?.customers ?? []).map((site) => [site.id, site])), [plan])

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const week = weekOf(anchor).filter((day) => inYear(day.iso))
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

  return (
    <div className="page my-plan" {...swipe}>
      <Group justify="space-between" align="baseline" mb={4}>
        <Title order={2}>Mein Plan</Title>
        {vacation && (
          <Badge size="lg" variant="light" color={vacation.remaining < 0 ? 'red' : 'green'}>
            Urlaub: {vacation.remaining} von {vacation.entitlement} Tagen frei
          </Badge>
        )}
      </Group>

      <Group gap="xs" my="md" wrap="nowrap">
        <ActionIcon variant="default" size="lg" onClick={() => go(addDays(anchor, -7))} aria-label="Vorherige Woche">
          ‹
        </ActionIcon>
        <Text fw={700} c="wego.9" ta="center" style={{ flex: 1 }}>
          {short(week[0].iso)} – {short(week[week.length - 1].iso)}
          {year}
        </Text>
        <ActionIcon variant="default" size="lg" onClick={() => go(addDays(anchor, 7))} aria-label="Nächste Woche">
          ›
        </ActionIcon>
        {inYear(today) && (
          <Button variant="default" onClick={() => setAnchor(today)}>
            Heute
          </Button>
        )}
      </Group>

      <Stack gap="sm">
        {week.map((day) => {
          const entries = ownByDate.get(day.iso) ?? []
          // Empty weekends only take up space.
          if (day.isWeekend && entries.length === 0) return null

          return (
            <Paper
              component="section"
              withBorder
              radius="md"
              p="sm"
              key={day.iso}
              className={day.iso === today ? 'my-day today' : 'my-day'}
            >
              <Group gap="xs" mb={entries.length ? 'xs' : 0}>
                <Text fw={700} c="wego.9">
                  {formatDateLong(day.iso)}
                </Text>
                {day.iso === today && <Badge color="wego">Heute</Badge>}
                {holidayByDate.has(day.iso) && (
                  <Badge color="yellow" variant="light">
                    {holidayByDate.get(day.iso)}
                  </Badge>
                )}
              </Group>

              {entries.length === 0 && (
                <Text size="sm" c="dimmed">
                  nicht eingeplant
                </Text>
              )}

              <Stack gap="xs">
                {entries.map((entry) => {
                  if (entry.type !== 'Baustelle') {
                    return (
                      <div className={`my-entry my-entry-${entry.type.toLowerCase()}`} key={entry.id}>
                        <span className="where">{entry.type}</span>
                      </div>
                    )
                  }
                  const colleagues = colleaguesOf(entry)
                  const site = entry.customerId === null ? undefined : siteById.get(entry.customerId)
                  return (
                    <div className="my-entry" key={entry.id} style={siteStyle(entry.customerId)}>
                      <span className="when">{formatTimeRange(entry) || 'ganztägig'}</span>
                      <span className="where">{entry.customerName}</span>
                      {site?.location && <SiteLocation location={site.location} />}
                      {site?.description && <span className="detail">{site.description}</span>}
                      {entry.note && <span className="detail">{entry.note}</span>}
                      <span className="detail">
                        {colleagues.length > 0 ? `mit ${colleagues.join(', ')}` : 'allein'}
                      </span>
                    </div>
                  )
                })}
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </div>
  )
}