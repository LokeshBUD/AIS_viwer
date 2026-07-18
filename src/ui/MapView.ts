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
import { wrappedLon, unwrapLons } from '../utils/mapWrap'
import { VesselCanvasLayer } from './VesselCanvasLayer'

const TILE_VOYAGER  = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_SAT_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_SAT_LBLS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'

const MIN_ZOOM  = Math.max(2, Math.ceil(Math.log2(window.innerWidth / 256)))
const ICON_ZOOM = 8   // zoom ≥ this → SVG ship icons; below → cluster bubbles

// Native 'click' can still fire after a real drag when the gesture started on
// a marker/popup — those disable mousedown propagation to the map, so
// Leaflet's own drag engine never engages and never suppresses the resulting
// click. Tracking press/release distance ourselves (same pattern as
// VesselCanvasLayer's CLICK_TOLERANCE) makes background-click-to-deselect
// reliable regardless of where the gesture started.
const BACKGROUND_CLICK_TOLERANCE = 4

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
  // Bumped on every drawRoute() call — lets an in-flight route resolve as stale
  // if a newer selection superseded it before its async lookup finished.
  private routeToken = 0
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
  // Bulk canvas renderer for non-selected icon-mode vessels — see VesselCanvasLayer.
  private canvasLayer:  VesselCanvasLayer | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'map-container'
    document.body.appendChild(this.container)
  }

  start(allVessels: ReadonlyMap<number, VesselState>, onCoords?: (lat: number, lon: number) => void): void {
    // Canvas only recomputes its own internal paint bounds on 'moveend' (not
    // during an active drag), so ports/routes/trails — all canvas-rendered —
    // need generous padding to already cover a wrapped ±360° world-copy;
    // otherwise they simply can't paint there until the drag ends.
    this.renderer = L.canvas({ padding: 2 })

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

    this.canvasLayer = new VesselCanvasLayer(
      this.map,
      mmsi => EventBus.emit(Events.VESSEL_SELECTED, mmsi),
      () => { if (this.mode === 'icon') this.redrawCanvas() },
    )
    this.map.on('resize', () => this.canvasLayer?.resize())

    if (onCoords) {
      this.map.on('mousemove', (e: L.LeafletMouseEvent) => onCoords(e.latlng.lat, e.latlng.lng))
    }
    let lastPointerDownPos: { x: number; y: number } | null = null
    this.map.getContainer().addEventListener('pointerdown', (e: PointerEvent) => {
      lastPointerDownPos = { x: e.clientX, y: e.clientY }
    })
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const down = lastPointerDownPos
      const oe   = e.originalEvent
      if (down && Math.hypot(oe.clientX - down.x, oe.clientY - down.y) > BACKGROUND_CLICK_TOLERANCE) return
      if (this.selectedMmsi !== null) this.deselect()
    })
    this.map.on('zoomend', () => this.onZoomChange())
    // settled=true only once the gesture (drag/pinch/inertia) has actually
    // ended — canvas content stays correctly aligned throughout via Leaflet's
    // own pane CSS transform (translate *and* scale during zoom), so a full
    // vessel redraw mid-gesture is wasted work and was the main source of lag
    // on touch/trackpad two-finger pan+pinch and fast flick-inertia panning.
    const refreshViewport = (settled: boolean) => {
      // Cluster bubbles are pre-duplicated across world-copies (see
      // buildClusters) and don't depend on the viewport, so panning never
      // needs to rebuild them — only zoom (cell size changes) does.
      if (this.mode === 'icon') this.refreshIconViewport(settled)
      if (this.selectedMmsi !== null) {
        this.drawRoute(this.selectedMmsi)
        this.drawHistoryTrail(this.selectedMmsi)
      }
    }
    this.map.on('moveend', () => refreshViewport(true))
    // Also reposition the (single, selected-vessel) DOM marker continuously
    // (rAF-throttled) while dragging — otherwise it only appears once the
    // drag ends, which looks like a flash of empty space when panning
    // reveals a wrapped world-copy. The bulk canvas redraw is skipped here.
    let refreshQueued = false
    this.map.on('move', () => {
      if (refreshQueued) return
      refreshQueued = true
      requestAnimationFrame(() => { refreshQueued = false; refreshViewport(false) })
    })

    this.buildPortMarkers()

    // Populate state; markers created only for non-cluster modes
    for (const v of allVessels.values()) this.upsert(v)
    if (this.mode === 'cluster') this.buildClusters()
    else this.redrawCanvas()

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
      if (this.mode === 'icon') {
        this.redrawCanvas()
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
      this.refreshIconViewport(true)
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
    this.canvasLayer?.clear()
  }

  private switchToIconMode(): void {
    if (!this.map) return
    this.mode = 'icon'
    this.clearClusters()
    // Only the selected vessel needs a real DOM marker — everything else is
    // bulk-rendered by canvasLayer below.
    this.ensureSelectedMarker()
    this.redrawCanvas()
  }

  // ── Cluster mode ──────────────────────────────────────────────────────────────

  /**
   * Selected vessel always keeps its own real DOM marker — in cluster mode
   * so it stays visible outside a bubble, in icon mode so popup/pan mechanics
   * keep working while everything else is bulk-rendered by canvasLayer.
   */
  private ensureSelectedMarker(): void {
    if (this.selectedMmsi === null) return
    if (this.markers.has(this.selectedMmsi)) return
    const state = this.states.get(this.selectedMmsi)
    if (state) this.createIconMarker(state)
  }

  private buildClusters(): void {
    if (!this.map) return
    this.clearClusters()

    const zoom    = this.map.getZoom()
    const cellDeg = clusterCellDeg(zoom)

    interface Cell { count: number; lat: number; lon: number; colorCounts: Map<string, number> }
    const cells = new Map<string, Cell>()

    // Bin every vessel by its canonical position — no viewport/bounds check
    // at all. Bubbles are rendered at all world-copies below regardless of
    // pan, same as ports, so this never needs to react to panning.
    for (const v of this.states.values()) {
      // Selected vessel gets its own marker (see ensureSelectedMarker) — don't
      // also fold it into a cluster bubble.
      if (v.mmsi === this.selectedMmsi) continue
      const row = Math.floor(v.lat / cellDeg)
      const col = Math.floor(v.lon / cellDeg)
      const centerLat = (row + 0.5) * cellDeg
      const centerLon = (col + 0.5) * cellDeg

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

      // Pre-duplicate at ±360° so bubbles already exist in wrapped world-copies
      // before a drag reveals them — panning just slides them into view via
      // Leaflet's pane transform instead of creating/destroying them reactively.
      for (const lon of [cell.lon - 360, cell.lon, cell.lon + 360]) {
        const m = L.marker([cell.lat, lon] as L.LatLngExpression, { icon, interactive: true })
        m.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          this.map?.flyTo([cell.lat, lon], targetZoom, { duration: 0.5 })
        })
        m.addTo(this.map!)
        this.clusterMarkers.push(m)
      }
    }

    this.ensureSelectedMarker()
  }

  private clearClusters(): void {
    for (const m of this.clusterMarkers) m.remove()
    this.clusterMarkers = []
  }

  // ── Icon viewport refresh ─────────────────────────────────────────────────────

  // settled=false is used for continuous mid-gesture (drag/pinch) callbacks —
  // skips the bulk canvas redraw (content stays aligned via Leaflet's own
  // pane transform meanwhile) but still keeps the lone selected-vessel DOM
  // marker repositioned so it doesn't visibly lag behind.
  private refreshIconViewport(settled: boolean): void {
    if (!this.map) return
    // Pad so vessels just outside the visible area already render before a
    // drag reveals them — avoids a pop-in flash while panning.
    const bounds = this.map.getBounds().pad(0.5)
    // The only real DOM marker left in icon mode is the selected vessel (if
    // any) — reposition it into the currently-visible world-copy on pan.
    for (const [mmsi, m] of this.markers) {
      const v = this.states.get(mmsi)
      const lon = v ? wrappedLon(v.lon, bounds) : null
      if (!v || lon === null) {
        m.remove()
        this.markers.delete(mmsi)
      } else {
        // Only reposition if it actually changed. Calling setLatLng
        // unconditionally on every 'move' tick is harmless for a plain
        // marker, but this one may have an open popup — Leaflet's popup
        // auto-pan (_adjustPan → panBy) fires its own 'move' event on the
        // map, which re-enters this handler and calls setLatLng again,
        // recursing forever (stack overflow) once a vessel is selected and
        // the map is panned/dragged while its popup is open.
        const cur = m.getLatLng()
        if (cur.lat !== v.lat || cur.lng !== lon) {
          m.setLatLng([v.lat, lon])
        }
      }
    }
    if (settled) this.redrawCanvas()
  }

  // ── Marker creation ───────────────────────────────────────────────────────────

  private vesselColor(v: VesselState): string {
    return '#' + VesselMeshFactory.getColor(v.vesselCategory).toString(16).padStart(6, '0')
  }

  private redrawCanvas(): void {
    this.canvasLayer?.redraw(this.states.values(), this.visStates, v => this.vesselColor(v), this.selectedMmsi)
  }

  private createIconMarker(v: VesselState, lon: number = v.lon): void {
    if (!this.map) return
    const hex   = this.vesselColor(v)
    const state = this.visStates.get(v.mmsi) ?? 'normal'
    const m = L.marker([v.lat, lon] as L.LatLngExpression, {
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

    // Promote to a real DOM marker so popup/pan mechanics below work — mirrors
    // the same exemption cluster mode already gives the selected vessel.
    this.ensureSelectedMarker()
    if (this.mode === 'icon') {
      this.redrawCanvas()
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
    // In icon mode the selected vessel had a promoted DOM marker exempted
    // from canvas rendering — drop it, canvasLayer picks it back up.
    if (this.mode === 'icon' && prevMmsi !== null) {
      const m = this.markers.get(prevMmsi)
      if (m) { m.remove(); this.markers.delete(prevMmsi) }
      this.redrawCanvas()
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
    if (this.mode === 'icon') this.redrawCanvas()
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
      // Same 3-way rule applyFilter() uses — keeps the selected vessel's own
      // highlight correct instead of leaving it stuck on whatever a prior
      // search call last set it to.
      for (const mmsi of this.visStates.keys()) {
        this.setMarkerState(mmsi, mmsi === this.selectedMmsi ? 'selected' : this.selectedMmsi !== null ? 'dimmed' : 'normal')
      }
      if (this.mode === 'icon') this.redrawCanvas()
      return
    }

    const q = query.toLowerCase()
    const matches: number[] = []

    for (const [mmsi, state] of this.states) {
      const nameHit = state.name.toLowerCase().includes(q)
      const mmsiHit = mmsi.toString().includes(q)
      const isMatch = nameHit || mmsiHit
      if (isMatch) matches.push(mmsi)
      // Selected vessel always keeps its own highlight, regardless of
      // whether it matches the query — search shouldn't be able to dim it.
      if (mmsi === this.selectedMmsi) {
        this.setMarkerState(mmsi, 'selected')
      } else {
        this.setMarkerState(mmsi, isMatch ? 'normal' : 'dimmed')
      }
    }

    if (this.mode === 'icon') this.redrawCanvas()
    if (matches.length === 1) this.selectVessel(matches[0])
  }

  // ── Route line ────────────────────────────────────────────────────────────────

  private async drawRoute(mmsi: number): Promise<void> {
    const token = ++this.routeToken
    const state = this.states.get(mmsi)
    if (!state) { this.clearRoute(); return }
    const port = lookupPort(state.destination)
    if (!port) { this.clearRoute(); return }
    const col = '#' + destColor(state.destination).toString(16).padStart(6, '0')
    const waypoints = await maritimeRoute(state.lat, state.lon, port.lat, port.lon)
    // A newer selection superseded this call while the route lookup was in
    // flight — don't draw a stale route over whatever's now selected.
    if (token !== this.routeToken) return
    this.clearRoute()
    // Unwrap the route itself first (a route crossing the antimeridian must not
    // cut across the whole globe), then anchor point 0 (the vessel's own
    // position) to wherever its marker is currently rendered, so the line
    // starts exactly at the marker regardless of which world-copy is in view.
    const unwrapped = unwrapLons(waypoints.map(w => w.lon))
    const anchor = wrappedLon(state.lon, this.map!.getBounds()) ?? state.lon
    const shift = anchor - unwrapped[0]
    this.routeLine = L.polyline(
      waypoints.map((w, i) => [w.lat, unwrapped[i] + shift] as L.LatLngExpression),
      { color: col, weight: 2.5, opacity: 0.8, dashArray: '8 6', interactive: false, renderer: this.renderer },
    ).addTo(this.map!)
  }

  private clearRoute(): void { this.routeLine?.remove(); this.routeLine = null }

  // ── History trail ─────────────────────────────────────────────────────────────

  private drawHistoryTrail(mmsi: number): void {
    this.clearHistoryTrail()
    const state = this.states.get(mmsi)
    if (!state || state.history.length < 2) return

    // Always close the gap to the vessel's live position — a history snapshot
    // can lag behind the marker by one AIS report if the vessel is mid-move
    // when the trail redraws.
    const lastHist = state.history[state.history.length - 1]
    const needsLivePoint = !lastHist || lastHist.lat !== state.lat || lastHist.lon !== state.lon
    const lats    = state.history.map(h => h.lat).concat(needsLivePoint ? [state.lat] : [])
    const rawLons = state.history.map(h => h.lon).concat(needsLivePoint ? [state.lon] : [])
    // Unwrap the trail itself first (a real track crossing the antimeridian must
    // not cut across the whole globe), then anchor the last point (the vessel's
    // live position) to wherever its marker is currently rendered, so the trail
    // ends exactly at the marker regardless of which world-copy is in view.
    const unwrapped = unwrapLons(rawLons)
    const anchor = wrappedLon(state.lon, this.map!.getBounds()) ?? state.lon
    const shift = anchor - unwrapped[unwrapped.length - 1]
    const pts: [number, number][] = lats.map((lat, i) => [lat, unwrapped[i] + shift])
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

    // Only the selected vessel gets a live-updating DOM marker — everyone
    // else is bulk-rendered by canvasLayer (icon mode) or cluster bubbles.
    if (vessel.mmsi !== this.selectedMmsi) return

    const hex = this.vesselColor(vessel)
    const m   = this.markers.get(vessel.mmsi)

    if (!m) {
      // Icon mode: only create marker if vessel is in viewport.
      // Cluster mode: always create it — it's the exempted selected vessel.
      const bounds = this.map.getBounds()
      const lon = wrappedLon(vessel.lon, bounds)
      if (this.mode === 'cluster' || lon !== null) {
        this.createIconMarker(vessel, lon ?? vessel.lon)
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
      // DOM marker, not a canvas/SVG Path — Leaflet's Path renderers only
      // repaint their own tracked bounds on 'moveend' (checked leaflet-src.js),
      // and that tracked area shrinks in degrees as you zoom in, so a canvas
      // circleMarker duplicated at ±360° would stop painting there once
      // zoomed past a certain level. A plain L.marker has no such bounds —
      // it's always rendered, panning is free via the pane's CSS transform,
      // same mechanism already used for cluster bubbles.
      const icon = L.divIcon({
        html:       `<div class="port-dot" style="background:${hex}"></div>`,
        className:  '',
        iconSize:   [10, 10],
        iconAnchor: [5, 5],
      })
      // Pre-duplicate at ±360° so ports render in wrapped world-copies too —
      // ports are static/few, cheaper than recomputing on every moveend.
      for (const lon of [port.lon - 360, port.lon, port.lon + 360]) {
        const m = L.marker([port.lat, lon] as L.LatLngExpression, { icon, interactive: true })
        m.bindTooltip(
          `<b>${port.name}</b><br><span style="color:${hex};font-size:9px;letter-spacing:1px">${port.code}</span>`,
          { direction: 'right', className: 'port-tooltip', offset: [6, 0] },
        )
        m.addTo(this.map)
      }
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
    this.canvasLayer?.destroy()
    this.map?.remove()
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
