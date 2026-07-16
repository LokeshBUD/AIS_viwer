import { EventBus, Events } from '../utils/EventBus'

export type AlertType = 'SPEED_DROP' | 'SHARP_HEADING' | 'DRAFT_MISMATCH' | 'AIS_GAP' | 'GEOFENCE_ENTRY' | 'GEOFENCE_EXIT'
export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AnomalyAlert {
  id: string
  mmsi: number
  name: string
  type: AlertType
  severity: AlertSeverity
  message: string
  lat: number
  lon: number
  timestamp: number
}

const DEDUP_WINDOW_MS = 5 * 60 * 1000
const MAX_ALERTS = 100

export class AlertManager {
  private alerts: AnomalyAlert[] = []
  private dedupKeys = new Set<string>()

  // Live "is this vessel currently exhibiting this anomaly type" state —
  // separate from the deduped alert feed above. Rules call setActive() on
  // every re-check (true/false), so a vessel drops out the moment the
  // underlying condition clears, unlike the feed which only ever appends.
  private activeByType = new Map<AlertType, Set<number>>()

  constructor() {
    EventBus.on<number>(Events.VESSEL_LOST, mmsi => {
      for (const set of this.activeByType.values()) set.delete(mmsi)
    })
  }

  add(alert: AnomalyAlert): void {
    const key = `${alert.mmsi}:${alert.type}:${Math.floor(alert.timestamp / DEDUP_WINDOW_MS)}`
    if (this.dedupKeys.has(key)) return
    this.dedupKeys.add(key)

    this.alerts.unshift(alert)
    if (this.alerts.length > MAX_ALERTS) {
      const removed = this.alerts.pop()!
      // Clean up old dedup keys lazily (leave them, they expire naturally by time bucket)
      void removed
    }

    EventBus.emit(Events.ANOMALY_DETECTED, alert)
  }

  getAll(): readonly AnomalyAlert[] { return this.alerts }

  setActive(mmsi: number, type: AlertType, active: boolean): void {
    let set = this.activeByType.get(type)
    if (!set) { set = new Set<number>(); this.activeByType.set(type, set) }
    if (active) set.add(mmsi)
    else set.delete(mmsi)
  }

  getActiveCount(type: AlertType): number {
    return this.activeByType.get(type)?.size ?? 0
  }

  /** Distinct vessels with at least one currently-active anomaly type. */
  getActiveVesselCount(): number {
    const union = new Set<number>()
    for (const set of this.activeByType.values()) {
      for (const mmsi of set) union.add(mmsi)
    }
    return union.size
  }
}
