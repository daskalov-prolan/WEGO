import { createTheme, type MantineColorsTuple } from '@mantine/core'

// The dark petrol of the WEGO vans (#0f6378 is shade 7, #08394a shade 9).
const wego: MantineColorsTuple = [
  '#e7f2f5',
  '#c8e1e8',
  '#a2cbd7',
  '#77b2c3',
  '#4f98ae',
  '#2f8199',
  '#1a7088',
  '#0f6378',
  '#0b4d5e',
  '#08394a',
]

// The red of the WEGO logo (#d71f27 is shade 6), for accents.
const wegoRed: MantineColorsTuple = [
  '#fdebec',
  '#f9d0d2',
  '#f2a3a7',
  '#ea7379',
  '#e34b52',
  '#df333b',
  '#d71f27',
  '#bd1920',
  '#a3141a',
  '#880f14',
]

export const theme = createTheme({
  primaryColor: 'wego',
  primaryShade: 7,
  colors: { wego, wegoRed },
  fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif" },
  defaultRadius: 'md',
  cursorType: 'pointer',
})
