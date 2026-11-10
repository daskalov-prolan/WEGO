/**
 * The sign of a service call, filled in white and outlined in black, so it shows on every entry (on the white
 * writing of a dark entry too): an open-end wrench standing upright (a round head with its jaw open at the top, a
 * long handle), or for tiling work a grout float (a long flat board seen a little from above, slightly tilted, its
 * grip on two short legs). The float is wider: drawn a bit larger, both look the same size.
 */
export function ServiceIcon({ size = '1.3em', tool = 'wrench' }: { size?: number | string; tool?: 'wrench' | 'float' }) {
  const float = tool === 'float'
  return (
    <svg
      className="service-icon"
      // The float lies flat: wider than high, cut to its own height.
      width={size}
      height={size}
      style={float ? { width: `calc(${typeof size === 'number' ? `${size}px` : size} * 1.23)` } : undefined}
      viewBox={float ? '0 2 24 19.5' : '0 0 24 24'}
      fill="#fff"
      stroke="#14232a"
      strokeWidth={1.3}
      strokeLinejoin="round"
      role="img"
      aria-label="Serviceauftrag"
    >
      {float ? (
        <g transform="rotate(-12 12 13)">
          {/* The grip: a thick bar with round ends on two short legs. */}
          <path d="M5 9A2 2 0 0 1 7 7H19A2 2 0 0 1 21 9V9.2A2 2 0 0 1 19.4 11.2V13.5H17V11.2H9V13.5H6.6V11.2A2 2 0 0 1 5 9.2Z" />
          {/* The board: its top seen from above, then its thickness. */}
          <path d="M3 13.5H22L23.5 15.5H1.5Z" />
          <rect x="1.5" y="15.5" width="22" height="3.6" rx="0.9" />
        </g>
      ) : (
        <path d="M10.5 1.71A5.5 5.5 0 0 0 10.2 12.2V20.5A1.8 1.8 0 0 0 13.8 20.5V12.2A5.5 5.5 0 0 0 13.5 1.71V6.5A1.5 1.5 0 0 1 10.5 6.5Z" />
      )}
    </svg>
  )
}
