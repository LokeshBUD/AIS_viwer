import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'

type SortKey = 'name' | 'vesselCategory' | 'sog' | 'destination' | 'navStatus' | 'age'
type SortDir = 'asc' | 'desc'

const NAV_SHORT: Record<string, string> = {
  UnderWayUsingEngine:       'Underway',
  AtAnchor:                  'At Anchor',
  Moored:                    'Moored',
  NotUnderCommand:           'Not Under Cmd',
  RestrictedManoeuvrability: 'Restricted',
  ConstrainedByDraught:      'Constrained',
  Aground:                   'AGROUND',
  EngagedInFishing:          'Fishing',
  UnderWaySailing:           'Sailing',
  HscOrWig:                  'HSC/WIG',
  AisSartIsActive:           'SART',
  NotDefined:                '—',
}

const MAX_ROWS = 500

export class VesselTable {
  private tracker: { getAll(): ReadonlyMap<number, VesselState> }
  private sortKey: SortKey = 'sog'
  private sortDir: SortDir = 'desc'
  private collapsed = true
  private timer: ReturnType<typeof setInterval> | null = null

  private panel!:    HTMLElement
  private countEl!:  HTMLElement
  private tbody!:    HTMLElement
  private headers:   Map<SortKey, HTMLElement> = new Map()

  constructor(tracker: { getAll(): ReadonlyMap<number, VesselState> }) {
    this.tracker = tracker
    this.build()
    this.start()
  }

  private build(): void {
    const panel = document.createElement('div')
    panel.className = 'hud-panel hud-table'
    panel.innerHTML = `
      <div class="table-hdr">
        <span class="hud-panel-header" style="margin:0;border:0;padding:0">
          VESSELS &nbsp;<span id="tbl-count" class="accent">0</span>
        </span>
        <button class="table-toggle" id="tbl-toggle">▲</button>
      </div>
      <div class="table-wrap" id="tbl-wrap">
        <table class="vtable">
          <thead>
            <tr>
              <th data-key="name">NAME</th>
              <th data-key="vesselCategory">TYPE</th>
              <th data-key="sog">SOG</th>
              <th data-key="destination">DEST</th>
              <th data-key="navStatus">STATUS</th>
              <th data-key="age">AGE</th>
            </tr>
          </thead>
          <tbody id="tbl-body"></tbody>
        </table>
      </div>
    `

    // Sort headers
    panel.querySelectorAll<HTMLElement>('th[data-key]').forEach(th => {
      const key = th.dataset.key as SortKey
      this.headers.set(key, th)
      th.addEventListener('click', () => {
        if (this.sortKey === key) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          this.sortKey = key
          this.sortDir = key === 'sog' ? 'desc' : 'asc'
        }
        this.updateHeaderMarks()
        this.renderRows()
      })
    })

    // Collapse toggle
    const toggle = panel.querySelector('#tbl-toggle') as HTMLButtonElement
    const wrap   = panel.querySelector('#tbl-wrap') as HTMLElement
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed
      wrap.style.display   = this.collapsed ? 'none' : 'block'
      toggle.textContent   = this.collapsed ? '▲' : '▼'
    })

    this.panel   = panel
    this.countEl = panel.querySelector('#tbl-count')!
    this.tbody   = panel.querySelector('#tbl-body')!

    this.updateHeaderMarks()

    document.querySelector('.hud-wrap')!.appendChild(panel)
  }

  private start(): void {
    this.renderRows()
    this.timer = setInterval(() => this.renderRows(), 2000)
  }

  private renderRows(): void {
    const now     = Date.now()
    const vessels = Array.from(this.tracker.getAll().values())

    this.countEl.textContent = vessels.length.toString()

    // Sort
    vessels.sort((a, b) => {
      let av: string | number
      let bv: string | number
      switch (this.sortKey) {
        case 'name':          av = a.name;           bv = b.name;           break
        case 'vesselCategory':av = a.vesselCategory; bv = b.vesselCategory; break
        case 'sog':           av = a.sog;            bv = b.sog;            break
        case 'destination':   av = a.destination;    bv = b.destination;    break
        case 'navStatus':     av = a.navStatus;      bv = b.navStatus;      break
        case 'age':           av = a.lastUpdate;     bv = b.lastUpdate;     break
      }
      if (av < bv) return this.sortDir === 'asc' ? -1 : 1
      if (av > bv) return this.sortDir === 'asc' ? 1 : -1
      return 0
    })

    const rows = vessels.slice(0, MAX_ROWS)

    // Build HTML in one shot — fastest DOM approach for large lists
    const html = rows.map(v => {
      const ageSec = Math.round((now - v.lastUpdate) / 1000)
      const age    = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`
      const dest   = v.destination || '—'
      const status = NAV_SHORT[v.navStatus] ?? '—'
      return `<tr data-mmsi="${v.mmsi}">
        <td class="td-name">${escHtml(v.name || '—')}</td>
        <td>${v.vesselCategory.toUpperCase()}</td>
        <td class="td-sog accent">${v.sog.toFixed(1)}</td>
        <td class="td-dest">${escHtml(dest)}</td>
        <td class="td-status">${status}</td>
        <td class="td-age">${age}</td>
      </tr>`
    }).join('')

    this.tbody.innerHTML = html

    // Wire row clicks after render
    this.tbody.querySelectorAll<HTMLElement>('tr[data-mmsi]').forEach(row => {
      row.addEventListener('click', () => {
        const mmsi = parseInt(row.dataset.mmsi!)
        EventBus.emit(Events.VESSEL_SELECTED, mmsi)
      })
    })
  }

  private updateHeaderMarks(): void {
    this.headers.forEach((th, key) => {
      th.classList.toggle('sort-active', key === this.sortKey)
      if (key === this.sortKey) {
        th.dataset.dir = this.sortDir
      } else {
        delete th.dataset.dir
      }
    })
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.panel.remove()
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
