import type { VesselState } from '../../ais/types'
import type { AnomalyAlert } from '../AlertManager'
import { HEADING_CHANGE_THRESHOLD, ANOMALY_WINDOW_SECS } from '../../utils/constants'

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export function checkHeadingChange(vessel: VesselState): AnomalyAlert | null {
  // Only flag vessels underway at meaningful speed
  if (vessel.sog < 3) return null

  const now = Date.now()
  const windowMs = ANOMALY_WINDOW_SECS * 1000
  const recent = vessel.history.filter(h => now - h.timestamp < windowMs)

  // Need enough points spread across the window to establish a trend
  if (recent.length < 5) return null

  // Compare first vs last COG in window — total drift, ignores individual GPS glitches
  const first = recent[0].cog
  const last  = recent[recent.length - 1].cog
  const totalDrift = angleDiff(first, last)

  if (totalDrift <= HEADING_CHANGE_THRESHOLD) return null

  // Confirm: majority of consecutive pairs also show change in same direction
  // (rules out oscillation / GPS noise that cancels out)
  let consistent = 0
  const cogs = recent.map(h => h.cog)
  for (let i = 1; i < cogs.length; i++) {
    if (angleDiff(cogs[i], cogs[i - 1]) > 5) consistent++
  }
  if (consistent < Math.floor(cogs.length * 0.4)) return null

  return {
    id: `${vessel.mmsi}-SHARP_HEADING-${now}`,
    mmsi: vessel.mmsi,
    name: vessel.name,
    type: 'SHARP_HEADING',
    severity: vessel.sog > 15 ? 'critical' : 'warning',
    message: `Sustained heading change: ${first.toFixed(0)}° → ${last.toFixed(0)}° (Δ${totalDrift.toFixed(0)}° over ${Math.round(windowMs / 60000)} min) at ${vessel.sog.toFixed(1)} kn`,
    lat: vessel.lat,
    lon: vessel.lon,
    timestamp: now,
  }
}
