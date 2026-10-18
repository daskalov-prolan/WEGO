import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { Notifications } from '@mantine/notifications'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { theme } from './theme'

/** Renders like main.tsx does: with the Mantine theme, date settings and notifications. */
export function renderWithProviders(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MantineProvider theme={theme}>
        <DatesProvider settings={{ locale: 'de', firstDayOfWeek: 1 }}>
          <Notifications />
          {children}
        </DatesProvider>
      </MantineProvider>
    ),
  })
}
