import L from 'leaflet'
import type { VesselState } from '../ais/types'
import { SHAPES, CX, CY } from './VesselIcon'
import { wrappedLon } from '../utils/mapWrap'

type VisState = 'normal' | 'selected' | 'dimmed' | 'hidden'

interface HitEntry { mmsi: number; x: number; y: number }

const HIT_RADIUS = 9
const VIEWPORT_PAD = 0.5
// Matches Leaflet's own Draggable clickTolerance — a gesture with this much
// movement between press and release still counts as a click, not a drag.
const CLICK_TOLERANCE = 4

// Precompute one Path2D per category — reuses the exact SVG path strings
// already used for the DOM divIcon, so canvas ships look identical.
const SHAPE_PATHS = Object.fromEntries(
  Object.entries(SHAPES).map(([cat, d]) => [cat, new Path2D(d)]),
) as Record<keyof typeof SHAPES, Path2D>

/**
 * Bulk canvas renderer for icon-mode vessels. Lives in the map's overlayPane
 * so panning moves it for free via Leaflet's own pane CSS transform — only
 * moveend/zoomend and the periodic vessel-update flush need a real redraw.
 * The selected vessel is never drawn here; it gets a real Leaflet DOM marker
 * (see MapView's ensureSelectedMarker) so popup/pan mechanics keep working.
 */
export class VesselCanvasLayer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private hitCache: HitEntry[] = []
  // Layer-point coords of the canvas's own top-left, set on each reposition().
  // Drawing uses latLngToLayerPoint (pane space, matches how the canvas
  // element itself is positioned) minus this origin, so the pane's own CSS
  // pan/zoom transform keeps already-drawn content correctly aligned with
  // the rest of the map without needing a redraw mid-drag.
  private origin = L.point(0, 0)
  private downPos: { x: number; y: number } | null = null
  // Set when a pointerup already resolved to a ship hit — the browser still
  // fires a native 'click' afterward for a real click gesture, which must be
  // swallowed so it doesn't also bubble to the map's own background-click
  // deselect handler and immediately undo the selection just made.
  private lastPointerWasHit = false

  constructor(
    private map: L.Map,
    private onVesselClick: (mmsi: number) => void,
    // Called synchronously right before hit-testing a click, so the hitCache
    // is always built from the current map state at that exact instant —
    // not whatever was last drawn by a moveend/zoomend/flush-tick redraw,
    // which could be stale if the click lands mid- or just-after a gesture.
    private requestRedraw: () => void,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.pointerEvents = 'auto'
    this.ctx = this.canvas.getContext('2d')!
    map.getPanes().overlayPane.appendChild(this.canvas)
    // Don't rely on the native 'click' event alone — on trackpads especially,
    // a pan gesture that ends in a tap can have enough incidental movement
    // that the browser synthesizes it as a drag instead of a click, so
    // 'click' never fires at all. Tracking pointerdown/pointerup ourselves
    // (like Leaflet's own Draggable clickTolerance) makes hit-testing
    // reliable regardless of how the browser classifies the gesture.
    this.canvas.addEventListener('pointerdown', this.handlePointerDown)
    this.canvas.addEventListener('pointerup', this.handlePointerUp)
    this.canvas.addEventListener('click', this.handleNativeClick)
    this.resize()
  }

  /** Canvas backing-store size + DPI — only needs to run when the viewport size changes. */
  resize(): void {
    const size = this.map.getSize()
    const dpr  = window.devicePixelRatio || 1
    this.canvas.style.width  = `${size.x}px`
    this.canvas.style.height = `${size.y}px`
    this.canvas.width  = size.x * dpr
    this.canvas.height = size.y * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.syncOrigin()
  }

  // Cheap CSS-transform update — safe to call on every redraw() so the
  // canvas's coordinate origin never goes stale mid-zoom (e.g. during a
  // continuous pinch gesture, where the zoom level changes between snaps and
  // a cached origin from the last viewreset would put ships in the wrong
  // spot both visually and for click hit-testing).
  private syncOrigin(): void {
    this.origin = this.map.containerPointToLayerPoint([0, 0])
    L.DomUtil.setPosition(this.canvas, this.origin)
  }

  redraw(
    vessels: Iterable<VesselState>,
    visStates: Map<number, VisState>,
    colorOf: (v: VesselState) => string,
    selectedMmsi: number | null,
  ): void {
    this.syncOrigin()
    const size = this.map.getSize()
    this.ctx.clearRect(0, 0, size.x, size.y)
    this.hitCache = []

    const bounds = this.map.getBounds().pad(VIEWPORT_PAD)
    const dimmed: VesselState[] = []
    const normal: VesselState[] = []

    for (const v of vessels) {
      if (v.mmsi === selectedMmsi) continue
      const vis = visStates.get(v.mmsi) ?? 'normal'
      if (vis === 'hidden') continue
      const lon = wrappedLon(v.lon, bounds)
      if (lon === null) continue
      ;(vis === 'dimmed' ? dimmed : normal).push(v)
    }

    // Dimmed first so a normal vessel never gets visually buried under one.
    for (const v of dimmed) this.drawVessel(v, colorOf(v), bounds, 0.18, 0.85)
    for (const v of normal) this.drawVessel(v, colorOf(v), bounds, 0.85, 1)
  }

  private drawVessel(v: VesselState, color: string, bounds: L.LatLngBounds, alpha: number, scale: number): void {
    const lon = wrappedLon(v.lon, bounds)
    if (lon === null) return
    const layerPt = this.map.latLngToLayerPoint([v.lat, lon])
    const x = layerPt.x - this.origin.x
    const y = layerPt.y - this.origin.y
    const shape = SHAPE_PATHS[v.vesselCategory] ?? SHAPE_PATHS.unknown
    const cogDeg = isFinite(v.cog) ? v.cog : 0

    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    ctx.rotate((cogDeg * Math.PI) / 180)
    ctx.translate(-CX, -CY)
    ctx.fillStyle = color
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 0.6
    ctx.lineJoin = 'round'
    ctx.fill(shape)
    ctx.stroke(shape)
    ctx.restore()

    this.hitCache.push({ mmsi: v.mmsi, x, y })
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY }
  }

  private handlePointerUp = (e: PointerEvent): void => {
    const down = this.downPos
    this.downPos = null
    this.lastPointerWasHit = false
    if (!down) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE) return // was a drag

    this.requestRedraw()
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    let best: HitEntry | null = null
    let bestDist = HIT_RADIUS
    for (const hit of this.hitCache) {
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d < bestDist) { bestDist = d; best = hit }
    }

    if (best) {
      this.lastPointerWasHit = true
      e.stopPropagation()
      this.onVesselClick(best.mmsi)
    }
    // No hit: don't stopPropagation — let the browser's subsequent native
    // 'click' bubble to the map's own click handler so clicking empty water
    // still deselects.
  }

  // The browser still fires a native 'click' after pointerup for a real
  // click gesture — swallow it when pointerup already handled a hit so it
  // doesn't also bubble to the map's background-click deselect handler.
  private handleNativeClick = (e: MouseEvent): void => {
    if (this.lastPointerWasHit) {
      e.stopPropagation()
      this.lastPointerWasHit = false
    }
  }

  /** Wipe drawn content — used when leaving icon mode so stale icons don't linger. */
  clear(): void {
    const size = this.map.getSize()
    this.ctx.clearRect(0, 0, size.x, size.y)
    this.hitCache = []
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('click', this.handleNativeClick)
    this.canvas.remove()
  }
}
