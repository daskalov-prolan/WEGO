import { Anchor, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import type { Site } from '../api/types'
import { formatDate } from '../lib/dates'
import { formatAddress } from '../lib/sites'
import { SiteLocation } from './SiteLocation'
import { SiteMapLink } from './SitesMap'
import { StatusBadge } from './SiteStatus'

/** One value of the summary with its label; nothing when there is no value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="summary-fact">
      <span className="summary-fact-label">{label}</span>
      <div>{children}</div>
    </div>
  )
}

/**
 * What is known of a site, in the groups of its form: the customer, the address and the planning, each on a
 * white card with a petrol edge. The planner in charge (Bearbeiter) only where it is known, i.e. for planners.
 */
export function SiteSummary({ site, withStatus = true, planner }: { site: Site; withStatus?: boolean; planner?: string | null }) {
  const address = formatAddress(site)
  return (
    <div className="site-summary">
      <section className="form-section">
        <h3>Kunde</h3>
        <Fact label="Auftraggeber">{site.client ?? '–'}</Fact>
        {planner !== undefined && <Fact label="Bearbeiter">{planner ?? '–'}</Fact>}
      </section>
      <section className="form-section">
        <h3>Adresse</h3>
        {address ? <SiteLocation location={address} /> : <Text>–</Text>}
        <SiteMapLink site={site} />
        <Fact label="Telefon Kunde">
          {site.clientPhone ? (
            <Anchor href={`tel:${site.clientPhone.replace(/[^+0-9]/g, '')}`}>{site.clientPhone}</Anchor>
          ) : (
            '–'
          )}
        </Fact>
      </section>
      <section className="form-section">
        <h3>Planung</h3>
        {withStatus && (
          <Fact label="Status">
            <StatusBadge status={site.status} />
          </Fact>
        )}
        <Fact label="Geplanter Start">{site.plannedStart ? formatDate(site.plannedStart) : '–'}</Fact>
        {site.description && (
          // The description speaks for itself, without a label.
          <Text size="sm" mt={6} style={{ whiteSpace: 'pre-wrap' }}>
            {site.description}
          </Text>
        )}
      </section>
    </div>
  )
}
