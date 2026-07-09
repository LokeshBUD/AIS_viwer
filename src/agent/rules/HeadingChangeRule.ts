import type { VesselState } from '../../ais/types'
import type { AnomalyAlert } from '../AlertManager'
import { HEADING_CHANGE_THRESHOLD, ANOMALY_WINDOW_SECS } from '../../utils/constants'

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export function checkHeadingChange(vessel: VesselState): AnomalyAlert | null {
  // Only flag vessels that are underway at meaningful speed
  if (vessel.sog < 3) return null

  const now = Date.now()
  const windowMs = ANOMALY_WINDOW_SECS * 1000
  const recent = vessel.history.filter(h => now - h.timestamp < windowMs)
  if (recent.length < 3) return null

  const cogs = recent.map(h => h.cog)
  for (let i = 1; i < cogs.length; i++) {
    const diff = angleDiff(cogs[i], cogs[i - 1])
    if (diff > HEADING_CHANGE_THRESHOLD) {
      return {
        id: `${vessel.mmsi}-SHARP_HEADING-${now}`,
        mmsi: vessel.mmsi,
        name: vessel.name,
        type: 'SHARP_HEADING',
        severity: vessel.sog > 15 ? 'critical' : 'warning',
        message: `Sharp heading change: ${cogs[i - 1].toFixed(0)}° → ${cogs[i].toFixed(0)}° (Δ${diff.toFixed(0)}°) at ${vessel.sog.toFixed(1)} kn`,
        lat: vessel.lat,
        lon: vessel.lon,
        timestamp: now,
      }
    }
  }
  return null
}
