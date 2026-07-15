import * as THREE from 'three'
import type { VesselState } from '../ais/types'
import { VesselMeshFactory } from './VesselMeshFactory'
import { RouteArc } from './RouteArc'
import { latLonToVec3, sphereSurfaceQuaternion } from '../utils/CoordMapper'
import { GLOBE_RADIUS, VESSEL_GLOBE_OFFSET } from '../utils/constants'
import { destColor } from '../utils/destColor'
import { lookupPort } from '../utils/ports'
import { maritimeRoute } from '../utils/maritimeRoute'

// Reused scratch objects (avoids per-frame allocation)
const _wp     = new THREE.Vector3()
const _fwd    = new THREE.Vector3()
const _ndcA   = new THREE.Vector3()
const _ndcB   = new THREE.Vector3()

export class VesselMesh {
  readonly mmsi: number
  readonly group: THREE.Group

  private sprite: THREE.Sprite
  private trail:  THREE.Line
  private arc:    RouteArc

  private targetPos  = new THREE.Vector3()
  private targetQuat = new THREE.Quaternion()
  private _highlighted = false
  private _faded       = false
  private _currentDest = ''
  private _lastArcTime = 0

  // Real sea-route search is heavier than the old sparse-graph router, and
  // applyState() fires on every AIS position tick for every vessel — throttle
  // recompute so we're not re-running pathfinding for ~3000 vessels per tick.
  private static readonly ARC_RECOMPUTE_MS = 30_000

  constructor(state: VesselState) {
    this.mmsi  = state.mmsi
    this.group = new THREE.Group()
    this.group.userData['mmsi'] = state.mmsi

    // ── Billboard ship-icon sprite ────────────────────────────────────────────
    this.sprite = VesselMeshFactory.createSprite(
      state.vesselCategory,
      destColor(state.destination),
    )
    this.group.add(this.sprite)

    // ── Trail line ────────────────────────────────────────────────────────────
    const trailGeo = new THREE.BufferGeometry()
    const trailMat = new THREE.LineBasicMaterial({
      color:       destColor(state.destination),
      opacity:     0.45,
      transparent: true,
    })
    this.trail = new THREE.Line(trailGeo, trailMat)
    this.group.add(this.trail)

    // ── Route arc (world-space — added to scene by LODManager) ───────────────
    this.arc = new RouteArc()

    // Initial placement
    this.applyState(state)
    this.group.position.copy(this.targetPos)
    this.group.quaternion.copy(this.targetQuat)
  }

  applyState(state: VesselState): void {
    this.targetPos.copy(
      latLonToVec3(state.lat, state.lon, GLOBE_RADIUS, VESSEL_GLOBE_OFFSET),
    )

    // Surface orientation (local Y = radial outward, local -Z = north)
    const baseQ    = sphereSurfaceQuaternion(state.lat, state.lon)
    const heading  = state.trueHeading !== 511 ? state.trueHeading : state.cog
    const headingQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -THREE.MathUtils.degToRad(heading),
    )
    this.targetQuat.copy(baseQ).multiply(headingQ)

    // Update color when destination changes
    const destChanged = state.destination !== this._currentDest
    if (destChanged) {
      this._currentDest = state.destination
      const col = destColor(state.destination)
      // Swap the sprite texture (factory caches textures by color hex)
      const mat = this.sprite.material as THREE.SpriteMaterial
      mat.map = VesselMeshFactory.getTexture(col)
      mat.needsUpdate = true
      ;(this.trail.material as THREE.LineBasicMaterial).color.setHex(col)
    }

    this.updateTrail(state)
    this.updateArc(state, destChanged)
  }

  /**
   * Called each frame. Updates position/orientation lerp AND computes
   * screen-space heading angle so the sprite rotates to match vessel heading.
   * Hides vessels on the back hemisphere (dot product culling).
   */
  tick(dt: number, camera: THREE.PerspectiveCamera): void {
    this.group.position.lerp(this.targetPos, Math.min(1, dt * 2))
    this.group.quaternion.slerp(this.targetQuat, Math.min(1, dt * 3))

    // ── Hemisphere culling — hide vessels behind the globe ───────────────────
    const vesselDir = this.group.position.clone().normalize()
    const cameraDir = camera.position.clone().normalize()
    const onFront   = vesselDir.dot(cameraDir) > -0.05
    this.group.visible   = !this._faded && onFront
    this.arc.line.visible = this.arc.line.visible && !this._faded && onFront

    if (!onFront) return   // skip heading calc for hidden vessels

    // ── Project heading to screen space ──────────────────────────────────────
    _wp.copy(this.group.position)
    _fwd.set(0, 0, -1).applyQuaternion(this.group.quaternion).multiplyScalar(4)

    _ndcA.copy(_wp).project(camera)
    _ndcB.copy(_wp).add(_fwd).project(camera)

    const dx = _ndcB.x - _ndcA.x
    const dy = _ndcB.y - _ndcA.y
    ;(this.sprite.material as THREE.SpriteMaterial).rotation = Math.atan2(dx, dy)
  }

  setHighlight(on: boolean): void {
    if (this._highlighted === on) return
    this._highlighted = on
    const mat = this.sprite.material as THREE.SpriteMaterial
    mat.opacity = on ? 1.0 : 0.92
  }

  /** Fade (dim) this vessel when another is selected. Completely hides others. */
  setFaded(faded: boolean): void {
    this._faded = faded
    // Visibility will be corrected on next tick() via hemisphere culling.
    // Force-hide immediately so isolation takes effect this frame.
    if (faded) {
      this.group.visible    = false
      this.arc.line.visible = false
    }
  }

  setLOD(camDist: number): void {
    this.trail.visible = camDist < 130
    // sizeAttenuation=false means sprite is already constant screen size — no scaling needed
    if (this.arc.line.visible && camDist < 8) this.arc.hide()
  }

  get arcLine(): THREE.Line { return this.arc.line }

  /** Returns objects for raycasting (sprites are intersectable) */
  getPickTargets(): THREE.Object3D[] { return [this.sprite] }

  /** @deprecated use getPickTargets */
  getMeshes(): THREE.Mesh[] { return [] }

  dispose(): void {
    this.arc.dispose()
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
      if (obj instanceof THREE.Sprite) {
        ;(obj.material as THREE.SpriteMaterial).map?.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
  }

  private updateTrail(state: VesselState): void {
    const pts = state.history.slice(-80).map(h =>
      latLonToVec3(h.lat, h.lon, GLOBE_RADIUS, 0.15),
    )
    if (pts.length < 2) return
    this.trail.geometry.setFromPoints(pts)
  }

  private updateArc(state: VesselState, destChanged: boolean): void {
    const port = lookupPort(state.destination)
    if (!port) { this.arc.hide(); return }

    const now = Date.now()
    if (!destChanged && this._lastArcTime !== 0 && now - this._lastArcTime < VesselMesh.ARC_RECOMPUTE_MS) return
    this._lastArcTime = now

    const waypoints = maritimeRoute(state.lat, state.lon, port.lat, port.lon)
    this.arc.update(waypoints, destColor(state.destination))
  }
}
