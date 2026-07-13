import { EventBus, Events } from '../utils/EventBus'
import type { AnomalyAlert } from '../agent/AlertManager'

const TYPE_ICON: Record<string, string> = {
  SPEED_DROP:     '⚡',
  SHARP_HEADING:  '↩',
  DRAFT_MISMATCH: '⚖',
}

export class AlertPanel {
  private panel: HTMLElement
  private list: HTMLElement
  private alerts: AnomalyAlert[] = []
  private alertCount = 0

  constructor() {
    this.panel = document.getElementById('alert-panel')!
    this.list  = document.getElementById('alert-list')!

    // Toggle panel visibility when clicking ALERTS stat
    const alertStat = document.getElementById('stat-alerts')
    alertStat?.addEventListener('click', () => this.panel.classList.toggle('hidden'))
    if (alertStat) alertStat.style.cursor = 'pointer'

    EventBus.on<AnomalyAlert>(Events.ANOMALY_DETECTED, a => this.onAlert(a))
  }

  private onAlert(alert: AnomalyAlert): void {
    // Replace existing same MMSI+type or prepend
    const idx = this.alerts.findIndex(a => a.mmsi === alert.mmsi && a.type === alert.type)
    if (idx >= 0) {
      this.alerts[idx] = alert
    } else {
      this.alerts.unshift(alert)
      this.alertCount++
      if (this.alerts.length > 30) this.alerts.pop()
    }

    // Auto-show panel on first alert
    if (this.alertCount === 1) this.panel.classList.remove('hidden')

    this.render()
    EventBus.emit(Events.ALERT_UPDATED, this.alertCount)
  }

  private render(): void {
    this.list.innerHTML = this.alerts.map(a => {
      const icon = TYPE_ICON[a.type] ?? '!'
      const timeStr = new Date(a.timestamp).toISOString().substring(11, 19)
      return `
        <div class="alert-item alert-${a.severity}" data-mmsi="${a.mmsi}">
          <div class="alert-top">
            <span class="alert-icon">${icon}</span>
            <span class="alert-vessel">${escHtml(a.name)}</span>
            <span class="alert-time">${timeStr}</span>
          </div>
          <div class="alert-msg">${escHtml(a.message)}</div>
        </div>
      `
    }).join('')

    // Click to select vessel on map
    this.list.querySelectorAll('.alert-item').forEach(el => {
      el.addEventListener('click', () => {
        const mmsi = Number(el.getAttribute('data-mmsi'))
        if (mmsi) EventBus.emit(Events.VESSEL_SELECTED, mmsi)
      })
    })
  }

  get count(): number { return this.alertCount }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
