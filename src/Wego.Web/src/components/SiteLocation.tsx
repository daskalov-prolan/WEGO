import { Anchor, Text } from '@mantine/core'

/** The place of a construction site with a link that opens it in the map app. */
export function SiteLocation({ location }: { location: string }) {
  return (
    <Text size="sm" component="span" className="site-location">
      {location}{' '}
      <Anchor
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
        target="_blank"
        rel="noreferrer"
        fw={700}
        size="sm"
      >
        Karte
      </Anchor>
    </Text>
  )
}
