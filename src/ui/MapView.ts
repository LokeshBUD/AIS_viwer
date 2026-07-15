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
const ICON_ZOOM = 8   // zoom ≥ this → SVG ship icons; below → cluster bubbles

// Cell size in degrees — halves every 2 zoom levels so each zoom-in splits clusters by ~2, not 4
// zoom 2-3→20°, 4-5→10°, 6-7→5°
function clusterCellDeg(zoom: number): number {
  return 20 / Math.pow(2, Math.max(0, Math.floor((zoom - 2) / 2)))
}

type VisState = 'normal' | 'selected' | 'dimmed' | 'hidden'
type MapMode   = 'cluster' | 'icon'


export class MapView {
  private map: L.Map | null = null
  private container: HTMLDivElement

  // Individual vessel icon markers — only used in icon mode (zoom ≥ 8)
  private markers       = new Map<number, L.Marker>()
  // Cluster bubble markers — only used in cluster mode
  private clusterMarkers: L.Marker[] = []
  // Desired visual state per vessel (persists across mode switches)
  private visStates     = new Map<number, VisState>()
  // All vessel data — kept regardless of mode or viewport
  private states        = new Map<number, VesselState>()

  private routeLine:    L.Polyline | null = null
  private historyLines: L.Polyline[] = []
  private selectedMmsi: number | null = null
  private renderer!:    L.Canvas          // canvas for port markers + polylines
  private mode:         MapMode = 'cluster'

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

    const initialZoom = Math.max(MIN_ZOOM, 3)
    this.mode = initialZoom >= ICON_ZOOM ? 'icon' : 'cluster'

    this.map = L.map(this.container, {
      center:              [20, 0],
      zoom:                initialZoom,
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
    this.map.on('zoomend', () => this.onZoomChange())
    this.map.on('moveend', () => {
      if (this.mode === 'icon')    this.refreshIconViewport()
      if (this.mode === 'cluster') this.buildClusters()
    })

    this.buildPortMarkers()

    // Populate state; markers created only for non-cluster modes
    for (const v of allVessels.values()) this.upsert(v)
    if (this.mode === 'cluster') this.buildClusters()

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

    if (zoom >= ICON_ZOOM && this.mode !== 'icon') {
      this.switchToIconMode()
    } else if (zoom < ICON_ZOOM && this.mode !== 'cluster') {
      this.switchToClusterMode()
    } else if (this.mode === 'icon') {
      this.refreshIconViewport()
    } else {
      this.buildClusters()  // cell size changes every zoom level
    }
  }

  private switchToClusterMode(): void {
    this.mode = 'cluster'
    // Remove individual icon markers left from icon mode, except the
    // selected vessel — it stays visible as its own marker while everything
    // else clusters into bubbles.
    for (const [mmsi, m] of this.markers) {
      if (mmsi !== this.selectedMmsi) m.remove()
    }
    if (this.selectedMmsi === null) this.markers.clear()
    else {
      const sel = this.markers.get(this.selectedMmsi)
      this.markers.clear()
      if (sel) this.markers.set(this.selectedMmsi, sel)
    }
    this.buildClusters()
  }

  private switchToIconMode(): void {
    if (!this.map) return
    this.mode = 'icon'
    this.clearClusters()
    const bounds = this.map.getBounds()
    for (const v of this.states.values()) {
      // Selected vessel may already have a marker from cluster mode — don't duplicate it.
      if (!this.markers.has(v.mmsi) && bounds.contains([v.lat, v.lon])) this.createIconMarker(v)
    }
  }

  // ── Cluster mode ──────────────────────────────────────────────────────────────

  /** Selected vessel keeps its own marker even while clustered — create it if missing. */
  private ensureSelectedMarker(): void {
    if (this.selectedMmsi === null || this.mode !== 'cluster') return
    if (this.markers.has(this.selectedMmsi)) return
    const state = this.states.get(this.selectedMmsi)
    if (state) this.createIconMarker(state)
  }

  private buildClusters(): void {
    if (!this.map) return
    this.clearClusters()

    const zoom    = this.map.getZoom()
    const cellDeg = clusterCellDeg(zoom)
    // Pad bounds so cells near edge still appear
    const bounds  = this.map.getBounds().pad(0.15)

    interface Cell { count: number; lat: number; lon: number; colorCounts: Map<string, number> }
    const cells = new Map<string, Cell>()

    for (const v of this.states.values()) {
      // Selected vessel gets its own marker (see ensureSelectedMarker) — don't
      // also fold it into a cluster bubble.
      if (v.mmsi === this.selectedMmsi) continue
      const row = Math.floor(v.lat / cellDeg)
      const col = Math.floor(v.lon / cellDeg)
      const centerLat = (row + 0.5) * cellDeg
      const centerLon = (col + 0.5) * cellDeg
      // Skip cells whose center is outside the padded viewport
      if (!bounds.contains([centerLat, centerLon] as L.LatLngExpression)) continue

      const key = `${row}:${col}`
      if (!cells.has(key)) {
        cells.set(key, { count: 0, lat: centerLat, lon: centerLon, colorCounts: new Map() })
      }
      const cell = cells.get(key)!
      cell.count++
      const color = this.vesselColor(v)
      cell.colorCounts.set(color, (cell.colorCounts.get(color) ?? 0) + 1)
    }

    const targetZoom = Math.min(zoom + 2, ICON_ZOOM)

    for (const cell of cells.values()) {
      // Dominant color = most common vessel category in this cell
      let dominantColor = '#4a9eff'
      let maxCount = 0
      for (const [color, n] of cell.colorCounts) {
        if (n > maxCount) { maxCount = n; dominantColor = color }
      }

      const label = cell.count >= 1000 ? `${(cell.count / 1000).toFixed(1)}k` : cell.count.toString()
      const size  = cell.count > 200 ? 44 : cell.count > 50 ? 36 : 26

      const icon = L.divIcon({
        html:       `<div class="vessel-cluster" style="width:${size}px;height:${size}px;border-color:${dominantColor}80"><span>${label}</span></div>`,
        className:  '',
        iconSize:   [size, size],
        iconAnchor: [size / 2, size / 2],
      })

      const m = L.marker([cell.lat, cell.lon] as L.LatLngExpression, { icon, interactive: true })
      m.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        this.map?.flyTo([cell.lat, cell.lon], targetZoom, { duration: 0.5 })
      })
      m.addTo(this.map!)
      this.clusterMarkers.push(m)
    }

