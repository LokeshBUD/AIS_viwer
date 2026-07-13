import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import { AlertManager } from './AlertManager'
import { checkSpeedDrop } from './rules/SpeedDropRule'
import { checkHeadingChange } from './rules/HeadingChangeRule'
import { checkDraftMismatch } from './rules/DraftMismatchRule'

type RuleFn = (v: VesselState) => ReturnType<typeof checkSpeedDrop>

const RULES: RuleFn[] = [checkSpeedDrop, checkHeadingChange, checkDraftMismatch]

// Minimum ms between rule evaluations per vessel — prevents CPU spike in dense regions
const CHECK_INTERVAL_MS = 15_000

export class AnomalyDetector {
  private lastChecked = new Map<number, number>()
  private totalChecks = 0

  constructor(private alertManager: AlertManager) {
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => this.check(v))

    // Confirm engine is running — log every 60s
    setInterval(() => {
      console.log(`[AnomalyDetector] checks run: ${this.totalChecks}, alerts fired: ${this.alertManager.getAll().length}`)
    }, 60_000)
  }

  private check(vessel: VesselState): void {
    const now  = Date.now()
    const last = this.lastChecked.get(vessel.mmsi) ?? 0
    if (now - last < CHECK_INTERVAL_MS) return

    this.lastChecked.set(vessel.mmsi, now)
    this.totalChecks++

    for (const rule of RULES) {
      const alert = rule(vessel)
      if (alert) this.alertManager.add(alert)
    }
  }
}
