import { ActionIcon, Button, Group, Text, Tooltip } from '@mantine/core'
import { Fragment, type ReactNode } from 'react'
import { addDays, isoWeek, weekOf, type Day } from '../lib/dates'
import { dropTarget, type DragItem } from '../lib/dragPlan'
import type { DayStrip } from '../lib/useDayStrip'

const pad = (n: number) => String(n).padStart(2, '0')

/** Arrows with the week in view, "Heute", whatever the caller adds, and the jump to the next free week. */
export function StripNav({
  strip,
  today,
  children,
  nextFree,
  nextFreeHint,
}: {
  strip: DayStrip
  today: string
  children?: ReactNode
  /** Monday of the next free week after the one in view, if there is one. */
  nextFree: string | null
  nextFreeHint: string
}) {
  const { visible, go } = strip
  return (
    <Group gap={6}>
      <ActionIcon variant="default" onClick={() => go(addDays(visible, -7))} aria-label="Woche zurück">
        ‹
      </ActionIcon>
      <Text size="sm" fw={700} c="wego.9">
        <span className="kw">KW {isoWeek(visible)}</span> · ab {visible.slice(8, 10)}.{visible.slice(5, 7)}.
      </Text>
      <ActionIcon variant="default" onClick={() => go(addDays(visible, 7))} aria-label="Woche vor">
        ›
      </ActionIcon>
      {children}
      <Button size="compact-sm" variant="default" onClick={() => go(weekOf(today)[0].iso)}>
        Heute
      </Button>
      <Tooltip label={nextFreeHint} multiline w={260}>
        <Button size="compact-sm" variant="light" disabled={!nextFree} onClick={() => nextFree && go(nextFree)}>
          Nächste freie Woche ›
        </Button>
      </Tooltip>
    </Group>
  )
}

/** Head of a day column; Mondays carry the calendar week. */
function DayHead({ day, today, narrow }: { day: Day; today: string; narrow: boolean }) {
  return (
    <div
      id={`mini-${day.iso}`}
      className={['mini-day', 'mini-day-head', day.isWeekend ? 'weekend' : '', narrow ? 'narrow' : '', day.iso === today ? 'today' : ''].join(' ')}
      title={narrow ? `${day.weekday} ${pad(day.dayOfMonth)}.${pad(day.month + 1)}.: hier nichts geplant, alle anderswo` : undefined}
    >
      <span className="mini-week-mark">
        {day.weekday === 'Mo' ? <span className="kw">KW {isoWeek(day.iso)}</span> :' '}
      </span>
      <span className="wd">{day.weekday}</span>
      {!day.isWeekend && (
        <span className="num">
          {' '}
          {pad(day.dayOfMonth)}.{pad(day.month + 1)}
        </span>
      )}
    </div>
  )
}

/**
 * The grid of the strip: a fixed column of names, the days as columns (weekends narrow), one lane per
 * child row (a name cell and one LaneCell per day).
 */
export function StripGrid({
  strip,
  today,
  corner,
  className,
  narrow = () => false,
  children,
}: {
  strip: DayStrip
  today: string
  corner: ReactNode
  className?: string
  /** Working days of no interest here: narrow like the weekends, so that more days fit. */
  narrow?: (day: Day) => boolean
  children: ReactNode
}) {
  const { scroller: scrollerRef, onScroll } = strip
  return (
    <div className={className ? `mini-scroll ${className}` : 'mini-scroll'} ref={scrollerRef} onScroll={onScroll}>
      <div
        className="mini-lanes"
        style={{
          gridTemplateColumns: `var(--lane-name) ${strip.days
            .map((day) => (day.isWeekend ? 'var(--weekend)' : narrow(day) ? 'var(--narrow)' : 'var(--day)'))
            .join(' ')}`,
        }}
      >
        <div className="mini-corner">{corner}</div>
        {strip.days.map((day) => (
          <Fragment key={day.iso}>
            <DayHead day={day} today={today} narrow={!day.isWeekend && narrow(day)} />
          </Fragment>
        ))}
        {children}
      </div>
    </div>
  )
}

interface LaneCellProps {
  day: Day
  label: string
  onOpen: () => void
  canEdit: boolean
  accepts: (item: DragItem) => boolean
  onDropItem: (item: DragItem) => void
  /** A narrow day (see StripGrid): only the colours of what is there. */
  narrow?: boolean
  children: ReactNode
}

/** One day of a lane; planners drop entries and open activities on it. */
export function LaneCell({ day, label, onOpen, canEdit, accepts, onDropItem, narrow = false, children }: LaneCellProps) {
  return (
    <button
      type="button"
      className={['mini-cell', day.isWeekend ? 'weekend' : '', narrow ? 'narrow' : ''].filter(Boolean).join(' ')}
      aria-label={label}
      onClick={onOpen}
      {...dropTarget(accepts, onDropItem, canEdit)}
    >
      {children}
    </button>
  )
}
