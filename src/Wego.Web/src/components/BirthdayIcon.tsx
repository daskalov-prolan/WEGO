/** The sign of a birthday in the plan: a red present with a yellow ribbon and bow. */
export function BirthdayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M12 7C10 3 6.5 3.5 7 5.5S10.5 7 12 7C13.5 7 16.5 7.5 17 5.5S14 3 12 7Z"
        fill="#f2b705"
        stroke="#8a6400"
        strokeWidth="1"
      />
      <rect x="3.5" y="7" width="17" height="4.5" rx="1" fill="#e30613" stroke="#7a0008" strokeWidth="1" />
      <rect x="5" y="11.5" width="14" height="9.5" rx="1" fill="#e30613" stroke="#7a0008" strokeWidth="1" />
      <path d="M12 7V21" stroke="#f2b705" strokeWidth="2.6" />
    </svg>
  )
}
