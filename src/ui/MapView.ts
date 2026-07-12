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

const TILE_VOYAGER  = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_SAT_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_SAT_LBLS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'

// Minimum zoom so world never appears smaller than the viewport (no repeat tiles)
const MIN_ZOOM = Math.max(2, Math.ceil(Math.log2(window.innerWidth / 256)))

// Vessel circle styles
const V_NORMAL   = { radius: 4,  fillOpacity: 0.85, weight: 1.2, opacity: 1.0 }
const V_SELECTED = { radius: 8,  fillOpacity: 1.0,  weight: 2.5, opacity: 1.0 }
const V_DIMMED   = { radius: 3,  fillOpacity: 0.15, weight: 0.5, opacity: 0.4 }

export class MapView {
  private map: L.Map | null = null
  private container: HTMLDivElement
  private markers    = new Map<number, L.CircleMarker>()
  private states     = new Map<number, VesselState>()
  private routeLine:    L.Polyline | null = null
  private historyLines: L.Polyline[] = []
  private selectedMmsi: number | null = null
  private renderer!:  L.Canvas
  private pending    = new Map<number, VesselState>()
  private flushId:   ReturnType<typeof setInterval> | null = null
  private subs:      Array<() => void> = []
  private baseLayer:     L.TileLayer | null = null
  private lblLayer:      L.TileLayer | null = null
  private satMode        = true
  private modeBtn:       HTMLButtonElement | null = null
  private activeFilter:  FilterState | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'map-container'
    document.body.appendChild(this.container)
  }

  /**
   * Initialize and show the map. Call once from main.ts.
   * onCoords: fired on mousemove with current lat/lon for HUD display.
   */
  start(allVessels: ReadonlyMap<number, VesselState>, onCoords?: (lat: number, lon: number) => void): void {
    this.renderer = L.canvas({ padding: 0.5 })

    this.map = L.map(this.container, {
      center:              [20, 0],
      zoom:                Math.max(MIN_ZOOM, 3),
      minZoom:             MIN_ZOOM,
      maxZoom:             14,
      zoomControl:         false,   // added manually below with correct position
      preferCanvas:        true,
      worldCopyJump:       true,
      // Smoother, slower zoom
      zoomSnap:            0.5,   // fractional zoom levels — no jarring jumps
      zoomDelta:           1,    // zoom buttons change 0.5 levels at a time
      wheelPxPerZoomLevel: 60,    // 120px scroll = 1 zoom level (default 60 = too fast)
      wheelDebounceTime:   40,
    })

    // Start in satellite mode
    this.baseLayer = L.tileLayer(TILE_SAT_BASE, {
      attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
      maxZoom:     14,
      keepBuffer:  4,
    }).addTo(this.map)
    this.lblLayer = L.tileLayer(TILE_SAT_LBLS, {
      attribution: '',
      subdomains:  'abcd',
      maxZoom:     14,
      keepBuffer:  4,
      opacity:     0.85,
    }).addTo(this.map)

    // Zoom control — bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map)

    // Satellite / map toggle button
    this.addModeButton()

    // Coordinate display
    if (onCoords) {
      this.map.on('mousemove', (e: L.LeafletMouseEvent) => onCoords(e.latlng.lat, e.latlng.lng))
    }

    // Click empty map → deselect
    this.map.on('click', () => {
      if (this.selectedMmsi !== null) this.deselect()
    })

    // Port markers
    this.buildPortMarkers()

    // Initial vessels
    for (const v of allVessels.values()) this.upsert(v)

    // Live vessel updates (throttled to 5fps)
    this.subs.push(
      EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => { this.pending.set(v.mmsi, v) }),
      EventBus.on<number>(Events.VESSEL_LOST, mmsi => {
        this.pending.delete(mmsi)
        this.states.delete(mmsi)
        const m = this.markers.get(mmsi)
        if (m) { m.remove(); this.markers.delete(mmsi) }
        if (this.selectedMmsi === mmsi) this.deselect()
      }),
      EventBus.on<number>(Events.VESSEL_SELECTED, mmsi => this.selectVessel(mmsi)),
      EventBus.on<number>(Events.VESSEL_DESELECTED, () => this.deselect()),
    )

    this.flushId = setInterval(() => {
      if (!this.map || this.pending.size === 0) return
      // Upsert ALL pending vessels — no viewport filter.
      // Canvas renderer culls off-screen markers automatically (zero render cost).
      // Filtering by bounds causes stale data when panning to unvisited areas.
      for (const v of this.pending.values()) this.upsert(v)
      // Redraw history trail if selected vessel received new positions
      if (this.selectedMmsi !== null && this.pending.has(this.selectedMmsi)) {
        this.drawHistoryTrail(this.selectedMmsi)
      }
      this.pending.clear()
    }, 200)
  }

  // ── Satellite / map mode toggle ──────────────────────────────────────────────

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

    this.baseLayer?.remove()
    this.lblLayer?.remove()
    this.lblLayer = null

    if (this.satMode) {
      this.baseLayer = L.tileLayer(TILE_SAT_BASE, {
        attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
        maxZoom:    14,
        keepBuffer: 4,
      }).addTo(this.map)
      this.lblLayer = L.tileLayer(TILE_SAT_LBLS, {
        attribution: '',
        subdomains:  'abcd',
        maxZoom:     14,
        keepBuffer:  4,
        opacity:     0.85,
      }).addTo(this.map)
      if (this.modeBtn) { this.modeBtn.textContent = 'MAP VIEW'; this.modeBtn.classList.add('active') }
    } else {
      this.baseLayer = L.tileLayer(TILE_VOYAGER, {
        attribution: '&copy; <a href="https://carto.com">CartoDB</a> contributors',
        subdomains:  'abcd',
        maxZoom:     14,
        keepBuffer:  4,
      }).addTo(this.map)
      if (this.modeBtn) { this.modeBtn.textContent = 'SATELLITE'; this.modeBtn.classList.remove('active') }
    }
  }

  // ── Port markers ─────────────────────────────────────────────────────────────

  private buildPortMarkers(): void {
    if (!this.map) return
    for (const port of PORTS_LIST) {
      const hex = '#' + CONTINENT_COLORS[port.continent].toString(16).padStart(6, '0')
      const m = L.circleMarker([port.lat, port.lon] as L.LatLngExpression, {
        radius:      5,
        color:       '#ffffff',
        fillColor:   hex,
        fillOpacity: 0.9,
        weight:      1.5,
        renderer:    this.renderer,
      })
      m.bindTooltip(
        `<b>${port.name}</b><br><span style="color:${hex};font-size:9px;letter-spacing:1px">${port.code}</span>`,
        { direction: 'right', className: 'port-tooltip', offset: [6, 0] },
      )
      m.addTo(this.map)
    }
  }

  // ── Vessel selection ─────────────────────────────────────────────────────────

  private selectVessel(mmsi: number): void {
    if (this.selectedMmsi === mmsi) return

    // Deselect previous without emitting event (internal only)
    if (this.selectedMmsi !== null) this.clearSelection()

    this.selectedMmsi = mmsi

    // Highlight selected, dim others
    for (const [m, marker] of this.markers) {
      marker.setStyle(m === mmsi ? V_SELECTED : V_DIMMED)
    }

    // Pan to selected
    const sel = this.markers.get(mmsi)
    if (sel) {
      sel.openPopup()
      this.map?.panTo(sel.getLatLng(), { animate: true, duration: 0.5 })
    }

    // Draw route arc + history trail
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
    for (const marker of this.markers.values()) {
      marker.setStyle(V_NORMAL)
    }
  }

  // ── Filter ───────────────────────────────────────────────────────────────────

  applyFilter(filter: FilterState): void {
    this.activeFilter = filter
    for (const [mmsi, marker] of this.markers) {
      const state = this.states.get(mmsi)
      if (!state) continue
      const visible = this.passesFilter(state, filter)
      if (visible) {
        marker.setStyle(
          this.selectedMmsi !== null && this.selectedMmsi !== mmsi ? V_DIMMED
          : this.selectedMmsi === mmsi ? V_SELECTED
          : V_NORMAL,
        )
      } else {
        marker.setStyle({ fillOpacity: 0, opacity: 0, weight: 0 })
      }
    }
  }

  private passesFilter(state: VesselState, f: FilterState): boolean {
    if (!f.categories.has(state.vesselCategory)) return false
    // Only apply status filter for statuses we explicitly show checkboxes for.
    // Vessels with unlisted statuses (e.g. NotDefined, UnderWaySailing) always pass.
    if (KNOWN_FILTER_STATUSES.has(state.navStatus) && !f.statuses.has(state.navStatus)) return false
    if (f.maxSog < 31 && state.sog > f.maxSog)  return false
    return true
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  search(query: string): void {
    if (!query) {
      // Clear search — restore all to normal (respects any active selection)
      if (this.selectedMmsi === null) {
        for (const marker of this.markers.values()) marker.setStyle(V_NORMAL)
      }
      return
    }

    const q = query.toLowerCase()
    const matches: number[] = []

    for (const [mmsi, marker] of this.markers) {
      const state = this.states.get(mmsi)
      const nameMatch = state?.name.toLowerCase().includes(q)
      const mmsiMatch = mmsi.toString().includes(q)
      if (nameMatch || mmsiMatch) {
        marker.setStyle(V_NORMAL)
        matches.push(mmsi)
      } else {
        marker.setStyle(V_DIMMED)
      }
    }

    // Auto-select if exactly one match
    if (matches.length === 1) this.selectVessel(matches[0])
  }

  // ── Route line ───────────────────────────────────────────────────────────────

  private drawRoute(mmsi: number): void {
    this.clearRoute()
    const state = this.states.get(mmsi)
    if (!state) return
    const port = lookupPort(state.destination)
    if (!port) return

    const waypoints = maritimeRoute(state.lat, state.lon, port.lat, port.lon)
    const col = '#' + destColor(state.destination).toString(16).padStart(6, '0')

    this.routeLine = L.polyline(
      waypoints.map(w => [w.lat, w.lon] as L.LatLngExpression),
      { color: col, weight: 2.5, opacity: 0.8, dashArray: '8 6', interactive: false, renderer: this.renderer },
    ).addTo(this.map!)
  }

  private clearRoute(): void {
    this.routeLine?.remove()
    this.routeLine = null
  }

  // ── History trail ─────────────────────────────────────────────────────────────

  private drawHistoryTrail(mmsi: number): void {
    this.clearHistoryTrail()
    const state = this.states.get(mmsi)
    if (!state || state.history.length < 2) return

    const pts = state.history.map(h => [h.lat, h.lon] as L.LatLngExpression)
    const CHUNKS = 5
    const chunkSize = Math.max(1, Math.ceil(pts.length / CHUNKS))
    const opacities = [0.12, 0.25, 0.42, 0.62, 1.0]

    for (let i = 0; i < CHUNKS; i++) {
      const start = i * chunkSize
      const end   = Math.min(start + chunkSize + 1, pts.length) // +1 = overlap for continuity
      const seg   = pts.slice(start, end)
      if (seg.length < 2) continue

      const line = L.polyline(seg, {
        color:       '#00d4ff',
        weight:      2,
        opacity:     opacities[i],
        interactive: false,
        renderer:    this.renderer,
      }).addTo(this.map!)
      this.historyLines.push(line)
    }
  }

  private clearHistoryTrail(): void {
    for (const line of this.historyLines) line.remove()
    this.historyLines = []
  }

  // ── Vessel upsert ─────────────────────────────────────────────────────────────

  private upsert(vessel: VesselState): void {
    if (!this.map) return
    this.states.set(vessel.mmsi, vessel)

    const ll  = [vessel.lat, vessel.lon] as L.LatLngExpression
    const hex = '#' + VesselMeshFactory.getColor(vessel.vesselCategory).toString(16).padStart(6, '0')
    const isDimmed = this.selectedMmsi !== null && this.selectedMmsi !== vessel.mmsi
    const isSelected = this.selectedMmsi === vessel.mmsi

    let m = this.markers.get(vessel.mmsi)
    if (!m) {
      const style = isSelected ? V_SELECTED : isDimmed ? V_DIMMED : V_NORMAL
      m = L.circleMarker(ll, {
        ...style,
        color:       hex,
        fillColor:   hex,
        renderer:    this.renderer,
      })
      m.bindPopup(() => this.popupHtml(vessel), { maxWidth: 240, className: 'ais-popup' })
      m.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        EventBus.emit(Events.VESSEL_SELECTED, vessel.mmsi)
      })
      m.addTo(this.map!)
      this.markers.set(vessel.mmsi, m)
    } else {
      m.setLatLng(ll)
      // Update color in case destination changed
      m.setStyle({ color: hex, fillColor: hex })
    }

    // Apply active filter visibility
    if (this.activeFilter && !this.passesFilter(vessel, this.activeFilter)) {
      m.setStyle({ fillOpacity: 0, opacity: 0, weight: 0 })
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
