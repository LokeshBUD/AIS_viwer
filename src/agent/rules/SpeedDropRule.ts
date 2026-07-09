import type { VesselState } from '../../ais/types'
import type { AnomalyAlert } from '../AlertManager'
import { SPEED_DROP_THRESHOLD, ANOMALY_WINDOW_SECS } from '../../utils/constants'

export function checkSpeedDrop(vessel: VesselState): AnomalyAlert | null {
  if (vessel.history.length < 3) return null

  const now = Date.now()
  const windowMs = ANOMALY_WINDOW_SECS * 1000
  const recent = vessel.history.filter(h => now - h.timestamp < windowMs)
  if (recent.length < 2) return null

  const maxSog = Math.max(...recent.map(h => h.sog))
  const cur = vessel.sog

  // Only flag if was moving and dropped significantly
  if (maxSog < 2) return null
  if (cur >= maxSog * (1 - SPEED_DROP_THRESHOLD)) return null

  const severity = cur === 0 && vessel.navStatus !== 'AtAnchor' && vessel.navStatus !== 'Moored'
    ? 'critical'
    : 'warning'

  return {
    id: `${vessel.mmsi}-SPEED_DROP-${now}`,
    mmsi: vessel.mmsi,
    name: vessel.name,
    type: 'SPEED_DROP',
    severity,
    message: `Speed dropped from ${maxSog.toFixed(1)} kn → ${cur.toFixed(1)} kn (${Math.round((1 - cur / maxSog) * 100)}% reduction)`,
    lat: vessel.lat,
    lon: vessel.lon,
    timestamp: now,
  }
}
