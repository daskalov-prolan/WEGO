import type { Site, SiteInput } from '../api/types'

export const emptySite: SiteInput = {
  client: null,
  clientPhone: null,
  labelProjectNumber: null,
  street: null,
  houseNumber: null,
  addressAddition: null,
  postalCode: null,
  city: null,
  nameSource: 'Auftraggeber',
  description: null,
  plannedStart: null,
  plannedEnd: null,
  status: 'Angebot',
}

export function toSiteInput(site: Site): SiteInput {
  const { client, street, houseNumber, addressAddition, postalCode, city, nameSource, description } = site
  const { plannedStart, plannedEnd, labelProjectNumber, clientPhone, responsiblePlannerId, isService, requestedOn } = site
  const { scope, salutation } = site
  return {
    client,
    salutation: salutation ?? null,
    clientPhone,
    labelProjectNumber,
    street,
    houseNumber,
    addressAddition,
    postalCode,
    city,
    nameSource,
    description,
    plannedStart,
    plannedEnd,
    responsiblePlannerId,
    isService,
    requestedOn,
    scope: scope ?? [],
  }
}

/** The name the plan shows, worked out the same way as on the server (a service call says so). */
export function siteName(site: SiteInput): string {
  const name = (site.nameSource === 'Strasse' ? `${site.street ?? ''} ${site.houseNumber ?? ''}` : (site.client ?? '')).trim()
  if (!name) return name
  return site.isTentative ? `? ${name}` : site.isService ? `SE: ${name}` : name
}

/** "Hauptstraße 12, Hinterhaus, 13125 Berlin", or null without any address. */
export function formatAddress(site: SiteInput): string | null {
  const street = [site.street, site.houseNumber].filter(Boolean).join(' ')
  const place = [site.postalCode, site.city].filter(Boolean).join(' ')
  return [street, site.addressAddition, place].filter(Boolean).join(', ') || null
}

/** "Frau Krüger": the client with the Anrede, if there is one. */
export function clientName(site: SiteInput): string | null {
  return site.client ? [site.salutation, site.client].filter(Boolean).join(' ') : null
}

/** The name of the site with the Anrede, when the client names it ("Frau Krüger"). */
export function customerName(site: Site): string {
  return site.salutation && site.nameSource === 'Auftraggeber' && site.client ? `${site.salutation} ${site.name}` : site.name
}

/** Text for searching a site: name, client and address together. */
export function siteSearchText(site: Site): string {
  return [site.name, site.client, site.labelProjectNumber, formatAddress(site)].filter(Boolean).join(' · ')
}
