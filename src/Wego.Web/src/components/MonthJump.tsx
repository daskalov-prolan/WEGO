import { ActionIcon, Popover, UnstyledButton } from '@mantine/core'
import { useState, type ReactNode } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/**
 * The time in view as a button: a click opens the year with its twelve months, and a month takes the plan to
 * its first day (another year opens that year).
 */
export function MonthJump({
  title,
  year,
  years,
  today,
  onJump,
}: {
  title: ReactNode
  year: number
  /** The years that can be chosen. */
  years: number[]
  /** yyyy-MM-dd */
  today: string
  onJump: (iso: string) => void
}) {
  const [opened, setOpened] = useState(false)
  const [shown, setShown] = useState(year)
  const min = Math.min(...years)
  const max = Math.max(...years)
  const nowYear = Number(today.slice(0, 4))
  const nowMonth = Number(today.slice(5, 7)) - 1
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom"
      width="target"
      offset={6}
      shadow="md"
      withinPortal
      onOpen={() => setShown(year)}
    >
      <Popover.Target>
        <UnstyledButton
          className="plan-title plan-title-button"
          aria-label="Zu Monat oder Jahr springen"
          aria-expanded={opened}
          onClick={() => {
            setShown(year)
            setOpened((o) => !o)
          }}
        >
          <span className="plan-title-text">{title}</span>
          <span className="plan-title-caret" aria-hidden>
            ▾
          </span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className="month-jump">
        <div className="month-jump-year">
          <ActionIcon variant="default" aria-label="Jahr zurück" disabled={shown <= min} onClick={() => setShown(shown - 1)}>
            ‹
          </ActionIcon>
          <span>{shown}</span>
          <ActionIcon variant="default" aria-label="Jahr weiter" disabled={shown >= max} onClick={() => setShown(shown + 1)}>
            ›
          </ActionIcon>
        </div>
        <div className="month-jump-months">
          {MONTHS.map((label, index) => (
            <button
              key={label}
              type="button"
              className={shown === nowYear && index === nowMonth ? 'now' : undefined}
              onClick={() => {
                setOpened(false)
                onJump(`${shown}-${String(index + 1).padStart(2, '0')}-01`)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
