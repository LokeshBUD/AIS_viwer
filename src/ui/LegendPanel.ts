import type { VesselCategory } from '../ais/types'
import { CATEGORY_COLORS } from '../scene/VesselMeshFactory'
import { vesselIconSvg } from './VesselIcon'

const SHIP_TYPES: { cat: VesselCategory; label: string; note: string }[] = [
  { cat: 'cargo',     label: 'Cargo',     note: 'Boxy hull, angled bow' },
  { cat: 'tanker',    label: 'Tanker',    note: 'Wide, blunt bow' },
  { cat: 'passenger', label: 'Passenger', note: 'Wide body, flat stern' },
  { cat: 'fishing',   label: 'Fishing',   note: 'Small, compact hull' },
  { cat: 'tugboat',   label: 'Tugboat',   note: 'Short and wide' },
  { cat: 'military',  label: 'Military',  note: 'Narrow, pointed hull' },
  { cat: 'unknown',   label: 'Unknown',   note: 'Type not reported' },
]

const ANOMALIES: { label: string; color: string; note: string }[] = [
  { label: 'SPD DROP', color: 'var(--c-warn)',   note: 'Speed dropped sharply while underway' },
  { label: 'HEADING',  color: 'var(--c-warn)',   note: 'Course changed sharply in a short window' },
  { label: 'DRAUGHT',  color: 'var(--c-warn)',   note: 'Draught outside expected range for vessel type' },
  { label: 'DARK',     color: 'var(--c-danger)', note: 'Stopped transmitting AIS' },
  { label: 'ZONE ↓',   color: 'var(--c-accent)', note: 'Currently inside a monitored chokepoint' },
  { label: 'ZONE ↑',   color: 'var(--c-accent)', note: 'Exited a monitored chokepoint' },
]

export class LegendPanel {
  private collapsed = true

  constructor() {
    this.build()
  }

  private build(): void {
    const panel = document.createElement('div')
    panel.className = 'hud-panel hud-guide'
    panel.innerHTML = `
      <div class="filter-hdr">
        <span class="hud-panel-header" style="margin:0;border:0;padding:0">LEGEND</span>
        <button class="filter-toggle">▼</button>
      </div>
      <div class="filter-body">
        <div class="filter-section-lbl">SHIP TYPES</div>
        <div class="guide-rows">
          ${SHIP_TYPES.map(t => `
            <div class="guide-row">
              <span class="guide-icon">${vesselIconSvg(t.cat, '#' + CATEGORY_COLORS[t.cat].toString(16).padStart(6, '0'))}</span>
              <span class="guide-lbl">${t.label}</span>
              <span class="guide-note">${t.note}</span>
            </div>`).join('')}
        </div>

        <div class="filter-section-lbl" style="margin-top:10px">ANOMALIES</div>
        <div class="guide-rows">
          ${ANOMALIES.map(a => `
            <div class="guide-row">
              <span class="dot" style="background:${a.color}"></span>
              <span class="guide-lbl">${a.label}</span>
              <span class="guide-note">${a.note}</span>
            </div>`).join('')}
        </div>
      </div>
    `

    const body   = panel.querySelector('.filter-body') as HTMLElement
    const toggle = panel.querySelector('.filter-toggle') as HTMLButtonElement

    // Start collapsed
    body.style.display = 'none'

    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed
      body.style.display = this.collapsed ? 'none' : 'block'
      toggle.textContent = this.collapsed ? '▼' : '▲'
    })

    const root = document.getElementById('ui-root')!
    root.querySelector('.hud-wrap')!.appendChild(panel)
  }
}
