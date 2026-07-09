import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import { AlertManager } from './AlertManager'
import { checkSpeedDrop } from './rules/SpeedDropRule'
import { checkHeadingChange } from './rules/HeadingChangeRule'
import { checkDraftMismatch } from './rules/DraftMismatchRule'

type RuleFn = (v: VesselState) => ReturnType<typeof checkSpeedDrop>

const RULES: RuleFn[] = [checkSpeedDrop, checkHeadingChange, checkDraftMismatch]

export class AnomalyDetector {
  constructor(private alertManager: AlertManager) {
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => this.check(v))
  }

  private check(vessel: VesselState): void {
    for (const rule of RULES) {
      const alert = rule(vessel)
      if (alert) this.alertManager.add(alert)
    }
  }
}
