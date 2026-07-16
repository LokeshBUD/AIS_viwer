import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import type { AlertManager } from './AlertManager'
import { GEOZONES, pointInZone } from '../utils/geozones'

export class GeofenceMonitor {
  // Current zone membership per vessel — mmsi → Set of zone ids
  private vesselZones = new Map<number, Set<string>>()

  constructor(private alertManager: AlertManager) {
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => this.check(v))
    EventBus.on<number>(Events.VESSEL_LOST, mmsi => this.vesselZones.delete(mmsi))
  }

  private check(vessel: VesselState): void {
    const prev    = this.vesselZones.get(vessel.mmsi) ?? new Set<string>()
    const current = new Set<string>()

    for (const zone of GEOZONES) {
      if (pointInZone(vessel.lat, vessel.lon, zone)) {
        current.add(zone.id)
      }
    }

    // Fire entry alerts for newly entered zones
    for (const id of current) {
      if (!prev.has(id)) {
        const zone = GEOZONES.find(z => z.id === id)!
        this.alertManager.add({
          id:        `${vessel.mmsi}-GEOFENCE_ENTRY-${id}-${Math.floor(Date.now() / 60_000)}`,
          mmsi:      vessel.mmsi,
          name:      vessel.name,
          type:      'GEOFENCE_ENTRY',
          severity:  zone.severity,
          message:   `Entered ${zone.name}${zone.risk ? ` [${zone.risk}]` : ''}`,
          lat:       vessel.lat,
          lon:       vessel.lon,
          timestamp: Date.now(),
        })
      }
    }

    // Fire exit alerts for zones just left
    for (const id of prev) {
      if (!current.has(id)) {
        const zone = GEOZONES.find(z => z.id === id)!
        this.alertManager.add({
          id:        `${vessel.mmsi}-GEOFENCE_EXIT-${id}-${Math.floor(Date.now() / 60_000)}`,
          mmsi:      vessel.mmsi,
          name:      vessel.name,
          type:      'GEOFENCE_EXIT',
          severity:  'info',
          message:   `Exited ${zone.name}`,
          lat:       vessel.lat,
          lon:       vessel.lon,
          timestamp: Date.now(),
        })
      }
    }

    this.vesselZones.set(vessel.mmsi, current)
    // ZONE ↓ live count = boats currently inside any geofence.
    this.alertManager.setActive(vessel.mmsi, 'GEOFENCE_ENTRY', current.size > 0)
  }
}
