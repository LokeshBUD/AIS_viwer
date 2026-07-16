import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import { AlertManager, type AlertType } from './AlertManager'
import { checkSpeedDrop } from './rules/SpeedDropRule'
import { checkHeadingChange } from './rules/HeadingChangeRule'
import { checkDraftMismatch } from './rules/DraftMismatchRule'
import { checkAisGap } from './rules/AisGapRule'

type RuleFn = (v: VesselState) => ReturnType<typeof checkSpeedDrop>

// Rules run on every VESSEL_UPDATED (throttled to 15s per vessel). Paired
// with their AlertType so we can report live true/false state, not just
// deduped alert events, into AlertManager.setActive().
const LIVE_RULES: [AlertType, RuleFn][] = [
  ['SPEED_DROP',     checkSpeedDrop],
  ['SHARP_HEADING',  checkHeadingChange],
  ['DRAFT_MISMATCH', checkDraftMismatch],
]

// Minimum ms between live-rule evaluations per vessel
const CHECK_INTERVAL_MS = 15_000
// How often the gap scanner sweeps all known vessels
const GAP_SCAN_INTERVAL_MS = 60_000

export class AnomalyDetector {
  private lastChecked    = new Map<number, number>()
  private lastGapChecked = new Map<number, number>()
  private totalChecks    = 0

  constructor(
    private alertManager: AlertManager,
    private tracker: { getAll(): ReadonlyMap<number, VesselState> },
  ) {
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => this.checkLive(v))

    // Scan ALL vessels for AIS gaps — catches vessels that stopped transmitting
    setInterval(() => this.scanGaps(), GAP_SCAN_INTERVAL_MS)

    // Engine heartbeat log
    setInterval(() => {
      console.log(`[AnomalyDetector] checks: ${this.totalChecks}, alerts: ${this.alertManager.getAll().length}, tracking: ${this.tracker.getAll().size} vessels`)
    }, 60_000)
  }

  private checkLive(vessel: VesselState): void {
    const now  = Date.now()
    const last = this.lastChecked.get(vessel.mmsi) ?? 0
    if (now - last < CHECK_INTERVAL_MS) return

    this.lastChecked.set(vessel.mmsi, now)
    this.totalChecks++

    for (const [type, rule] of LIVE_RULES) {
      const alert = rule(vessel)
      this.alertManager.setActive(vessel.mmsi, type, !!alert)
      if (alert) this.alertManager.add(alert)
    }
  }

  private scanGaps(): void {
    const now = Date.now()
    for (const vessel of this.tracker.getAll().values()) {
      // Gap rule has its own dedup bucket via alert id — but also throttle scan per vessel
      const lastScan = this.lastGapChecked.get(vessel.mmsi) ?? 0
      if (now - lastScan < GAP_SCAN_INTERVAL_MS) continue
      this.lastGapChecked.set(vessel.mmsi, now)

      const alert = checkAisGap(vessel)
      this.alertManager.setActive(vessel.mmsi, 'AIS_GAP', !!alert)
      if (alert) this.alertManager.add(alert)
    }
  }
}
