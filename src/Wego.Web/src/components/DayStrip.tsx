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
        KW {isoWeek(visible)} · ab {visible.slice(8, 10)}.{visible.slice(5, 7)}.
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

/** Head of a day column; Mondays carry the calendar week and how full it is. */
function DayHead({ day, today, mark, markTitle }: { day: Day; today: string; mark: (monday: string) => string; markTitle: string }) {
  return (
    <div
      id={`mini-${day.iso}`}
      className={['mini-day', 'mini-day-head', day.isWeekend ? 'weekend' : '', day.iso === today ? 'today' : ''].join(' ')}
    >
      <span className="mini-week-mark" title={markTitle}>
        {day.weekday === 'Mo' ? `KW ${isoWeek(day.iso)} · ${mark(day.iso)}` : ' '}
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
  mark,
  markTitle,
  className,
  children,
}: {
  strip: DayStrip
  today: string
  corner: ReactNode
  /** Shown next to the calendar week on Mondays, e.g. how full the week is. */
  mark: (monday: string) => string
  markTitle: string
  className?: string
  children: ReactNode
}) {
  const { scroller: scrollerRef, onScroll } = strip
  return (
    <div className={className ? `mini-scroll ${className}` : 'mini-scroll'} ref={scrollerRef} onScroll={onScroll}>
      <div
        className="mini-lanes"
        style={{
          gridTemplateColumns: `var(--lane-name) ${strip.days.map((day) => (day.isWeekend ? 'var(--weekend)' : 'var(--day)')).join(' ')}`,
        }}
      >
        <div className="mini-corner">{corner}</div>
        {strip.days.map((day) => (
          <Fragment key={day.iso}>
            <DayHead day={day} today={today} mark={mark} markTitle={markTitle} />
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
  children: ReactNode
}

/** One day of a lane; planners drop entries and open activities on it. */
export function LaneCell({ day, label, onOpen, canEdit, accepts, onDropItem, children }: LaneCellProps) {
  return (
    <button
      type="button"
      className={day.isWeekend ? 'mini-cell weekend' : 'mini-cell'}
      aria-label={label}
      onClick={onOpen}
      {...dropTarget(accepts, onDropItem, canEdit)}
    >
      {children}
    </button>
  )
}
