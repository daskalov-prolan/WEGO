import { api } from '../api/client'
import type { Activity, Employee, EmployeeInput } from '../api/types'

/** What the form and the API take for an employee; the password stays as it is. */
export function toEmployeeInput(employee: Employee): EmployeeInput {
  return {
    name: employee.name,
    sortOrder: employee.sortOrder,
    isActive: employee.isActive,
    showInPlan: employee.showInPlan,
    vacationDaysPerYear: employee.vacationDaysPerYear,
    userName: employee.userName,
    role: employee.role,
    password: null,
    mainActivity: employee.mainActivity,
    additionalActivities: employee.additionalActivities,
  }
}

/**
 * Suggests the activities of an employee from what they did in the plan: the most frequent one as main
 * activity, others done on at least three days as additional ones.
 */
export async function suggestActivities(employeeId: number, year: number) {
  const plan = await api.plan(year)
  const counts = new Map<Activity, number>()
  for (const entry of plan.entries) {
    if (entry.employeeId === employeeId && entry.activity) counts.set(entry.activity, (counts.get(entry.activity) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return {
    mainActivity: ranked[0]?.[0] ?? null,
    additionalActivities: ranked.slice(1).filter(([, days]) => days >= 3).map(([activity]) => activity),
  }
}
