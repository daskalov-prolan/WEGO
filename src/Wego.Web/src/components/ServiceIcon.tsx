/**
 * The sign of a service call: an open-end wrench standing upright (a round head with its jaw open at the top,
 * a long handle), filled in white and outlined in the colour of the text, so it shows on every entry.
 */
export function ServiceIcon({ size = '1.3em' }: { size?: number | string }) {
  return (
    <svg
      className="service-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#fff"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
      role="img"
      aria-label="Serviceauftrag"
    >
      <path d="M10.5 1.71A5.5 5.5 0 0 0 10.2 12.2V20.5A1.8 1.8 0 0 0 13.8 20.5V12.2A5.5 5.5 0 0 0 13.5 1.71V6.5A1.5 1.5 0 0 1 10.5 6.5Z" />
    </svg>
  )
}
