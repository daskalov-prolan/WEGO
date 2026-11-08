import { Paper, Text } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * A key figure: big number, short label. In the colours of WEGO, as in "Mein Bereich": turquoise for what there is,
 * red for what is used, the filled one for what is left.
 */
export function Stat({
  value,
  label,
  negative = false,
  tone = 'aqua',
}: {
  value: ReactNode
  label: string
  negative?: boolean
  tone?: 'aqua' | 'red' | 'filled'
}) {
  return (
    <Paper withBorder p="sm" radius="md" className={`stat stat-${tone}${negative ? ' stat-negative' : ''}`}>
      <Text fz={26} fw={700} c={negative ? 'red.7' : 'wego.9'} lh={1.2}>
        {value}
      </Text>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Paper>
  )
}
