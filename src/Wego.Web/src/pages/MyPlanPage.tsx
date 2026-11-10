import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { YearPicker } from '../components/YearPicker'
import { SiteName } from '../components/Chip'
import { BirthdayIcon } from '../components/BirthdayIcon'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { CalendarNote, Entry, Plan, User } from '../api/types'
import { ActivityIcon } from '../components/ActivityIcon'
import { MySiteDetails } from '../components/MySiteDetails'
import { formatAddress } from '../lib/sites'
import { addDays, CURRENT_YEAR, formatDateLong, formatDayTime, HALF_DAYS, isoWeek, PLAN_YEARS, todayIso, weekOf } from '../lib/dates'
import { activityLabel, entryStyle, isFree, onlyHalfDay } from '../lib/activities'
import { holidaysByDate, useSwipe } from '../lib/ui'
import { HOME_EVENT } from '../lib/home'
import { useWindowEvent } from '@mantine/hooks'

/** Mein Plan begins with 2026, the first year planned with WEGO. */
const FIRST_YEAR = 2026

interface Props {
  year: number
  user: User
  /** The year is chosen next to the title here, not in the header. */
  onYearChange?: (year: number) => void
}

/** The Monday of the week of a day. */
const mondayOf = (iso: string) => weekOf(iso)[0].iso

/**
 * What a craftsman needs: their own days, week after week through the year, scrolled down. For every day
 * where they have to be, when, and who else is on the same construction site that day. The head (title,
 * year, the week in view, Heute) stays on top.
 */
