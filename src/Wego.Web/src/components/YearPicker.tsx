import { NativeSelect, UnstyledButton } from '@mantine/core'

interface Props {
  year: number
  /** The years to choose from, in any order. */
  years: number[]
  onChange: (year: number) => void
  size?: 'xs' | 'sm'
  w?: number
  className?: string
}

/**
 * The year: a tap on the number opens the list, the arrows at the right go one year on or back at once.
 */
export function YearPicker({ year, years, onChange, size = 'sm', w = 104, className }: Props) {
  const sorted = [...new Set(years)].sort((a, b) => a - b)
  const next = sorted.find((candidate) => candidate > year)
  const previous = [...sorted].reverse().find((candidate) => candidate < year)
  return (
    <NativeSelect
      aria-label="Jahr"
      size={size}
      w={w}
      className={className}
      value={String(year)}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      data={sorted.map(String)}
      rightSectionPointerEvents="all"
      rightSectionWidth={26}
      rightSection={
        <span className="year-steps">
          <UnstyledButton
            className="year-step"
            aria-label="Voriges Jahr"
            disabled={previous === undefined}
            onClick={() => previous !== undefined && onChange(previous)}
          >
            ▴
          </UnstyledButton>
          <UnstyledButton
            className="year-step"
            aria-label="Nächstes Jahr"
            disabled={next === undefined}
            onClick={() => next !== undefined && onChange(next)}
          >
            ▾
          </UnstyledButton>
        </span>
      }
    />
  )
}
