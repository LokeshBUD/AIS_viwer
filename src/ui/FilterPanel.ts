import type { VesselCategory, NavigationalStatus } from '../ais/types'

export interface FilterState {
  categories: Set<VesselCategory>
  statuses:   Set<NavigationalStatus>
  maxSog:     number   // 0–30+ (31 = no limit)
}

const ALL_CATEGORIES: VesselCategory[] = ['cargo', 'tanker', 'passenger', 'fishing', 'tugboat', 'military', 'unknown']

const STATUS_OPTIONS: { label: string; value: NavigationalStatus }[] = [
  { label: 'UNDERWAY',      value: 'UnderWayUsingEngine' },
  { label: 'AT ANCHOR',     value: 'AtAnchor'            },
  { label: 'MOORED',        value: 'Moored'              },
  { label: 'FISHING',       value: 'EngagedInFishing'    },
  { label: 'NOT UNDER CMD', value: 'NotUnderCommand'     },
]

// Only these statuses are checkbox-controlled. Any other navStatus always passes.
export const KNOWN_FILTER_STATUSES = new Set(STATUS_OPTIONS.map(s => s.value))

export class FilterPanel {
  private state: FilterState = {
    categories: new Set(ALL_CATEGORIES),
    statuses:   new Set(STATUS_OPTIONS.map(s => s.value)),
    maxSog:     31,
  }

  private cb?: (state: FilterState) => void
  private badgeEl!: HTMLElement
  private collapsed = true

  constructor() {
    this.build()
  }

  onChange(cb: (state: FilterState) => void): void { this.cb = cb }

  getState(): Readonly<FilterState> { return this.state }

  private build(): void {
    const panel = document.createElement('div')
    panel.className = 'hud-panel hud-filter'
    panel.innerHTML = `
      <div class="filter-hdr">
        <span class="hud-panel-header" style="margin:0;border:0;padding:0">FILTERS</span>
        <span class="filter-badge hidden">0</span>
        <button class="filter-toggle">▼</button>
      </div>
      <div class="filter-body">
        <div class="filter-section-lbl">VESSEL TYPE</div>
        <div class="filter-checkboxes" id="fp-cats">
          ${ALL_CATEGORIES.map(c => `
            <label class="filter-check">
              <input type="checkbox" data-cat="${c}" checked />
              ${c.toUpperCase()}
            </label>`).join('')}
        </div>

        <div class="filter-section-lbl" style="margin-top:8px">STATUS</div>
        <div class="filter-checkboxes" id="fp-status">
          ${STATUS_OPTIONS.map(s => `
            <label class="filter-check">
              <input type="checkbox" data-status="${s.value}" checked />
              ${s.label}
            </label>`).join('')}
        </div>

        <div class="filter-section-lbl" style="margin-top:8px">MAX SPEED (SOG)</div>
        <div class="filter-sog-wrap">
          <input type="range" id="fp-sog" min="0" max="31" step="1" value="31" />
          <span id="fp-sog-val">ALL</span>
        </div>

        <button class="filter-clear">CLEAR FILTERS</button>
      </div>
    `

    const body  = panel.querySelector('.filter-body') as HTMLElement
    const toggle = panel.querySelector('.filter-toggle') as HTMLButtonElement

    // Start collapsed
    body.style.display = 'none'

    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed
      body.style.display = this.collapsed ? 'none' : 'block'
      toggle.textContent = this.collapsed ? '▼' : '▲'
    })

    // Category checkboxes
    panel.querySelectorAll<HTMLInputElement>('input[data-cat]').forEach(cb => {
      cb.addEventListener('change', () => {
        const cat = cb.dataset.cat as VesselCategory
        cb.checked ? this.state.categories.add(cat) : this.state.categories.delete(cat)
        this.emit()
      })
    })

    // Status checkboxes
    panel.querySelectorAll<HTMLInputElement>('input[data-status]').forEach(cb => {
      cb.addEventListener('change', () => {
        const st = cb.dataset.status as NavigationalStatus
        cb.checked ? this.state.statuses.add(st) : this.state.statuses.delete(st)
        this.emit()
      })
    })

    // SOG slider
    const sogSlider = panel.querySelector('#fp-sog') as HTMLInputElement
    const sogVal    = panel.querySelector('#fp-sog-val') as HTMLElement
    sogSlider.addEventListener('input', () => {
      const v = parseInt(sogSlider.value)
      this.state.maxSog = v
      sogVal.textContent = v >= 31 ? 'ALL' : `≤${v} kn`
      this.emit()
    })

    // Clear
    panel.querySelector('.filter-clear')!.addEventListener('click', () => {
      this.reset(panel)
    })

    this.badgeEl = panel.querySelector('.filter-badge') as HTMLElement

    const root = document.getElementById('ui-root')!
    root.querySelector('.hud-wrap')!.appendChild(panel)
  }

  private reset(panel: HTMLElement): void {
    this.state.categories = new Set(ALL_CATEGORIES)
    this.state.statuses   = new Set(STATUS_OPTIONS.map(s => s.value))
    this.state.maxSog     = 31

    panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(cb => { cb.checked = true })
    const sogSlider = panel.querySelector('#fp-sog') as HTMLInputElement
    const sogVal    = panel.querySelector('#fp-sog-val') as HTMLElement
    sogSlider.value = '31'
    sogVal.textContent = 'ALL'

    this.emit()
  }

  private emit(): void {
    this.updateBadge()
    this.cb?.(this.state)
  }

  private updateBadge(): void {
    const inactive =
      (ALL_CATEGORIES.length - this.state.categories.size) +
      (STATUS_OPTIONS.length  - this.state.statuses.size)  +
      (this.state.maxSog < 31 ? 1 : 0)

    if (inactive > 0) {
      this.badgeEl.textContent = inactive.toString()
      this.badgeEl.classList.remove('hidden')
    } else {
      this.badgeEl.classList.add('hidden')
    }
  }
}
