import type { Employee, EmployeeInput } from '../api/types'

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
    hourlyRate: employee.hourlyRate ?? null,
    phone: employee.phone ?? null,
    birthDate: employee.birthDate ?? null,
    mainActivity: employee.mainActivity,
  }
}

