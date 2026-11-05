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
        <DatesProvider settings={{ locale: 'de', firstDayOfWeek: 1, consistentWeeks: true }}>
          <Notifications />
          {children}
        </DatesProvider>
      </MantineProvider>
    ),
  })
}

/** Finds a text also when parts of it stand in elements of their own (e.g. the red "KW 10" in "KW 10 · ab 02.03."). */
export const byText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text && ![...element.children].some((child) => child.textContent === text)
