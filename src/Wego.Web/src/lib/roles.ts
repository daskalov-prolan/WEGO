import type { Role } from '../api/types'

/** The rights in the words of the company, with what each may do. */
export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'Handwerker', label: 'Handwerker', description: 'nur lesen' },
  { value: 'PlanerA', label: 'Planer A', description: 'lesen und bearbeiten, ohne Mitarbeiter und Verwaltung' },
  { value: 'PlanerG', label: 'Planer G', description: 'alle Rechte' },
]

export const roleLabel = (role: Role) => ROLES.find((candidate) => candidate.value === role)?.label ?? role

/** Planer A and G change the plan and the sites. */
export const canPlanRole = (role: Role) => role === 'PlanerA' || role === 'PlanerG'
