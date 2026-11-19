import { Select } from '@mantine/core'
import { HALF_HOURS, QUARTER_HOURS } from '../lib/dates'

interface Props {
  label: string
  /** "HH:MM", empty: none. */
  value: string
  onChange: (value: string) => void
  /** For the end of a time window: only times after the start are offered. */
  after?: string
  /** Every quarter hour (appointments), else the full and half hours (sites). */
  quarter?: boolean
  /** Without the cross to empty it (a time is needed). */
  required?: boolean
  /** The label only for screen readers (and tests), not shown: where the place is short. */
  hideLabel?: boolean
}

/** A time chosen from the full and half hours, or from every quarter hour. */
export function TimeSelect({ label, value, onChange, after, quarter = false, required = false, hideLabel = false }: Props) {
  const times = quarter ? QUARTER_HOURS : HALF_HOURS
  const offered = after ? times.filter((time) => time > after) : times
  // A time from before (e.g. 08:15) stays visible and selected.
  const data = value && !offered.includes(value) ? [...offered, value].sort() : offered
  return (
    <Select
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      placeholder={hideLabel ? label : '–'}
      data={data}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
      clearable={!required}
      searchable
      comboboxProps={{ withinPortal: true }}
    />
  )
}
