import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Shades around the teal of www.wego-badcenter.de (#007c87 is shade 6, #004b50 shade 9).
const wego: MantineColorsTuple = [
  '#e3f6f7',
  '#c6eaed',
  '#9fd9de',
  '#73c6cd',
  '#4fb3bc',
  '#2d9fa9',
  '#007c87',
  '#006a73',
  '#00575e',
  '#004b50',
]

export const theme = createTheme({
  primaryColor: 'wego',
  primaryShade: 6,
  colors: { wego },
  fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "'europa', 'Segoe UI', system-ui, sans-serif" },
  defaultRadius: 'sm',
  cursorType: 'pointer',
})
