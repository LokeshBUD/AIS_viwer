import { lookupPort, CONTINENT_COLORS } from './ports'

/**
 * Color a vessel by the continent of its destination port.
 * Falls back to grey for unknown/empty destinations.
 */
export function destColor(destination: string): number {
  const d = destination?.trim()
  if (!d || d === 'UNKNOWN' || d === '' || d === '@@@@@@') {
    return 0x888899   // grey = no destination
  }
  const port = lookupPort(d)
  if (!port) return 0x888899
  return CONTINENT_COLORS[port.continent]
}
