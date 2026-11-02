import { Select } from '@mantine/core'
import { HALF_HOURS } from '../lib/dates'

interface Props {
  label: string
  /** "HH:MM", empty: none. */
  value: string
  onChange: (value: string) => void
  /** For the end of a time window: only times after the start are offered. */
  after?: string
}

/** A time chosen from the full and half hours. */
export function TimeSelect({ label, value, onChange, after }: Props) {
  const offered = after ? HALF_HOURS.filter((time) => time > after) : HALF_HOURS
  // A time from before (e.g. 08:15) stays visible and selected.
  const data = value && !offered.includes(value) ? [...offered, value].sort() : offered
  return (
    <Select
      label={label}
      placeholder="–"
      data={data}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
      clearable
      searchable
      comboboxProps={{ withinPortal: true }}
    />
  )
}
