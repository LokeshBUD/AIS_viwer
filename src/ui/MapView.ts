import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EventBus, Events } from '../utils/EventBus'
import type { VesselState } from '../ais/types'
import { VesselMeshFactory } from '../scene/VesselMeshFactory'

// CartoDB Voyager — blue ocean, tan land, country/state borders, city labels, no streets
const CARTO_VOYAGER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

export class MapView {
  private map: L.Map | null = null
  private container: HTMLDivElement
  private markers = new Map<number, L.CircleMarker>()
  private renderer!: L.Canvas
  private _active = false
  /** Throttle buffer: only flush to Leaflet at 5fps when map is visible */
  private pending = new Map<number, VesselState>()
  private flushId: ReturnType<typeof setInterval> | null = null
  private unsubscribers: Array<() => void> = []

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'map-container'
    document.body.appendChild(this.container)
  }

  show(allVessels: ReadonlyMap<number, VesselState>): void {
    if (this._active) return
    this._active = true
    this.container.classList.add('map-visible')

    if (!this.map) {
      this.initMap(allVessels)
    } else {
      // Re-populate any vessels added while hidden
      for (const v of allVessels.values()) this.upsert(v)
    }
  }

  hide(): void {
    if (!this._active) return
    this._active = false
    this.container.classList.remove('map-visible')
  }

  toggle(allVessels: ReadonlyMap<number, VesselState>): boolean {
    if (this._active) { this.hide(); return false }
    this.show(allVessels); return true
  }

  get active(): boolean { return this._active }

  private initMap(allVessels: ReadonlyMap<number, VesselState>): void {
    this.renderer = L.canvas({ padding: 0.5 })

    this.map = L.map(this.container, {
      center: [20, 0],
      zoom: 3,
      minZoom: 2,            // can't zoom out past one world width
      maxZoom: 12,           // no street detail needed
      zoomControl: true,
      preferCanvas: true,
      worldCopyJump: true,   // seamless wrap: scrolling past 180° snaps back
    })

    L.tileLayer(CARTO_VOYAGER, {
      attribution: '&copy; <a href="https://carto.com">CartoDB</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 12,
      subdomains: 'abcd',
    }).addTo(this.map)

    // Populate snapshot vessels
    for (const v of allVessels.values()) this.upsert(v)

    // Subscribe to live updates (throttled)
    const unsubUpdate = EventBus.on<VesselState>(Events.VESSEL_UPDATED, v => {
      this.pending.set(v.mmsi, v)
    })
    const unsubLost = EventBus.on<number>(Events.VESSEL_LOST, mmsi => {
      this.pending.delete(mmsi)
      const m = this.markers.get(mmsi)
      if (m) { m.remove(); this.markers.delete(mmsi) }
    })
    const unsubSelected = EventBus.on<number>(Events.VESSEL_SELECTED, mmsi => {
      this.markers.get(mmsi)?.openPopup()
    })
    this.unsubscribers.push(unsubUpdate, unsubLost, unsubSelected)

    // Flush pending at 5 fps — only update markers in current viewport
    this.flushId = setInterval(() => {
      if (!this._active || !this.map || this.pending.size === 0) return
      const bounds = this.map.getBounds()
      for (const v of this.pending.values()) {
        if (bounds.contains([v.lat, v.lon])) this.upsert(v)
      }
      this.pending.clear()
    }, 200)
  }

  private upsert(vessel: VesselState): void {
    if (!this.map) return
    const ll: L.LatLngExpression = [vessel.lat, vessel.lon]
    const hex = '#' + VesselMeshFactory.getColor(vessel.vesselCategory).toString(16).padStart(6, '0')

    let m = this.markers.get(vessel.mmsi)
    if (!m) {
      m = L.circleMarker(ll, {
        radius: 4,
        color: hex,
        fillColor: hex,
        fillOpacity: 0.85,
        weight: 1.2,
        renderer: this.renderer,
      })
      m.bindPopup(() => this.popupHtml(vessel), { maxWidth: 220, className: 'ais-popup' })
      m.on('click', () => EventBus.emit(Events.VESSEL_SELECTED, vessel.mmsi))
      m.addTo(this.map!)
      this.markers.set(vessel.mmsi, m)
    } else {
      m.setLatLng(ll)
    }
    // Update stored state for popup refresh
    m.options.fillColor = hex
    m.options.color = hex
  }

  private popupHtml(v: VesselState): string {
    return `
      <div class="ais-popup-inner">
        <div class="ais-popup-name">${esc(v.name)}</div>
        <div class="ais-popup-sub">${v.vesselCategory.toUpperCase()} · MMSI ${v.mmsi}</div>
        <div class="ais-popup-grid">
          <span>SOG</span><span>${v.sog.toFixed(1)} kn</span>
          <span>COG</span><span>${v.cog.toFixed(0)}°</span>
          <span>STATUS</span><span>${v.navStatus}</span>
          <span>DRAUGHT</span><span>${v.draught > 0 ? (v.draught / 10).toFixed(1) + ' m' : 'N/A'}</span>
        </div>
        <div class="ais-popup-coord">${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}</div>
      </div>
    `
  }

  destroy(): void {
    if (this.flushId) clearInterval(this.flushId)
    this.unsubscribers.forEach(u => u())
    this.map?.remove()
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
