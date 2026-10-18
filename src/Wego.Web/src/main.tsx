import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import './styles/app.css'
import 'dayjs/locale/de'

import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { Notifications } from '@mantine/notifications'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { theme } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'de', firstDayOfWeek: 1 }}>
        <Notifications position="bottom-center" />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
