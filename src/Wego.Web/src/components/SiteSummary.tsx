import { Anchor, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import type { Site } from '../api/types'
import { formatDate } from '../lib/dates'
import { formatAddress } from '../lib/sites'
import { SiteLocation } from './SiteLocation'
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
 * white card with a petrol edge.
 */
export function SiteSummary({ site, withStatus = true }: { site: Site; withStatus?: boolean }) {
  const address = formatAddress(site)
  return (
    <div className="site-summary">
      <section className="form-section">
        <h3>Kunde</h3>
        <Fact label="Auftraggeber">{site.client ?? '–'}</Fact>
        <Fact label="Telefon Kunde">
          {site.clientPhone ? (
            <Anchor href={`tel:${site.clientPhone.replace(/[^+0-9]/g, '')}`}>{site.clientPhone}</Anchor>
          ) : (
            '–'
          )}
        </Fact>
      </section>
      <section className="form-section">
        <h3>Adresse</h3>
        {address ? <SiteLocation location={address} /> : <Text>–</Text>}
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
          <Fact label="Beschreibung">
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {site.description}
            </Text>
          </Fact>
        )}
      </section>
    </div>
  )
}
