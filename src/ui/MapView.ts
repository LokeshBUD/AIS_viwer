import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import type { FilterState } from './FilterPanel'
import { KNOWN_FILTER_STATUSES } from './FilterPanel'
import { VesselMeshFactory } from '../scene/VesselMeshFactory'
import { PORTS_LIST, CONTINENT_COLORS, lookupPort } from '../utils/ports'
import { maritimeRoute } from '../utils/maritimeRoute'
import { destColor } from '../utils/destColor'
import { makeVesselDivIcon, updateVesselIconTransform, setVesselMarkerState } from './VesselIcon'

const TILE_VOYAGER  = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_SAT_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_SAT_LBLS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'

const MIN_ZOOM  = Math.max(2, Math.ceil(Math.log2(window.innerWidth / 256)))
const ICON_ZOOM = 8   // zoom level at which canvas → divIcon switch happens

// Visual state type used across both marker types
type VisState = 'normal' | 'selected' | 'dimmed' | 'hidden'
type AnyMarker = L.CircleMarker | L.Marker

// Canvas styles per state
const CS: Record<VisState, L.CircleMarkerOptions> = {
  normal:   { radius: 4, fillOpacity: 0.85, weight: 1.2, opacity: 1.0 },
  selected: { radius: 8, fillOpacity: 1.0,  weight: 2.5, opacity: 1.0 },
  dimmed:   { radius: 3, fillOpacity: 0.15, weight: 0.5, opacity: 0.4 },
  hidden:   { radius: 0, fillOpacity: 0,    weight: 0,   opacity: 0.0 },
}

export class MapView {
  private map: L.Map | null = null
  private container: HTMLDivElement

  // Active markers — either L.CircleMarker (canvas mode) or L.Marker (icon mode)
  private markers    = new Map<number, AnyMarker>()
  // Desired visual state per vessel (persists across mode switches)
  private visStates  = new Map<number, VisState>()
  // All vessel data — kept regardless of marker type or viewport
  private states     = new Map<number, VesselState>()

  private routeLine:    L.Polyline | null = null
  private historyLines: L.Polyline[] = []
  private selectedMmsi: number | null = null
  private renderer!:    L.Canvas          // canvas for port markers + polylines
  private iconMode      = false

