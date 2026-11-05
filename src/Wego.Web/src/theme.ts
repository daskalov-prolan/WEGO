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

// The signal red of the WEGO logo, the one red of the whole app: every shade is the same, so that no other red
// appears (also where Mantine's own red is asked for).
const wegoRed: MantineColorsTuple = Array(10).fill('#d71f27') as unknown as MantineColorsTuple

export const theme = createTheme({
  primaryColor: 'wego',
  primaryShade: 7,
  colors: { wego, wegoRed, red: wegoRed },
  fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif" },
  defaultRadius: 'md',
  cursorType: 'pointer',
})
