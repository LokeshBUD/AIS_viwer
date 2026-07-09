import * as THREE from 'three'
import { latLonToVec3 } from '../utils/CoordMapper'
import { GLOBE_RADIUS } from '../utils/constants'
import type { NavPoint } from '../utils/maritimeRoute'

const SEGS_PER_LEG = 24   // great-circle segments per waypoint leg
const ARC_HEIGHT   = 0.5  // units above sphere surface

export class RouteArc {
  readonly line: THREE.Line

  constructor() {
    const geo = new THREE.BufferGeometry()
    const mat = new THREE.LineBasicMaterial({
      color:       0xffffff,
      opacity:     0.50,
      transparent: true,
      depthWrite:  false,
      linewidth:   1,
    })
    this.line = new THREE.Line(geo, mat)
    this.line.visible  = false
    this.line.renderOrder = 1
  }

  /**
   * Draw the maritime route through an ordered list of NavPoints.
   * Each leg between consecutive points is interpolated as a great-circle arc
   * so the path hugs the sphere surface.
   */
  update(waypoints: NavPoint[], color: number): void {
    if (waypoints.length < 2) { this.hide(); return }

    const pts: THREE.Vector3[] = []
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]
      const b = waypoints[i + 1]
      const leg = greatCircleLeg(a.lat, a.lon, b.lat, b.lon, SEGS_PER_LEG)
      // Avoid duplicating the shared point between legs
      if (i > 0) leg.shift()
      pts.push(...leg)
    }

    this.line.geometry.setFromPoints(pts)
    ;(this.line.material as THREE.LineBasicMaterial).color.setHex(color)
    this.line.visible = true
  }

  hide(): void {
    this.line.visible = false
  }

  dispose(): void {
    this.line.geometry.dispose()
    ;(this.line.material as THREE.Material).dispose()
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function greatCircleLeg(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  segments: number,
): THREE.Vector3[] {
  const r  = GLOBE_RADIUS + ARC_HEIGHT
  const a  = latLonToVec3(lat1, lon1, 1)   // unit sphere
  const b  = latLonToVec3(lat2, lon2, 1)

  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // slerp-approx: lerp then normalise, then scale to r
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).normalize().multiplyScalar(r))
  }
  return pts
}
