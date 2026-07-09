import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import { lookupPort, CONTINENT_LABELS } from '../utils/ports'
import { destColor } from '../utils/destColor'

/**
 * Ship photo sources tried in order via JS fallback chain.
 * Each returns a URL; if the image fails to load the next src is tried.
 *
 * 1. VesselFinder – best quality, high-res JPEG by MMSI
 * 2. MarineTraffic – common fallback
 * 3. VesselTracker CDN
 */
const PHOTO_SOURCES = (mmsi: number): string[] => [
  `https://www.vesselfinder.com/api/pub/portcalls/photo?v=1&mmsi=${mmsi}`,
  `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${mmsi}`,
  `https://photos.vesseltracker.com/ships/${mmsi}.jpg`,
]

const NAV_STATUS_LABEL: Record<string, string> = {
  UnderWayUsingEngine:      'Underway (Engine)',
  AtAnchor:                 'At Anchor',
  Moored:                   'Moored',
  NotUnderCommand:          'Not Under Command',
  RestrictedManoeuvrability:'Restricted Manoeuvre',
  ConstrainedByDraught:     'Constrained by Draught',
  Aground:                  '⚠ AGROUND',
  EngagedInFishing:         'Fishing',
  UnderWaySailing:          'Underway (Sail)',
  HscOrWig:                 'HSC / WIG',
  AisSartIsActive:          'SART Active',
  NotDefined:               'Unknown',
}

const SHIP_TYPE_NAME: Record<number, string> = {
  0: 'Not available', 20: 'WIG', 21: 'WIG – Hazardous A', 22: 'WIG – Hazardous B',
  23: 'WIG – Hazardous C', 24: 'WIG – Hazardous D', 30: 'Fishing', 31: 'Towing',
  32: 'Towing (large)', 33: 'Dredging', 34: 'Diving ops', 35: 'Military ops',
  36: 'Sailing', 37: 'Pleasure craft', 40: 'HSC', 50: 'Pilot vessel',
  51: 'SAR vessel', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution',
  55: 'Law enforcement', 58: 'Medical transport', 59: 'Non-combatant ship',
  60: 'Passenger', 61: 'Passenger – Hazardous A', 62: 'Passenger – Hazardous B',
  63: 'Passenger – Hazardous C', 64: 'Passenger – Hazardous D', 69: 'Passenger (other)',
  70: 'Cargo', 71: 'Cargo – Hazardous A', 72: 'Cargo – Hazardous B',
  73: 'Cargo – Hazardous C', 74: 'Cargo – Hazardous D', 79: 'Cargo (other)',
  80: 'Tanker', 81: 'Tanker – Hazardous A', 82: 'Tanker – Hazardous B',
  83: 'Tanker – Hazardous C', 84: 'Tanker – Hazardous D', 89: 'Tanker (other)',
  90: 'Other', 99: 'Other',
}

