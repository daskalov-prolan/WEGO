import { Paper, Text } from '@mantine/core'
import type { ReactNode } from 'react'

/** A key figure: big number, short label. */
export function Stat({ value, label, negative = false }: { value: ReactNode; label: string; negative?: boolean }) {
  return (
    <Paper withBorder p="sm" radius="md" className="stat">
      <Text fz={26} fw={700} c={negative ? 'red.7' : 'wego.9'} lh={1.2}>
        {value}
      </Text>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Paper>
  )
}