export function MyPlanPage({ year, user, onYearChange }: Props) {
  const today = todayIso()
  // One list from 2026 on to the year after the current one (or the year chosen): it scrolls on over the turn of
  // the year, and the year in the head follows.
  const lastYear = Math.max(CURRENT_YEAR + 1, year)
  const start = `${FIRST_YEAR}-01-01`
  const end = `${lastYear}-12-31`
  const inRange = (iso: string) => iso >= start && iso <= end
  const firstWeekOf = (y: number) => mondayOf(today.startsWith(`${y}-`) ? today : `${Math.max(y, FIRST_YEAR)}-01-01`)
  // Where a year opens: today right at the top in the current year, else its first week.
  const firstDayOf = (y: number) => (today.startsWith(`${y}-`) ? today : firstWeekOf(y))

  const [plans, setPlans] = useState<Map<number, Plan>>(new Map())
  const [error, setError] = useState('')
  // The week in view while scrolling (its Monday), shown in the head.
  // Opened, the list always begins with today, whatever year was chosen last (here or in the plan).
  const opensToday = inRange(today)
  const [inView, setInView] = useState<string>(() => (opensToday ? mondayOf(today) : firstWeekOf(year)))
  // Scrolled to once the days are there: at the start, and after another year was chosen.
  const scrollTo = useRef<string | null>(opensToday ? today : firstDayOf(year))
  // The year last reported by scrolling (or chosen): another one from outside means to go there.
  const reported = useRef(year)
  const listRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  // The site tapped: its details open over the week.
  const [details, setDetails] = useState<Entry | null>(null)

  // Every year of the list, each loaded once.
  useEffect(() => {
    for (let y = FIRST_YEAR; y <= lastYear; y++) {
      if (plans.has(y)) continue
      api.plan(y).then(
        (loaded) => setPlans((current) => (current.has(y) ? current : new Map(current).set(y, loaded))),
        (e) => setError(messageOf(e)),
      )
    }
  }, [lastYear, user.id, plans])

  const loaded = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).every((y) => plans.has(y))

  // The years as one plan: the entries of each year, holidays, sites and people without doubles.
  const plan = useMemo<Plan | null>(() => {
    if (!loaded) return null
    const all = [...plans.entries()].sort(([a], [b]) => a - b)
    const unique = <T extends { id: number }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
    return {
      ...all[0][1],
      year,
      entries: all.flatMap(([y, p]) => p.entries.filter((entry) => entry.date.startsWith(`${y}-`))),
      schoolHolidays: unique(all.flatMap(([, p]) => p.schoolHolidays)),
      sites: unique(all.flatMap(([, p]) => p.sites)),
      employees: unique(all.flatMap(([, p]) => p.employees)),
      planners: unique(all.flatMap(([, p]) => p.planners ?? [])),
      notes: unique(all.flatMap(([, p]) => p.notes ?? [])),
    }
  }, [loaded, plans, year])

  /**
   * Work on a site for half a day only: the other half shows as "verfügbar", as in the plan (where it is not
   * stored as an entry of its own).
   */
  const withFreeHalf = (entries: Entry[]): Entry[] => {
    if (!onlyHalfDay(entries)) return entries
    const morning = entries.every((entry) => (entry.endTime ?? '') <= '12:00')
    const afternoon = entries.every((entry) => (entry.startTime ?? '') >= '12:00')
    // Work around midday leaves no half free.
    if (!morning && !afternoon) return entries
    const half = morning ? HALF_DAYS[1] : HALF_DAYS[0]
    const free: Entry = {
      ...entries[0],
      id: -entries[0].id,
      siteId: null,
      siteName: null,
      activity: null,
      startTime: `${half.start}:00`,
      endTime: `${half.end}:00`,
      note: null,
      noteImportant: false,
    }
    return morning ? [...entries, free] : [free, ...entries]
  }

  // The own calendar notes by day, as in the fields of the plan.
  const notesByDate = useMemo(() => {
    const map = new Map<string, CalendarNote[]>()
    for (const note of plan?.notes ?? []) {
      if (note.employeeId !== user.id) continue
      map.set(note.date, [...(map.get(note.date) ?? []), note])
    }
    return map
  }, [plan, user.id])

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

  // "ganztägig" (no time or 7–16 Uhr) or the time window.
  const timeOf = formatDayTime

  // Everybody else on the same site on the same day; their time only when it differs from the own one.
  const colleaguesOf = (entry: Entry) =>
    (plan?.entries ?? [])
      .filter(
        (other) =>
          other.employeeId !== user.id &&
          other.date === entry.date &&
          other.siteId !== null &&
          other.siteId === entry.siteId,
      )
      .map((other) => {
        const time = timeOf(other)
        return time === timeOf(entry) ? other.employeeName : `${other.employeeName} (${time})`
      })

  const holidayByDate = useMemo(() => holidaysByDate(plan?.schoolHolidays ?? []), [plan])
  // The birthdays of everybody, planners as well ("MM-DD" to the names); the own one as "Mein Geburtstag".
  const birthdays = useMemo(() => {
    const byDay = new Map<string, { mine: boolean; names: string[] }>()
    for (const { employeeId, name, birthday } of plan?.birthdays ?? []) {
      const day = byDay.get(birthday) ?? { mine: false, names: [] }
      if (employeeId === user.id) day.mine = true
      else day.names.push(name)
      byDay.set(birthday, day)
    }
    return byDay
  }, [plan, user.id])

  // The weeks of all years by their Mondays (the very first week may be short).
  const weeks = useMemo(() => {
    const list: string[] = []
    for (let monday = mondayOf(start); monday <= end; monday = addDays(monday, 7)) list.push(monday)
    return list
  }, [start, end])

  /** Scrolls to a week (its Monday), or to today: then today is the first day under the head. */
  const scrollToWeek = useCallback((iso: string) => {
    const monday = mondayOf(iso)
    const section =
      // Today, or (should it not be shown) the first day after it.
      (iso === todayIso()
        ? [...(listRef.current?.querySelectorAll<HTMLElement>('[data-day]') ?? [])].find((day) => day.dataset.day! >= iso)
        : null) ??
      listRef.current?.querySelector<HTMLElement>(`[data-week="${monday}"]`)
    // Right below the head that stays on top, in whatever scrolls the page.
    const scroller = section?.closest<HTMLElement>('.shell-main') ?? document.scrollingElement
    if (section && scroller?.scrollBy) {
      const below = headRef.current?.getBoundingClientRect().bottom ?? 0
      scroller.scrollBy({ top: section.getBoundingClientRect().top - below - 6 })
    }
    setInView(monday)
  }, [])

  // The year in the head: that of the topmost day in view (01.01.2027 shows 2027, even in KW 53).
  const [shownYear, setShownYear] = useState(opensToday ? Number(today.slice(0, 4)) : year)

  // The day on top went into another year: the year follows (also in the plan), without jumping.
  const follow = (iso: string) => {
    const shown = Number(iso.slice(0, 4))
    setShownYear(shown)
    if (shown !== reported.current && shown >= FIRST_YEAR) {
      reported.current = shown
      onYearChange?.(shown)
    }
  }

  // Paging and Heute: to that week, over the turn of the year as well, not before 2026.
  const go = (iso: string) => {
    const day = iso < start ? start : iso
    if (!inRange(day)) {
      // Beyond the loaded years: the year after is loaded first.
      scrollTo.current = mondayOf(day)
      reported.current = Number(day.slice(0, 4))
      onYearChange?.(reported.current)
      return
    }
    scrollToWeek(day === today ? today : mondayOf(day))
    follow(mondayOf(day))
  }
  // The logo: today right at the top.
  useWindowEvent(HOME_EVENT, () => go(today))

  const swipe = useSwipe(
    () => go(addDays(inView, 7)),
    () => go(addDays(inView, -7)),
  )

  // Another year chosen (here or in the plan): to its week of today, else its first week.
  useEffect(() => {
    if (year === reported.current) return
    reported.current = year
    setShownYear(year)
    const target = firstDayOf(year)
    if (loaded) scrollToWeek(target)
    else scrollTo.current = target
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a year chosen from outside moves the list
  }, [year])

  // Opened at today: the year of today is the chosen one again (in the plan as well).
  useEffect(() => {
    const current = Number(today.slice(0, 4))
    if (!opensToday || year === current) return
    reported.current = current
    onYearChange?.(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, [])

  // Once the days are there: to the week asked for.
  useLayoutEffect(() => {
    if (!loaded || !scrollTo.current) return
    const target = scrollTo.current
    scrollTo.current = null
    scrollToWeek(target)
  })

  // While scrolling: the last week whose start has passed below the head is the one in view.
  useEffect(() => {
    if (!loaded) return
    const onScroll = () => {
      const line = (headRef.current?.getBoundingClientRect().bottom ?? 0) + 12
      let current: string | null = null
      for (const section of listRef.current?.querySelectorAll<HTMLElement>('[data-week]') ?? []) {
        if (section.getBoundingClientRect().top <= line) current = section.dataset.week ?? null
        else break
      }
      if (current) setInView(current)
      // The first day not yet gone under the head gives the year.
      for (const day of listRef.current?.querySelectorAll<HTMLElement>('[data-day]') ?? []) {
        if (day.getBoundingClientRect().bottom > line - 12) {
          followRef.current(day.dataset.day!)
          break
        }
      }
    }
    // At most once a frame: a phone fires scroll events much more often than it draws.
    let frame = 0
    const onScrollFrame = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        onScroll()
      })
    }
    document.addEventListener('scroll', onScrollFrame, true)
    return () => {
      document.removeEventListener('scroll', onScrollFrame, true)
      cancelAnimationFrame(frame)
    }
  }, [loaded])
  const followRef = useRef(follow)
  useEffect(() => {
    followRef.current = follow
  })

  const siteById = useMemo(() => new Map((plan?.sites ?? []).map((site) => [site.id, site])), [plan])

  if (error) return <p className="error page">{error}</p>
  if (!plan) return null

  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const shownWeek = inView
  const shownDays = weekOf(shownWeek).filter((day) => inRange(day.iso))

  return (
    <div className="page my-plan" {...swipe}>
      {/* Stays on top while the weeks scroll by. The vacation is counted under Mein Bereich. */}
      <div className="my-plan-head" ref={headRef}>
      <Group justify="space-between" align="center" mb={4} wrap="nowrap">
        <Title order={2}>Mein Plan</Title>
        {onYearChange && (
          <YearPicker
            year={shownYear}
            years={[...PLAN_YEARS, shownYear].filter((y) => y >= FIRST_YEAR)}
            onChange={onYearChange}
          />
        )}
      </Group>

      <Group gap="xs" mt="sm" wrap="nowrap">
        <ActionIcon variant="default" size="lg" onClick={() => go(addDays(shownWeek, -7))} aria-label="Vorherige Woche">
          ‹
        </ActionIcon>
        <Text fw={700} c="wego.9" ta="center" style={{ flex: 1, lineHeight: 1.2 }} aria-live="polite">
          <span className="kw">KW {isoWeek(shownWeek)}</span>
          <Text component="span" display="block" size="sm" fw={600}>
            {short(shownDays[0].iso)} – {short(shownDays[shownDays.length - 1].iso)}
            {shownDays[shownDays.length - 1].iso.slice(0, 4)}
          </Text>
        </Text>
        <ActionIcon variant="default" size="lg" onClick={() => go(addDays(shownWeek, 7))} aria-label="Nächste Woche">
          ›
        </ActionIcon>
        {inRange(today) && (
          <Button color="wegoRed.6" onClick={() => go(today)}>
            Heute
          </Button>
        )}
      </Group>
      </div>

      <div ref={listRef}>
      {weeks.map((monday) => (
        <section key={monday} data-week={monday} className="my-week" aria-label={`KW ${isoWeek(monday)}`}>
          <Text className="my-week-title kw">
            KW {isoWeek(monday)}
          </Text>
      <Stack gap="sm">
        {weekOf(monday).filter((day) => inRange(day.iso)).map((day) => {
          const holiday = holidayByDate.get(day.iso)
          // A public holiday is free: vacation entered on it (e.g. by a company closure) is no vacation.
          const publicHoliday = holiday?.kind === 'Feiertag' && holiday.startDate === holiday.endDate
          const entries = withFreeHalf((ownByDate.get(day.iso) ?? []).filter((entry) => !(publicHoliday && entry.type === 'Urlaub')))
          const born = birthdays.get(day.iso.slice(5))
          const notes = notesByDate.get(day.iso) ?? []
          // Empty weekends only take up space; today always shows, it is where the list begins.
          if (day.isWeekend && entries.length === 0 && notes.length === 0 && day.iso !== today && !born) return null

          return (
            <Paper
              component="article"
              withBorder
              radius="md"
              p="sm"
              key={day.iso}
              data-day={day.iso}
              className={day.iso === today ? 'my-day today' : 'my-day'}
            >
              {/* Date and holiday always on one line: a long name of the holiday ends in dots. */}
              <Group gap={6} mb={entries.length ? 'xs' : 0} wrap="nowrap" className="my-day-head">
                <Text fw={700} c="wego.9" className="my-day-date">
                  {formatDateLong(day.iso)}
                </Text>
                {day.iso === today && (
                  <Badge color="wego" size="sm" style={{ flex: 'none' }}>
                    Heute
                  </Badge>
                )}
                {holidayByDate.has(day.iso) && (
                  <Badge
                    size="sm"
                    miw={0}
                    color="green"
                    variant={holidayByDate.get(day.iso)!.kind === 'Feiertag' ? 'filled' : 'light'}
                  >
                    {holidayByDate.get(day.iso)!.name}
                  </Badge>
                )}
              </Group>

              {born?.mine && (
                <Text size="sm" fw={700} className="my-birthday">
                  <BirthdayIcon /> Mein Geburtstag
                </Text>
              )}
              {born && born.names.length > 0 && (
                <Text size="sm" fw={600} className="my-birthday">
                  <BirthdayIcon /> Geburtstag: {born.names.join(', ')}
                </Text>
              )}

              {/* The notes of the day, written out in full (no pointing on a phone). */}
              {notes.map((note) => (
                <div className="my-note" key={note.id}>
                  <span className="my-note-title">{note.title}</span>
                  {note.text && <span className="my-note-text">{note.text}</span>}
                </div>
              ))}

              {entries.length === 0 && notes.length === 0 && (
                <Text size="sm" c={publicHoliday ? 'green.8' : 'dimmed'} fw={publicHoliday ? 700 : undefined}>
                  {publicHoliday ? 'Gesetzlicher Feiertag' : 'nicht eingeplant'}
                </Text>
              )}

              <Stack gap="xs">
                {entries.map((entry) => {
                  if (entry.type !== 'Baustelle') {
                    return (
                      <div className="my-entry" key={entry.id} style={entryStyle(entry)}>
                        <span className="where">
                          <ActivityIcon type={entry.type} size={15} /> {entry.type}
                        </span>
                      </div>
                    )
                  }
                  // Free (the other half of the day): "verfügbar", in green, without site or colleagues.
                  if (isFree(entry)) {
                    return (
                      <div className="my-entry" key={entry.id} style={entryStyle(entry)}>
                        <span className="when">{formatDayTime(entry)}</span>
                        <span className="where">verfügbar</span>
                      </div>
                    )
                  }
                  const colleagues = colleaguesOf(entry)
                  const site = entry.siteId === null ? undefined : siteById.get(entry.siteId)
                  const address = site && formatAddress(site)
                  // A tap on the site opens all about it (address, way there, customer, own days).
                  const Tile = site ? UnstyledButton : 'div'
                  return (
                    <Tile
                      className={site ? 'my-entry my-entry-button' : 'my-entry'}
                      key={entry.id}
                      style={entryStyle(entry)}
                      {...(site ? { onClick: () => setDetails(entry), 'aria-label': `${entry.siteName}: Details öffnen` } : {})}
                    >
                      {site && (
                        <span className="my-entry-more" aria-hidden>
                          ›
                        </span>
                      )}
                      <span className="when">{formatDayTime(entry)}</span>
                      <span className="where">
                        <SiteName name={entry.siteName ?? ''} />
                      </span>
                      {/* A service call: what is to do there, in place of the activity. */}
                      {site?.isService ? (
                        site.description && <span className="what">{site.description}</span>
                      ) : entry.activity && (
                        <span className="what">
                          <ActivityIcon activity={entry.activity} size={13} /> {activityLabel(entry.activity)}
                        </span>
                      )}
                      {address && <span className="detail">{address}</span>}
                      {entry.note && (
                        <span className={entry.noteImportant ? 'detail important' : 'detail'}>
                          {entry.noteImportant && <strong className="important-mark">! </strong>}
                          {entry.note}
                        </span>
                      )}
                      <span className="detail">
                        {colleagues.length > 0 ? `mit ${colleagues.join(', ')}` : 'allein'}
                      </span>
                    </Tile>
                  )
                })}
              </Stack>
            </Paper>
          )
        })}
      </Stack>
        </section>
      ))}
      </div>

      {details && details.siteId !== null && siteById.has(details.siteId) && (
        <MySiteDetails
          entry={details}
          site={siteById.get(details.siteId)!}
          plan={plan}
          employeeId={user.id}
          colleagues={colleaguesOf(details)}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  )
}