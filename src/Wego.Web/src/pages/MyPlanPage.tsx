import { useEffect, useMemo, useState } from 'react'
import { api, messageOf } from '../api/client'
import type { Entry, Plan, User, Vacation } from '../api/types'
import { SiteLocation } from '../components/SiteLocation'
import { addDays, daysBetween, formatDateLong, formatTimeRange, todayIso, weekOf } from '../lib/dates'

interface Props {
  year: number
  user: User
}

/**
 * What a craftsman needs: their own week. For every day where they have to be, when, and who else
 * is on the same construction site that day.
 */
export function MyPlanPage({ year, user }: Props) {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const today = todayIso()
  const inYear = (iso: string) => iso >= first && iso <= last

  const [plan, setPlan] = useState<Plan | null>(null)
  const [vacation, setVacation] = useState<Vacation | null>(null)
  const [error, setError] = useState('')
  const [anchor, setAnchor] = useState(inYear(today) ? today : first)

  useEffect(() => {
    api.plan(year).then(setPlan, (e) => setError(messageOf(e)))
    api.employeeReport(user.id, year).then((report) => setVacation(report.vacation), () => setVacation(null))
  }, [year, user.id])

  const ownByDate = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const entry of plan?.entries ?? []) {
      if (entry.employeeId !== user.id) continue
      const list = map.get(entry.date)
      if (list) list.push(entry)
      else map.set(entry.date, [entry])
    }
    return map
  }, [plan, user.id])

  // Everybody else on the same site on the same day, with their time window if they have one.
  const colleaguesOf = (entry: Entry) =>
    (plan?.entries ?? [])
      .filter(
        (other) =>
          other.employeeId !== user.id &&
          other.date === entry.date &&
          other.customerId !== null &&
          other.customerId === entry.customerId,
      )
      .map((other) => {
        const time = formatTimeRange(other)
        return time ? `${other.employeeName} (${time})` : other.employeeName
      })

  const holidayByDate = useMemo(() => {
    const map = new Map<string, string>()
    for (const holiday of plan?.schoolHolidays ?? []) {
      for (const day of daysBetween(holiday.startDate, holiday.endDate)) map.set(day.iso, holiday.name)
    }
    return map
  }, [plan])

  const siteById = useMemo(() => new Map((plan?.customers ?? []).map((site) => [site.id, site])), [plan])

  if (error) return <p className="error page">{error}</p>
  if (!plan || plan.year !== year) return null

  const week = weekOf(anchor).filter((day) => inYear(day.iso))
  const go = (iso: string) => setAnchor(iso < first ? first : iso > last ? last : iso)
  const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`

  return (
    <div className="page my-plan">
      <h1>Mein Plan</h1>

      {vacation && (
        <p className="my-vacation">
          Urlaub {year}: <strong>{vacation.remaining}</strong> von {vacation.entitlement} Tagen noch verfügbar
        </p>
      )}

      <div className="mplan-nav">
        <button type="button" className="btn" onClick={() => go(addDays(anchor, -7))} aria-label="Vorherige Woche">
          ‹
        </button>
        <span className="my-week">
          {short(week[0].iso)} – {short(week[week.length - 1].iso)}
          {year}
        </span>
        <button type="button" className="btn" onClick={() => go(addDays(anchor, 7))} aria-label="Nächste Woche">
          ›
        </button>
        {inYear(today) && (
          <button type="button" className="btn" onClick={() => setAnchor(today)}>
            Heute
          </button>
        )}
      </div>

      <div className="my-days">
        {week.map((day) => {
          const entries = ownByDate.get(day.iso) ?? []
          const className = ['mcard', day.iso === today ? 'highlighted' : '', day.isWeekend ? 'weekend' : '']
            .filter(Boolean)
            .join(' ')
          // Empty weekends only take up space.
          if (day.isWeekend && entries.length === 0) return null

          return (
            <section className={className} key={day.iso}>
              <span className="mcard-title">
                {formatDateLong(day.iso)}
                {day.iso === today && <span className="badge-today">Heute</span>}
                {holidayByDate.has(day.iso) && <span className="badge-holiday">{holidayByDate.get(day.iso)}</span>}
              </span>

              {entries.length === 0 && <span className="mcard-empty">nicht eingeplant</span>}

              {entries.map((entry) => {
                if (entry.type !== 'Baustelle') {
                  return (
                    <div className={`my-entry my-entry-${entry.type.toLowerCase()}`} key={entry.id}>
                      <span className="where">{entry.type}</span>
                    </div>
                  )
                }
                const colleagues = colleaguesOf(entry)
                const site = entry.customerId === null ? undefined : siteById.get(entry.customerId)
                return (
                  <div className="my-entry" key={entry.id}>
                    <span className="when">{formatTimeRange(entry) || 'ganztägig'}</span>
                    <span className="where">{entry.customerName}</span>
                    {site?.location && <SiteLocation location={site.location} />}
                    {site?.description && <span className="detail">{site.description}</span>}
                    {entry.note && <span className="detail">{entry.note}</span>}
                    <span className="detail">{colleagues.length > 0 ? `mit ${colleagues.join(', ')}` : 'allein'}</span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
