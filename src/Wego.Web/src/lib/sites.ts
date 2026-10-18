import type { Site, SiteInput } from '../api/types'

export const emptySite: SiteInput = {
  client: null,
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
  const { plannedStart, plannedEnd, labelProjectNumber } = site
  return {
    client,
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
  }
}

/** The name the plan shows, worked out the same way as on the server. */
export function siteName(site: SiteInput): string {
  return (site.nameSource === 'Strasse' ? `${site.street ?? ''} ${site.houseNumber ?? ''}` : (site.client ?? '')).trim()
}

/** "Hauptstraße 12, Hinterhaus, 13125 Berlin", or null without any address. */
export function formatAddress(site: SiteInput): string | null {
  const street = [site.street, site.houseNumber].filter(Boolean).join(' ')
  const place = [site.postalCode, site.city].filter(Boolean).join(' ')
  return [street, site.addressAddition, place].filter(Boolean).join(', ') || null
}

/** Text for searching a site: name, client and address together. */
export function siteSearchText(site: Site): string {
  return [site.name, site.client, site.labelProjectNumber, formatAddress(site)].filter(Boolean).join(' · ')
}