  private pending    = new Map<number, VesselState>()
  private flushId:   ReturnType<typeof setInterval> | null = null
  private subs:      Array<() => void> = []
  private baseLayer:    L.TileLayer | null = null
  private lblLayer:     L.TileLayer | null = null
  private satMode       = true
  private modeBtn:      HTMLButtonElement | null = null
  private activeFilter: FilterState | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'map-container'
    document.body.appendChild(this.container)
  }

  start(allVessels: ReadonlyMap<number, VesselState>, onCoords?: (lat: number, lon: number) => void): void {
    this.renderer = L.canvas({ padding: 0.5 })

    this.map = L.map(this.container, {
      center:              [20, 0],
      zoom:                Math.max(MIN_ZOOM, 3),
      minZoom:             MIN_ZOOM,
      maxZoom:             14,
      zoomControl:         false,
      preferCanvas:        true,
      worldCopyJump:       true,
      zoomSnap:            0.5,
      zoomDelta:           1,
      wheelPxPerZoomLevel: 60,
      wheelDebounceTime:   40,
    })

    this.baseLayer = L.tileLayer(TILE_SAT_BASE, {
      attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
      maxZoom: 14, keepBuffer: 4,
    }).addTo(this.map)
    this.lblLayer = L.tileLayer(TILE_SAT_LBLS, {
      attribution: '', subdomains: 'abcd', maxZoom: 14, keepBuffer: 4, opacity: 0.85,
    }).addTo(this.map)

    L.control.zoom({ position: 'bottomright' }).addTo(this.map)
    this.addModeButton()

    if (onCoords) {
      this.map.on('mousemove', (e: L.LeafletMouseEvent) => onCoords(e.latlng.lat, e.latlng.lng))
    }
    this.map.on('click', () => { if (this.selectedMmsi !== null) this.deselect() })

    // Mode switching on zoom, viewport refresh on pan (icon mode only)
    this.map.on('zoomend', () => this.onZoomChange())
    this.map.on('moveend', () => { if (this.iconMode) this.refreshIconViewport() })

    this.buildPortMarkers()

    for (const v of allVessels.values()) this.upsert(v)

    this.subs.push(
      EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => { this.pending.set(v.mmsi, v) }),
      EventBus.on<number>(Events.VESSEL_LOST, mmsi => {
        this.pending.delete(mmsi)
        this.states.delete(mmsi)
        this.visStates.delete(mmsi)
        const m = this.markers.get(mmsi)
        if (m) { m.remove(); this.markers.delete(mmsi) }
        if (this.selectedMmsi === mmsi) this.deselect()
      }),
      EventBus.on<number>(Events.VESSEL_SELECTED, mmsi => this.selectVessel(mmsi)),
      EventBus.on<number>(Events.VESSEL_DESELECTED, () => this.deselect()),
    )

    this.flushId = setInterval(() => {
      if (!this.map || this.pending.size === 0) return
      for (const v of this.pending.values()) this.upsert(v)
      if (this.selectedMmsi !== null && this.pending.has(this.selectedMmsi)) {
        this.drawHistoryTrail(this.selectedMmsi)
      }
      this.pending.clear()
    }, 200)
  }

  // ── Zoom / mode switching ─────────────────────────────────────────────────────

  private onZoomChange(): void {
    if (!this.map) return
    const zoom = this.map.getZoom()
    if (zoom >= ICON_ZOOM && !this.iconMode) {
      this.switchToIconMode()
    } else if (zoom < ICON_ZOOM && this.iconMode) {
      this.switchToCanvasMode()
    } else if (this.iconMode) {
      this.refreshIconViewport()
    }
  }

  private switchToIconMode(): void {
    if (!this.map) return
    this.iconMode = true
    // Remove all canvas markers
    for (const m of this.markers.values()) m.remove()
    this.markers.clear()
    // Create divIcon markers for in-viewport vessels only
    const bounds = this.map.getBounds()
    for (const v of this.states.values()) {
      if (bounds.contains([v.lat, v.lon])) this.createIconMarker(v)
    }
  }

  private switchToCanvasMode(): void {
    if (!this.map) return
    this.iconMode = false
    // Remove all icon markers
    for (const m of this.markers.values()) m.remove()
    this.markers.clear()
    // Re-create canvas markers for ALL vessels
    for (const v of this.states.values()) this.createCanvasMarker(v)
  }

  /** Add icon markers for newly visible vessels, remove for out-of-viewport */
  private refreshIconViewport(): void {
    if (!this.map) return
    const bounds = this.map.getBounds()
    // Remove markers that scrolled out
    for (const [mmsi, m] of this.markers) {
      const v = this.states.get(mmsi)
      if (!v || !bounds.contains([v.lat, v.lon])) {
        m.remove()
        this.markers.delete(mmsi)
      }
    }
    // Add markers for vessels now in view
    for (const v of this.states.values()) {
      if (!this.markers.has(v.mmsi) && bounds.contains([v.lat, v.lon])) {
        this.createIconMarker(v)
      }
    }
  }

  // ── Marker creation ───────────────────────────────────────────────────────────

  private vesselColor(v: VesselState): string {
    return '#' + VesselMeshFactory.getColor(v.vesselCategory).toString(16).padStart(6, '0')
  }

  private createCanvasMarker(v: VesselState): void {
    if (!this.map) return
    const hex   = this.vesselColor(v)
    const state = this.visStates.get(v.mmsi) ?? 'normal'
    const m = L.circleMarker([v.lat, v.lon] as L.LatLngExpression, {
      ...CS[state],
      color:     hex,
      fillColor: hex,
      renderer:  this.renderer,
    })
    m.bindPopup(() => this.popupHtml(v), { maxWidth: 240, className: 'ais-popup' })
    m.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e)
      EventBus.emit(Events.VESSEL_SELECTED, v.mmsi)
    })
    m.addTo(this.map)
    this.markers.set(v.mmsi, m)
  }

  private createIconMarker(v: VesselState): void {
    if (!this.map) return
    const hex   = this.vesselColor(v)
    const state = this.visStates.get(v.mmsi) ?? 'normal'
    const m = L.marker([v.lat, v.lon] as L.LatLngExpression, {
      icon:        makeVesselDivIcon(v.vesselCategory, hex, v.cog),
      interactive: true,
    })
    m.bindPopup(() => this.popupHtml(v), { maxWidth: 240, className: 'ais-popup' })
    m.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e)
      EventBus.emit(Events.VESSEL_SELECTED, v.mmsi)
    })
    m.addTo(this.map)
    this.markers.set(v.mmsi, m)
    setVesselMarkerState(m, state)
  }

  // ── Unified state setter ──────────────────────────────────────────────────────

  private setMarkerState(mmsi: number, state: VisState): void {
    this.visStates.set(mmsi, state)
    const m = this.markers.get(mmsi)
    if (!m) return
    if (m instanceof L.CircleMarker) {
      m.setStyle(CS[state])
    } else {
      setVesselMarkerState(m as L.Marker, state)
    }
  }

  // ── Vessel selection ──────────────────────────────────────────────────────────

  private selectVessel(mmsi: number): void {
    if (this.selectedMmsi === mmsi) return
    if (this.selectedMmsi !== null) this.clearSelection()

    this.selectedMmsi = mmsi

    for (const m of this.visStates.keys()) {
      this.setMarkerState(m, m === mmsi ? 'selected' : 'dimmed')
    }

    const sel = this.markers.get(mmsi)
    if (sel) {
      sel.openPopup()
      this.map?.panTo(sel.getLatLng(), { animate: true, duration: 0.5 })
    }

    this.drawRoute(mmsi)
    this.drawHistoryTrail(mmsi)
  }

  private deselect(): void {
    if (this.selectedMmsi === null) return
    this.clearSelection()
    EventBus.emit(Events.VESSEL_DESELECTED, null)
  }

  private clearSelection(): void {
    this.selectedMmsi = null
    this.clearRoute()
    this.clearHistoryTrail()
    for (const mmsi of this.visStates.keys()) this.setMarkerState(mmsi, 'normal')
  }

  // ── Filter ────────────────────────────────────────────────────────────────────

  applyFilter(filter: FilterState): void {
    this.activeFilter = filter
    for (const [mmsi, state] of this.states) {
      const vis = !this.passesFilter(state, filter) ? 'hidden'
        : this.selectedMmsi === mmsi ? 'selected'
        : this.selectedMmsi !== null ? 'dimmed'
        : 'normal'
      this.setMarkerState(mmsi, vis)
    }
  }

  private passesFilter(state: VesselState, f: FilterState): boolean {
    if (!f.categories.has(state.vesselCategory)) return false
    if (KNOWN_FILTER_STATUSES.has(state.navStatus) && !f.statuses.has(state.navStatus)) return false
    if (f.maxSog < 31 && state.sog > f.maxSog) return false
    return true
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  search(query: string): void {
    if (!query) {
      if (this.selectedMmsi === null) {
        for (const mmsi of this.visStates.keys()) this.setMarkerState(mmsi, 'normal')
      }
      return
    }

    const q = query.toLowerCase()
    const matches: number[] = []

    for (const [mmsi] of this.markers) {
      const state    = this.states.get(mmsi)
      const nameHit  = state?.name.toLowerCase().includes(q)
      const mmsiHit  = mmsi.toString().includes(q)
      if (nameHit || mmsiHit) {
        this.setMarkerState(mmsi, 'normal')
        matches.push(mmsi)
      } else {
        this.setMarkerState(mmsi, 'dimmed')
      }
    }

    if (matches.length === 1) this.selectVessel(matches[0])
  }

  // ── Route line ────────────────────────────────────────────────────────────────

  private drawRoute(mmsi: number): void {
    this.clearRoute()
    const state = this.states.get(mmsi)
    if (!state) return
    const port = lookupPort(state.destination)
    if (!port) return
    const col = '#' + destColor(state.destination).toString(16).padStart(6, '0')
    this.routeLine = L.polyline(
      maritimeRoute(state.lat, state.lon, port.lat, port.lon).map(w => [w.lat, w.lon] as L.LatLngExpression),
      { color: col, weight: 2.5, opacity: 0.8, dashArray: '8 6', interactive: false, renderer: this.renderer },
    ).addTo(this.map!)
  }

  private clearRoute(): void { this.routeLine?.remove(); this.routeLine = null }

  // ── History trail ─────────────────────────────────────────────────────────────

  private drawHistoryTrail(mmsi: number): void {
    this.clearHistoryTrail()
    const state = this.states.get(mmsi)
    if (!state || state.history.length < 2) return

    const pts       = state.history.map(h => [h.lat, h.lon] as L.LatLngExpression)
    const CHUNKS    = 5
    const chunkSize = Math.max(1, Math.ceil(pts.length / CHUNKS))
    const opacities = [0.12, 0.25, 0.42, 0.62, 1.0]

    for (let i = 0; i < CHUNKS; i++) {
      const seg = pts.slice(i * chunkSize, Math.min((i + 1) * chunkSize + 1, pts.length))
      if (seg.length < 2) continue
      const line = L.polyline(seg, {
        color: '#00d4ff', weight: 2, opacity: opacities[i],
        interactive: false, renderer: this.renderer,
      }).addTo(this.map!)
      this.historyLines.push(line)
    }
  }

  private clearHistoryTrail(): void {
    for (const l of this.historyLines) l.remove()
    this.historyLines = []
  }

  // ── Vessel upsert ─────────────────────────────────────────────────────────────

  private upsert(vessel: VesselState): void {
    if (!this.map) return
    this.states.set(vessel.mmsi, vessel)

    // Ensure desired vis state exists
    if (!this.visStates.has(vessel.mmsi)) {
      const state = this.selectedMmsi !== null && this.selectedMmsi !== vessel.mmsi ? 'dimmed'
        : this.selectedMmsi === vessel.mmsi ? 'selected'
        : 'normal'
      this.visStates.set(vessel.mmsi, state)
    }

    const hex = this.vesselColor(vessel)
    const m   = this.markers.get(vessel.mmsi)

    if (!m) {
      // In icon mode: only create marker if vessel is in viewport
      if (this.iconMode) {
        const bounds = this.map.getBounds()
        if (bounds.contains([vessel.lat, vessel.lon])) this.createIconMarker(vessel)
      } else {
        this.createCanvasMarker(vessel)
      }
    } else {
      // Update existing marker in place
      m.setLatLng([vessel.lat, vessel.lon])
      if (m instanceof L.CircleMarker) {
        m.setStyle({ color: hex, fillColor: hex })
      } else {
        updateVesselIconTransform(m as L.Marker, hex, vessel.cog)
      }
    }

    // Re-apply filter if active
    if (this.activeFilter && !this.passesFilter(vessel, this.activeFilter)) {
      this.setMarkerState(vessel.mmsi, 'hidden')
    }
  }

  // ── Port markers ──────────────────────────────────────────────────────────────

  private buildPortMarkers(): void {
    if (!this.map) return
    for (const port of PORTS_LIST) {
      const hex = '#' + CONTINENT_COLORS[port.continent].toString(16).padStart(6, '0')
      const m = L.circleMarker([port.lat, port.lon] as L.LatLngExpression, {
        radius: 5, color: '#ffffff', fillColor: hex,
        fillOpacity: 0.9, weight: 1.5, renderer: this.renderer,
      })
      m.bindTooltip(
        `<b>${port.name}</b><br><span style="color:${hex};font-size:9px;letter-spacing:1px">${port.code}</span>`,
        { direction: 'right', className: 'port-tooltip', offset: [6, 0] },
      )
      m.addTo(this.map)
    }
  }

  // ── Satellite toggle ──────────────────────────────────────────────────────────

  private addModeButton(): void {
    const btn = document.createElement('button')
    btn.className   = 'map-mode-btn active'
    btn.textContent = 'MAP VIEW'
    btn.addEventListener('click', e => { e.stopPropagation(); this.toggleMode() })
    this.container.appendChild(btn)
    this.modeBtn = btn
  }

  private toggleMode(): void {
    if (!this.map) return
    this.satMode = !this.satMode
    this.baseLayer?.remove(); this.lblLayer?.remove(); this.lblLayer = null

    if (this.satMode) {
      this.baseLayer = L.tileLayer(TILE_SAT_BASE, {
        attribution: '&copy; <a href="https://www.esri.com">Esri</a>', maxZoom: 14, keepBuffer: 4,
      }).addTo(this.map)
      this.lblLayer = L.tileLayer(TILE_SAT_LBLS, {
        attribution: '', subdomains: 'abcd', maxZoom: 14, keepBuffer: 4, opacity: 0.85,
      }).addTo(this.map)
      if (this.modeBtn) { this.modeBtn.textContent = 'MAP VIEW'; this.modeBtn.classList.add('active') }
    } else {
      this.baseLayer = L.tileLayer(TILE_VOYAGER, {
        attribution: '&copy; <a href="https://carto.com">CartoDB</a> contributors',
        subdomains: 'abcd', maxZoom: 14, keepBuffer: 4,
      }).addTo(this.map)
      if (this.modeBtn) { this.modeBtn.textContent = 'SATELLITE'; this.modeBtn.classList.remove('active') }
    }
  }

  // ── Popup ─────────────────────────────────────────────────────────────────────

  private popupHtml(v: VesselState): string {
    return `
      <div class="ais-popup-inner">
        <div class="ais-popup-name">${esc(v.name)}</div>
        <div class="ais-popup-sub">${v.vesselCategory.toUpperCase()} · MMSI ${v.mmsi}</div>
        <div class="ais-popup-grid">
          <span>SOG</span><span>${v.sog.toFixed(1)} kn</span>
          <span>COG</span><span>${v.cog.toFixed(0)}°</span>
          <span>STATUS</span><span>${v.navStatus}</span>
          <span>DEST</span><span>${v.destination || '—'}</span>
        </div>
        <div class="ais-popup-coord">${v.lat.toFixed(5)}°, ${v.lon.toFixed(5)}°</div>
      </div>
    `
  }

  destroy(): void {
    if (this.flushId) clearInterval(this.flushId)
    this.subs.forEach(u => u())
    this.map?.remove()
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
