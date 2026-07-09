import { EventBus, Events } from '../utils/EventBus'

export type AlertType = 'SPEED_DROP' | 'SHARP_HEADING' | 'DRAFT_MISMATCH'
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
}
