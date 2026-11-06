import { Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import type { Site } from '../api/types'
import { formatDate } from '../lib/dates'
import { formatAddress } from '../lib/sites'
import { CallButton, SiteWayButtons } from './SiteActions'
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
export function SiteSummary({
  site,
  withStatus = true,
  planner,
  clientHref,
}: {
  site: Site
  withStatus?: boolean
  planner?: string | null
  /** Where the name of the customer leads (the page of the site); without, it is plain text. */
  clientHref?: string
}) {
  const address = formatAddress(site)
  return (
    <div className="site-summary">
      <section className="form-section">
        <h3>Kunde</h3>
        <Fact label="Auftraggeber">
          {site.client && clientHref ? (
            <a href={clientHref} className="site-client-link">
              {site.client}
            </a>
          ) : (
            (site.client ?? '–')
          )}
        </Fact>
        {planner !== undefined && <Fact label="Bearbeiter">{planner ?? '–'}</Fact>}
      </section>
      <section className="form-section">
        <h3>Adresse</h3>
        <Stack gap="xs">
          <Text size="sm">{address ?? '–'}</Text>
          <SiteWayButtons site={site} size="xs" />
          <Fact label="Telefon Kunde">{site.clientPhone ? <CallButton phone={site.clientPhone} size="xs" /> : '–'}</Fact>
        </Stack>
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
          <Text size="sm" mt={6} className="site-description" style={{ whiteSpace: 'pre-wrap' }}>
            {site.description}
          </Text>
        )}
      </section>
    </div>
  )
}
