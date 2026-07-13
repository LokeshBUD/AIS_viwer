import type { WSStatus } from '../ais/WebSocketClient'

export class HUD {
  private vesselCountEl!: HTMLElement
  private alertCountEl!:  HTMLElement
  private wsStatusEl!:    HTMLElement
  private wsDotel!:       HTMLElement
  private msgRateEl!:     HTMLElement
  private coordEl!:       HTMLElement
  private onSearchCb?: (query: string) => void

  constructor() {
    const root = document.getElementById('ui-root')!
    root.innerHTML = `
      <div class="hud-wrap">

        <!-- Top center: title -->
        <div class="hud-title">
          <span class="accent">AIS</span>&nbsp;MARITIME&nbsp;DASHBOARD
          <div class="hud-subtitle">LIVE GLOBAL VESSEL TRACKING</div>
        </div>

        <!-- Search bar (top center, below title) -->
        <div class="hud-search-wrap">
          <input id="vessel-search" class="hud-search" type="text"
            placeholder="Search vessel name or MMSI…" autocomplete="off" spellcheck="false" />
          <span class="hud-search-icon">⌕</span>
        </div>

        <!-- Top left: stats -->
        <div class="hud-panel hud-stats">
          <div class="hud-panel-header">SYSTEM STATUS</div>
          <div class="stat-row">
            <span class="stat-lbl">VESSELS</span>
            <span id="stat-vessels" class="stat-val accent">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl">ALERTS</span>
            <span id="stat-alerts" class="stat-val warn">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl">MSG/S</span>
            <span id="stat-msgrate" class="stat-val">—</span>
          </div>
          <div class="stat-row">
            <span class="stat-lbl">RELAY</span>
            <span id="ws-dot" class="ws-dot"></span>
            <span id="ws-status" class="stat-val">CONNECTING</span>
          </div>
        </div>

        <!-- Bottom left: coordinates -->
        <div id="hud-coords" class="hud-coords">
          <span id="coord-display">0.0000°N  0.0000°E</span>
        </div>

        <!-- Legend -->
        <div class="hud-panel hud-legend">
          <div class="hud-panel-header">COLOR = DESTINATION CONTINENT</div>
          <div class="legend-row"><span class="dot" style="background:#4a9eff"></span>EUROPE</div>
          <div class="legend-row"><span class="dot" style="background:#ff6b35"></span>ASIA</div>
          <div class="legend-row"><span class="dot" style="background:#ffcc44"></span>MIDDLE EAST</div>
          <div class="legend-row"><span class="dot" style="background:#ffdd57"></span>NORTH AMERICA</div>
          <div class="legend-row"><span class="dot" style="background:#7fff7f"></span>SOUTH AMERICA</div>
          <div class="legend-row"><span class="dot" style="background:#ff7f7f"></span>AFRICA</div>
          <div class="legend-row"><span class="dot" style="background:#cc88ff"></span>OCEANIA</div>
          <div class="legend-row"><span class="dot" style="background:#888899"></span>UNKNOWN DEST</div>
          <div class="legend-row" style="margin-top:4px;font-size:9px;color:var(--c-muted);border-top:1px solid var(--c-border);padding-top:4px">
            DASHED LINE = MARITIME ROUTE
          </div>
        </div>

        <!-- Vessel info panel (right) -->
        <div id="vessel-info" class="hud-panel hud-info hidden"></div>

        <!-- Alert panel (bottom right) — hidden -->
        <div id="alert-panel" class="hud-panel hud-alerts hidden">
          <div class="hud-panel-header">ANOMALY ALERTS</div>
          <div id="alert-list" class="alert-list"></div>
        </div>

        <!-- Corner decorations -->
        <div class="corner corner-tl"></div>
        <div class="corner corner-tr"></div>
        <div class="corner corner-bl"></div>
        <div class="corner corner-br"></div>
      </div>
    `

    this.vesselCountEl = document.getElementById('stat-vessels')!
    this.alertCountEl  = document.getElementById('stat-alerts')!
    this.wsStatusEl    = document.getElementById('ws-status')!
    this.wsDotel       = document.getElementById('ws-dot')!
    this.msgRateEl     = document.getElementById('stat-msgrate')!
    this.coordEl       = document.getElementById('coord-display')!

    const searchEl = document.getElementById('vessel-search') as HTMLInputElement
    searchEl.addEventListener('input', () => this.onSearchCb?.(searchEl.value.trim()))
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { searchEl.value = ''; this.onSearchCb?.('') }
    })
  }

  onSearch(cb: (query: string) => void): void { this.onSearchCb = cb }

  setVesselCount(n: number): void {
    this.vesselCountEl.textContent = n.toString()
  }

  setAlertCount(n: number): void {
    this.alertCountEl.textContent = n.toString()
    this.alertCountEl.style.color = n > 0 ? 'var(--c-warn)' : 'var(--c-accent)'
  }

  setMsgRate(rate: number): void {
    this.msgRateEl.textContent = `${rate}/s`
  }

  setWSStatus(status: WSStatus): void {
    const labels: Record<WSStatus, string> = {
      connecting:   'CONNECTING',
      connected:    'CONNECTED',
      disconnected: 'OFFLINE',
      error:        'ERROR',
    }
    const colors: Record<WSStatus, string> = {
      connecting:   'var(--c-warn)',
      connected:    'var(--c-success)',
      disconnected: 'var(--c-danger)',
      error:        'var(--c-danger)',
    }
    this.wsStatusEl.textContent = labels[status]
    this.wsStatusEl.style.color = colors[status]
    this.wsDotel.style.background = colors[status]
    this.wsDotel.classList.toggle('ws-dot-pulse', status === 'connected')
  }

  setCoords(lat: number, lon: number): void {
    const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`
    const lonStr = `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
    this.coordEl.textContent = `${latStr}  ${lonStr}`
  }
}
