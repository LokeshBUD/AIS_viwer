import type { VesselState } from '../../ais/types'
import type { AnomalyAlert } from '../AlertManager'

/** Expected draught range [min, max] in 0.1m AIS units by category */
const EXPECTED: Record<string, [number, number]> = {
  cargo:     [25, 160],
  tanker:    [40, 210],
  tugboat:   [15, 55],
  passenger: [25, 95],
  fishing:   [8,  45],
  military:  [20, 90],
}

// Minimum position history before trusting static draught field
// Prevents false positives from stale/unconfigured crew data on newly-seen vessels
const MIN_HISTORY_POINTS = 20

export function checkDraftMismatch(vessel: VesselState): AnomalyAlert | null {
  if (vessel.draught === 0) return null             // not reported
  if (vessel.history.length < MIN_HISTORY_POINTS) return null  // too new, data unreliable
  const range = EXPECTED[vessel.vesselCategory]
  if (!range) return null

  const [min, max] = range
  if (vessel.draught >= min && vessel.draught <= max) return null

  const draughtM = (vessel.draught / 10).toFixed(1)
  const minM = (min / 10).toFixed(1)
  const maxM = (max / 10).toFixed(1)

  return {
    id: `${vessel.mmsi}-DRAFT_MISMATCH-${Date.now()}`,
    mmsi: vessel.mmsi,
    name: vessel.name,
    type: 'DRAFT_MISMATCH',
    severity: 'warning',
    message: `${vessel.vesselCategory} draught ${draughtM}m outside expected ${minM}–${maxM}m`,
    lat: vessel.lat,
    lon: vessel.lon,
    timestamp: Date.now(),
  }
}