export class VesselInfoPanel {
  private panel: HTMLElement
  private vesselTracker: { get(mmsi: number): VesselState | undefined }
  private currentMmsi: number | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(vesselTracker: { get(mmsi: number): VesselState | undefined }) {
    this.vesselTracker = vesselTracker
    this.panel = document.getElementById('vessel-info')!

    EventBus.on<number>(Events.VESSEL_SELECTED, mmsi => this.show(mmsi))
    EventBus.on<number>(Events.VESSEL_DESELECTED, () => this.hide())
    EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => {
      if (v.mmsi === this.currentMmsi) this.render(v)
    })
  }

  private show(mmsi: number): void {
    this.currentMmsi = mmsi
    const v = this.vesselTracker.get(mmsi)
    if (v) this.render(v)
    this.panel.classList.remove('hidden')
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = setInterval(() => {
      if (this.currentMmsi !== null) {
        const sv = this.vesselTracker.get(this.currentMmsi)
        if (sv) this.render(sv)
      }
    }, 5000)
  }

  hide(): void {
    this.currentMmsi = null
    this.panel.classList.add('hidden')
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null }
  }

  private render(v: VesselState): void {
    const ago       = Math.round((Date.now() - v.lastUpdate) / 1000)
    const heading   = v.trueHeading !== 511 ? `${v.trueHeading}°` : `COG ${v.cog.toFixed(0)}°`
    const draughtM  = v.draught > 0 ? `${(v.draught / 10).toFixed(1)} m` : 'N/A'
    const statusLabel = NAV_STATUS_LABEL[v.navStatus] ?? v.navStatus
    const shipTypeName = SHIP_TYPE_NAME[v.shipType] ?? `Type ${v.shipType}`

    // Destination port info
    const port = lookupPort(v.destination)
    const destDisplay = port
      ? `${escHtml(v.destination)} (${escHtml(port.name)})`
      : (v.destination ? escHtml(v.destination) : 'N/A')
    const continentDisplay = port ? CONTINENT_LABELS[port.continent] : '—'

    // Color swatch for destination continent
    const col = destColor(v.destination)
    const colHex = '#' + col.toString(16).padStart(6, '0')

    // History stats
    const hist = v.history
    const histCount = hist.length
    const avgSog = histCount > 0
      ? (hist.reduce((s, h) => s + h.sog, 0) / histCount).toFixed(1)
      : '—'
    const maxSog = histCount > 0
      ? Math.max(...hist.map(h => h.sog)).toFixed(1)
      : '—'

    // Bearing to destination
    let bearingStr = '—'
    if (port) {
      const b = bearing(v.lat, v.lon, port.lat, port.lon)
      const distKm = haversineKm(v.lat, v.lon, port.lat, port.lon)
      bearingStr = `${b.toFixed(0)}° · ${distKm < 1000 ? distKm.toFixed(0) + ' km' : (distKm / 1852).toFixed(0) + ' nm'}`
    }

    // ETA estimation (rough: distance / avg speed)
    let etaStr = '—'
    if (port && v.sog > 0.5) {
      const distNm = haversineKm(v.lat, v.lon, port.lat, port.lon) / 1.852
      const etaHours = distNm / v.sog
      if (etaHours < 24) {
        etaStr = `~${etaHours.toFixed(0)} h`
      } else {
        etaStr = `~${(etaHours / 24).toFixed(1)} d`
      }
    }

    this.panel.innerHTML = `
      <div class="info-hdr">
        <div style="flex:1;min-width:0">
          <div class="info-name">${escHtml(v.name) || 'UNKNOWN VESSEL'}</div>
          <div class="info-sub">${shipTypeName.toUpperCase()} · MMSI ${v.mmsi}</div>
        </div>
        <button class="info-close" id="info-close-btn">✕</button>
      </div>

      <!-- Ship photo (multi-source fallback) -->
      <div id="ship-photo-wrap" class="ship-photo-wrap" style="display:none">
        <img id="ship-photo" class="ship-photo" alt="Vessel photo" />
        <div class="ship-photo-caption">
          <span>${escHtml(v.name)}</span>
          <span id="ship-photo-src" style="color:var(--c-muted)">loading…</span>
        </div>
      </div>

      <!-- Position & motion -->
      <div class="info-section-hdr">POSITION &amp; MOTION</div>
      <div class="info-grid">
        <div class="info-cell"><span class="info-lbl">LAT</span><span class="info-val">${v.lat.toFixed(5)}°</span></div>
        <div class="info-cell"><span class="info-lbl">LON</span><span class="info-val">${v.lon.toFixed(5)}°</span></div>
        <div class="info-cell"><span class="info-lbl">SOG</span><span class="info-val accent">${v.sog.toFixed(1)} kn</span></div>
        <div class="info-cell"><span class="info-lbl">COG</span><span class="info-val">${v.cog.toFixed(0)}°</span></div>
        <div class="info-cell"><span class="info-lbl">HEADING</span><span class="info-val">${heading}</span></div>
        <div class="info-cell"><span class="info-lbl">ROT</span><span class="info-val">${v.rot !== 0 ? v.rot + '°/min' : 'Steady'}</span></div>
      </div>

      <!-- Vessel identity -->
      <div class="info-section-hdr">VESSEL IDENTITY</div>
      <div class="info-grid">
        <div class="info-cell"><span class="info-lbl">CALL SIGN</span><span class="info-val">${escHtml(v.callSign) || 'N/A'}</span></div>
        <div class="info-cell"><span class="info-lbl">SHIP TYPE</span><span class="info-val">${v.shipType}</span></div>
        <div class="info-cell"><span class="info-lbl">CATEGORY</span><span class="info-val">${v.vesselCategory.toUpperCase()}</span></div>
        <div class="info-cell"><span class="info-lbl">STATUS</span><span class="info-val">${statusLabel}</span></div>
        <div class="info-cell info-cell-full"><span class="info-lbl">TYPE NAME</span><span class="info-val">${shipTypeName}</span></div>
        <div class="info-cell"><span class="info-lbl">DRAUGHT</span><span class="info-val">${draughtM}</span></div>
      </div>

      <!-- Destination -->
      <div class="info-section-hdr">DESTINATION</div>
      <div class="info-grid">
        <div class="info-cell info-cell-full">
          <span class="info-lbl">PORT</span>
          <span class="info-val" style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colHex};flex-shrink:0"></span>
            ${destDisplay}
          </span>
        </div>
        <div class="info-cell"><span class="info-lbl">CONTINENT</span><span class="info-val">${continentDisplay}</span></div>
        <div class="info-cell"><span class="info-lbl">BEARING/DIST</span><span class="info-val">${bearingStr}</span></div>
        <div class="info-cell info-cell-full"><span class="info-lbl">EST. ARRIVAL</span><span class="info-val accent">${etaStr}</span></div>
      </div>

      <!-- Track history -->
      <div class="info-section-hdr">TRACK HISTORY (${histCount} pts)</div>
      <div class="info-grid">
        <div class="info-cell"><span class="info-lbl">AVG SOG</span><span class="info-val">${avgSog} kn</span></div>
        <div class="info-cell"><span class="info-lbl">MAX SOG</span><span class="info-val">${maxSog} kn</span></div>
        <div class="info-cell info-cell-full">
          <span class="info-lbl">MINI-TRACK (last ${Math.min(histCount, 20)} updates)</span>
          <div class="mini-track">
            ${sparkline(hist.slice(-20).map(h => h.sog))}
          </div>
        </div>
      </div>

      <div class="info-footer">Updated ${ago}s ago · ${new Date(v.lastUpdate).toUTCString().slice(17, 25)} UTC</div>
    `

    document.getElementById('info-close-btn')!.onclick = () => {
      this.hide()
      EventBus.emit(Events.VESSEL_DESELECTED, this.currentMmsi ?? 0)
    }

    // Try photo sources in sequence
    loadShipPhoto(v.mmsi)
  }
}

