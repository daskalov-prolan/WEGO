import type {
  Access,
  Activity,
  ActivityDef,
  ActivityInput,
  CalendarNote,
  CalendarNoteInput,
  DayEntryInput,
  Employee,
  EmployeeInput,
  EmployeeOverview,
  EmployeeReport,
  MyVacation,
  EmployeeVacation,
  Entry,
  HolidayKind,
  NamedItem,
  Offers,
  Plan,
  Planner,
  SchoolHoliday,
  Site,
  SiteHourlyRate,
  SiteInput,
  SiteMapLocation,
  SiteMapLocations,
  SiteReport,
  SiteStatus,
  StatusChange,
  StepInput,
  User,
  Vacation,
} from './types'

export const UNAUTHORIZED_EVENT = 'wego:unauthorized'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })

  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(response.status, await errorMessage(response))
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.message === 'string') return data.message
    if (typeof data?.detail === 'string') return data.detail
  } catch {
    // no JSON body
  }
  if (response.status === 403) return 'Dafür fehlt Ihnen die Berechtigung.'
  if (response.status === 429) return 'Zu viele Versuche. Bitte warten Sie einen Moment.'
  return `Die Anfrage ist fehlgeschlagen (${response.status}).`
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler.'
}

export const api = {
  me: () => request<User>('GET', '/api/auth/me'),
  login: (userName: string, password: string) => request<User>('POST', '/api/auth/login', { userName, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/api/auth/password', { currentPassword, newPassword }),

  plan: (year: number) => request<Plan>('GET', `/api/plan?year=${year}`),
  saveDay: (employeeId: number, date: string, entries: DayEntryInput[]) =>
    request<Entry[]>('PUT', `/api/plan/${employeeId}/${date}`, entries),
  /** Replaces the entries of several employee days in one transaction. */
  saveDays: (days: { employeeId: number; date: string; entries: DayEntryInput[] }[]) =>
    request<Entry[]>('PUT', '/api/plan/batch', days),
  createNote: (input: CalendarNoteInput) => request<CalendarNote>('POST', '/api/plan/notes', input),
  updateNote: (id: number, input: CalendarNoteInput) => request<CalendarNote>('PUT', `/api/plan/notes/${id}`, input),
  deleteNote: (id: number) => request<void>('DELETE', `/api/plan/notes/${id}`),

  sites: () => request<Site[]>('GET', '/api/sites'),
  /** The places of the sites for the map; a few addresses more are looked up with every call. */
  siteLocations: () => request<SiteMapLocations>('GET', '/api/sites/locations'),
  siteLocation: (id: number) => request<SiteMapLocation>('GET', `/api/sites/${id}/location`),
  planners: () => request<Planner[]>('GET', '/api/sites/planners'),
  /** The town of a postal code, in Berlin with the borough ("Berlin-Pankow"). */
  postalCode: (code: string, street: string | null) =>
    request<{ postalCode: string; city: string }>(
      'GET',
      `/api/postal-codes/${code}${street ? `?street=${encodeURIComponent(street)}` : ''}`,
    ),
  createSite: (input: SiteInput) => request<Site>('POST', '/api/sites', input),
  updateSite: (id: number, input: SiteInput) => request<Site>('PUT', `/api/sites/${id}`, input),
  /** Moves the entries of a duplicate to the remaining site and deletes the duplicate. */
  mergeSite: (id: number, targetId: number) => request<Site>('POST', `/api/sites/${id}/merge`, { targetId }),
  deleteSite: (id: number, withEntries = false) =>
    request<void>('DELETE', `/api/sites/${id}${withEntries ? '?withEntries=true' : ''}`),
  changeSiteStatus: (id: number, status: SiteStatus) => request<Site>('POST', `/api/sites/${id}/status`, { status }),
  /** The customer confirmed the appointment: a service call or a site in the Bauphase. */
  confirmSite: (id: number, asService: boolean) => request<Site>('POST', `/api/sites/${id}/confirm`, { asService }),
  updateSiteTask: (id: number, activity: Activity, estimatedDays: number, notNeeded: boolean) =>
    request<Site>('PUT', `/api/sites/${id}/tasks/${activity}`, { estimatedDays, notNeeded }),
  /** The offer phase: the enquiries with their steps, and the sites decided lately. */
  offers: () => request<Offers>('GET', '/api/offers'),
  /** Plans the step (in its order; planned again, it moves) and gives the offers anew. */
  planOfferStep: (siteId: number, input: StepInput) => request<Offers>('POST', `/api/offers/${siteId}/steps`, input),
  acceptOffer: (siteId: number, plannedStart: string) => request<Offers>('POST', `/api/offers/${siteId}/accept`, { plannedStart }),
  declineOffer: (siteId: number, reason: string, note: string | null) =>
    request<Offers>('POST', `/api/offers/${siteId}/decline`, { reason, note }),
  reopenOffer: (siteId: number) => request<Offers>('POST', `/api/offers/${siteId}/reopen`),
  siteHistory: (id: number) => request<StatusChange[]>('GET', `/api/sites/${id}/history`),

  /** One year, or without it the whole time of the site. */
  siteReport: (id: number, year?: number) =>
    request<SiteReport>('GET', `/api/reports/sites/${id}${year === undefined ? '' : `?year=${year}`}`),
  employeeReport: (id: number, year: number) =>
    request<EmployeeReport>('GET', `/api/reports/employees/${id}?year=${year}`),
  myVacation: (year: number) => request<MyVacation>('GET', `/api/me/vacation?year=${year}`),
  teamVacation: (year: number) => request<EmployeeVacation[]>('GET', `/api/vacation?year=${year}`),
  vacationOverview: (year: number) => request<Vacation[]>('GET', `/api/reports/vacation?year=${year}`),

  employeeNames: () => request<NamedItem[]>('GET', '/api/employees/names'),
  employees: () => request<Employee[]>('GET', '/api/employees'),
  employeesOverview: () => request<EmployeeOverview[]>('GET', '/api/employees/overview'),
  createEmployee: (input: EmployeeInput) => request<Employee>('POST', '/api/employees', input),
  updateEmployee: (id: number, input: EmployeeInput) => request<Employee>('PUT', `/api/employees/${id}`, input),
  deleteEmployee: (id: number) => request<void>('DELETE', `/api/employees/${id}`),
  deleteEmployeePermanently: (id: number) => request<void>('DELETE', `/api/employees/${id}/permanently`),
  siteHourlyRates: (siteId: number) => request<SiteHourlyRate[]>('GET', `/api/sites/${siteId}/hourly-rates`),
  /** The wage of an employee on this site only; null goes back to the usual one. */
  setSiteHourlyRate: (siteId: number, employeeId: number, hourlyRate: number | null) =>
    request<SiteHourlyRate[]>('PUT', `/api/sites/${siteId}/hourly-rates/${employeeId}`, { hourlyRate }),

  createAccess: (id: number) => request<Access>('POST', `/api/employees/${id}/access`),

  activities: () => request<ActivityDef[]>('GET', '/api/activities'),
  createActivity: (input: ActivityInput) => request<ActivityDef>('POST', '/api/activities', input),
  updateActivity: (key: Activity, input: ActivityInput) => request<ActivityDef>('PUT', `/api/activities/${key}`, input),
  /** All activities as their keys, from first to last. */
  orderActivities: (keys: Activity[]) => request<ActivityDef[]>('PUT', '/api/activities/order', keys),
  activityUsage: (key: Activity) =>
    request<{ entries: number; employees: number; sites: number }>('GET', `/api/activities/${key}/usage`),
  deleteActivity: (key: Activity) => request<void>('DELETE', `/api/activities/${key}`),

  addSchoolHoliday:(name: string, startDate: string, endDate: string, kind: HolidayKind) =>
    request<SchoolHoliday>('POST', '/api/schoolholidays', { name, startDate, endDate, kind }),
  updateSchoolHoliday: (id: number, name: string, startDate: string, endDate: string, kind: HolidayKind) =>
    request<SchoolHoliday>('PUT', `/api/schoolholidays/${id}`, { name, startDate, endDate, kind }),
  deleteSchoolHoliday: (id: number) => request<void>('DELETE', `/api/schoolholidays/${id}`),
  importSchoolHolidays: (year: number) =>
    request<{ imported: number; total: number }>('POST', `/api/schoolholidays/import?year=${year}`),
}