    this.ensureSelectedMarker()
  }

  private clearClusters(): void {
    for (const m of this.clusterMarkers) m.remove()
    this.clusterMarkers = []
  }

  // ── Icon viewport refresh ─────────────────────────────────────────────────────

  private refreshIconViewport(): void {
    if (!this.map) return
    const bounds = this.map.getBounds()
    for (const [mmsi, m] of this.markers) {
      const v = this.states.get(mmsi)
      if (!v || !bounds.contains([v.lat, v.lon])) {
        m.remove()
        this.markers.delete(mmsi)
      }
    }
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
    setVesselMarkerState(m as L.Marker, state)
  }

  // ── Vessel selection ──────────────────────────────────────────────────────────

  private selectVessel(mmsi: number): void {
    if (this.selectedMmsi === mmsi) return
    if (this.selectedMmsi !== null) this.clearSelection()

    this.selectedMmsi = mmsi

    for (const m of this.visStates.keys()) {
      this.setMarkerState(m, m === mmsi ? 'selected' : 'dimmed')
    }

    const sel   = this.markers.get(mmsi)
    const state = this.states.get(mmsi)
    if (sel) {
      sel.openPopup()
      this.map?.panTo(sel.getLatLng(), { animate: true, duration: 0.5 })
    } else if (state && this.map) {
      // Cluster mode or vessel outside viewport — fly in to icon zoom so vessel becomes visible
      const targetZoom = Math.max(this.map.getZoom(), ICON_ZOOM)
      this.map.flyTo([state.lat, state.lon], targetZoom, { duration: 0.7 })
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
    const prevMmsi = this.selectedMmsi
    this.selectedMmsi = null
    this.clearRoute()
    this.clearHistoryTrail()
    for (const mmsi of this.visStates.keys()) this.setMarkerState(mmsi, 'normal')

    // In cluster mode the selected vessel had its own marker exempted from
    // clustering — drop it and fold the vessel back into a cluster bubble.
    if (this.mode === 'cluster' && prevMmsi !== null) {
      const m = this.markers.get(prevMmsi)
      if (m) { m.remove(); this.markers.delete(prevMmsi) }
      this.buildClusters()
    }
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

    const pts: [number, number][] = state.history.map(h => [h.lat, h.lon])
    // Always close the gap to the vessel's live position — a history snapshot
    // can lag behind the marker by one AIS report if the vessel is mid-move
    // when the trail redraws.
    const lastPt = pts[pts.length - 1]
    if (!lastPt || lastPt[0] !== state.lat || lastPt[1] !== state.lon) {
      pts.push([state.lat, state.lon])
    }
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

    // In cluster mode individual markers aren't used (clusters rebuild on zoom/pan)
    // except for the selected vessel, which keeps its own live-updating marker.
    if (this.mode === 'cluster' && vessel.mmsi !== this.selectedMmsi) return

    const hex = this.vesselColor(vessel)
    const m   = this.markers.get(vessel.mmsi)

    if (!m) {
      // Icon mode: only create marker if vessel is in viewport.
      // Cluster mode: always create it — it's the exempted selected vessel.
      const bounds = this.map.getBounds()
      if (this.mode === 'cluster' || bounds.contains([vessel.lat, vessel.lon])) {
        this.createIconMarker(vessel)
      }
    } else {
      m.setLatLng([vessel.lat, vessel.lon])
      updateVesselIconTransform(m, hex, vessel.cog)
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