/** Try each photo URL in turn; show wrap only when one succeeds. */
function loadShipPhoto(mmsi: number): void {
  const wrap   = document.getElementById('ship-photo-wrap') as HTMLDivElement | null
  const img    = document.getElementById('ship-photo') as HTMLImageElement | null
  const srcLbl = document.getElementById('ship-photo-src')
  if (!wrap || !img) return

  const sources = PHOTO_SOURCES(mmsi)
  let idx = 0

  function tryNext(): void {
    if (idx >= sources.length) {
      wrap!.style.display = 'none'   // all failed
      return
    }
    const url = sources[idx++]
    img!.onload  = () => {
      wrap!.style.display = 'block'
      if (srcLbl) srcLbl.textContent = new URL(url).hostname
    }
    img!.onerror = () => tryNext()
    img!.src = url
  }

  tryNext()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Inline SVG sparkline for SOG history */
function sparkline(values: number[]): string {
  if (values.length < 2) return '<span style="color:var(--c-muted)">—</span>'
  const W = 240, H = 28
  const max = Math.max(...values, 0.1)
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - (v / max) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return `<svg width="${W}" height="${H}" style="display:block;overflow:visible">
    <polyline points="${pts}" fill="none" stroke="var(--c-accent)" stroke-width="1.5" stroke-linejoin="round"/>
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--c-border)" stroke-width="0.5"/>
  </svg>`
}
