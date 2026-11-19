/**
 * The sign of a service call, filled in white and outlined in black, so it shows on every entry (on the white
 * writing of a dark entry too): an open-end wrench standing upright (a round head with its jaw open at the top, a
 * long handle), or for tiling work four tiles, as small as the writing (the sign of the Fliesenarbeiten).
 */
export function ServiceIcon({ size, tool = 'wrench' }: { size?: number | string; tool?: 'wrench' | 'tiles' }) {
  const tiles = tool === 'tiles'
  return (
    <svg
      className="service-icon"
      width={size ?? (tiles ? '0.95em' : '1.3em')}
      height={size ?? (tiles ? '0.95em' : '1.3em')}
      viewBox={tiles ? '0 0 16 16' : '0 0 24 24'}
      fill="#fff"
      stroke="#14232a"
      strokeWidth={tiles ? 1.4 : 1.3}
      strokeLinejoin="round"
      role="img"
      aria-label="Serviceauftrag"
    >
      {tiles ? (
        <>
          <rect x="1.5" y="1.5" width="5.8" height="5.8" rx="0.6" />
          <rect x="8.7" y="1.5" width="5.8" height="5.8" rx="0.6" />
          <rect x="1.5" y="8.7" width="5.8" height="5.8" rx="0.6" />
          <rect x="8.7" y="8.7" width="5.8" height="5.8" rx="0.6" />
        </>
      ) : (
        <path d="M10.5 1.71A5.5 5.5 0 0 0 10.2 12.2V20.5A1.8 1.8 0 0 0 13.8 20.5V12.2A5.5 5.5 0 0 0 13.5 1.71V6.5A1.5 1.5 0 0 1 10.5 6.5Z" />
      )}
    </svg>
  )
}
