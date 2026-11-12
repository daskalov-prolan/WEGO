import { ActionIcon, Tooltip } from '@mantine/core'

/** The button for Vollbild: four corners out, or in while it is on. */
export function FullViewButton({ full, onToggle, what }: { full: boolean; onToggle: () => void; what: string }) {
  return (
    <Tooltip label={full ? 'Kopf und Menü wieder zeigen (Esc)' : `Nur ${what} zeigen, über den ganzen Bildschirm (z. B. am Smartboard)`}>
      <ActionIcon
        variant={full ? 'filled' : 'default'}
        size="input-sm"
        onClick={onToggle}
        aria-label={full ? 'Vollbild beenden' : 'Vollbild'}
        aria-pressed={full}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          {full ? (
            <path d="M6 1.5V6H1.5M10 1.5V6h4.5M6 14.5V10H1.5M10 14.5V10h4.5" />
          ) : (
            <path d="M1.5 6V1.5H6M10 1.5h4.5V6M1.5 10v4.5H6M14.5 10v4.5H10" />
          )}
        </svg>
      </ActionIcon>
    </Tooltip>
  )
}
