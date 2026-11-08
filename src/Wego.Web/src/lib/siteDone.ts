import { notifications } from '@mantine/notifications'
import { api, messageOf } from '../api/client'
import type { Site } from '../api/types'
import { askPdfTarget, buildSitePdf, pdfFileName } from './sitePdf'

/** Planer A may not set a site to done, nor take it back: they are told who does. */
export const DONE_HINT = 'Baustellen setzt nur die Geschäftsleitung (Planer G) auf erledigt.'

export const showDoneHint = () => notifications.show({ color: 'orange', message: DONE_HINT, autoClose: 5000 })

/**
 * Planer G sets a site to done: asked first, then where the summary is saved as a PDF (everything of the page of
 * the site but its calendar). The question for the file cancelled, the site is done without a summary.
 * null: not done (the first question was answered with no).
 */
export async function finishSite(site: Site): Promise<Site | null> {
  if (!window.confirm(`„${site.name}“ auf erledigt setzen? Danach wird gefragt, wo die Zusammenfassung als PDF gespeichert wird.`)) return null
  // Asked right after the click: the dialog for the file needs it.
  const target = await askPdfTarget(pdfFileName(site))
  const saved = await api.changeSiteStatus(site.id, 'Abgeschlossen')
  if (!target) {
    notifications.show({ message: `„${saved.name}“ ist erledigt (ohne Zusammenfassung).`, color: 'green' })
    return saved
  }
  try {
    const [report, planners, employees, siteRates, history] = await Promise.all([
      api.siteReport(site.id),
      api.planners(),
      api.employees(),
      api.siteHourlyRates(site.id),
      api.siteHistory(site.id),
    ])
    await target.write(await buildSitePdf({ site: saved, report, planners, employees, siteRates, history }))
    notifications.show({ message: `„${saved.name}“ ist erledigt. Die Zusammenfassung ist gespeichert.`, color: 'green' })
  } catch (e) {
    notifications.show({
      message: `„${saved.name}“ ist erledigt, die Zusammenfassung konnte aber nicht gespeichert werden: ${messageOf(e)}`,
      color: 'red',
      autoClose: false,
    })
  }
  return saved
}
