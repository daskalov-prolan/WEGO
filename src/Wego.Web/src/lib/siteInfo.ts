import type { Site } from '../api/types'

/**
 * What a service call is about (its description, as entered when it was made), by site: shown over the sign of the
 * wrench. Taken from the plan when it loads, so that every entry can show it without carrying the site along.
 */
let descriptions = new Map<number, string>()

export function rememberSites(sites: Site[]) {
  descriptions = new Map(sites.flatMap((site) => (site.isService && site.description ? [[site.id, site.description]] : [])))
}

export const serviceDescription = (siteId: number | null | undefined) => (siteId == null ? undefined : descriptions.get(siteId))
