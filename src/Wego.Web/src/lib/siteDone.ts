import { notifications } from '@mantine/notifications'
import { api, messageOf } from '../api/client'
import type { Site } from '../api/types'
import { askPdfTarget, buildSitePdf, pdfFileName, type PdfTarget } from './sitePdf'

/** The summary of a site as a PDF (everything of the page of the site but its calendar, with the wages), written to target. */
export async function writeSummary(site: Site, target: PdfTarget) {
  const [report, planners, employees, siteRates, history] = await Promise.all([
    api.siteReport(site.id),
    api.planners(),
    api.employees(),
    api.siteHourlyRates(site.id),
    api.siteHistory(site.id),
  ])
  await target.write(await buildSitePdf({ site, report, planners, employees, siteRates, history }))
}

/**
 * A planner sets a site to done: asked first. Planer G is then asked where the summary is saved as a PDF
 * (everything of the page of the site but its calendar, with the wages: only for Planer G); the question for the
 * file cancelled, the site is done without a summary. null: not done (the first question was answered with no).
 */
export async function finishSite(site: Site, withSummary = true): Promise<Site | null> {
  if (!withSummary) {
    if (!window.confirm(`„${site.name}“ auf erledigt setzen?`)) return null
    const saved = await api.changeSiteStatus(site.id, 'Abgeschlossen')
    notifications.show({ message: `„${saved.name}“ ist erledigt.`, color: 'green' })
    return saved
  }
  if (!window.confirm(`„${site.name}“ auf erledigt setzen? Danach wird gefragt, wo die Zusammenfassung als PDF gespeichert wird.`)) return null
  // Asked right after the click: the dialog for the file needs it.
  const target = await askPdfTarget(pdfFileName(site))
  const saved = await api.changeSiteStatus(site.id, 'Abgeschlossen')
  if (!target) {
    notifications.show({ message: `„${saved.name}“ ist erledigt (ohne Zusammenfassung).`, color: 'green' })
    return saved
  }
  try {
    await writeSummary(saved, target)
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
