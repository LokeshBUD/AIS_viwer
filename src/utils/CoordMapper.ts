import * as THREE from 'three'
import { WORLD_SCALE, GLOBE_RADIUS } from './constants'

interface BBox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

const DEFAULT_BBOX: BBox = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }

/** Flat-world mapper (kept for reference / regional views) */
export class CoordMapper {
  private centerLat: number
  private centerLon: number
  private kmPerDegLat: number
  private kmPerDegLon: number

  constructor(bbox: BBox = DEFAULT_BBOX) {
    this.centerLat = (bbox.minLat + bbox.maxLat) / 2
    this.centerLon = (bbox.minLon + bbox.maxLon) / 2
    this.kmPerDegLat = 111.32
    this.kmPerDegLon = 111.32 * Math.cos((this.centerLat * Math.PI) / 180)
  }

  toWorld(lat: number, lon: number): { x: number; z: number } {
    const x = (lon - this.centerLon) * this.kmPerDegLon * WORLD_SCALE
    const z = -(lat - this.centerLat) * this.kmPerDegLat * WORLD_SCALE
    return { x, z }
  }

  toLatLon(x: number, z: number): { lat: number; lon: number } {
    const lat = this.centerLat + (-z / WORLD_SCALE) / this.kmPerDegLat
    const lon = this.centerLon + (x / WORLD_SCALE) / this.kmPerDegLon
    return { lat, lon }
  }
}

// ─── Globe / Sphere utilities ────────────────────────────────────────────────

/**
 * Convert lat/lon to a 3D position on a sphere.
 *
 * Convention chosen to align with Three.js SphereGeometry default UV mapping
 * (uses lonR = (lon + 90) * PI/180 so textures line up without manual rotation):
 *   lon=0   (prime meridian) → +X axis
 *   lon=90  (east)           → -Z axis
 *   lon=180 (antimeridian)   → -X axis
 *   lat=90  (north pole)     → +Y axis
 */
export function latLonToVec3(lat: number, lon: number, radius = GLOBE_RADIUS, surfaceOffset = 0): THREE.Vector3 {
  const latR = THREE.MathUtils.degToRad(lat)
  const lonR = THREE.MathUtils.degToRad(lon + 90)   // +90 for texture alignment
  const r = radius + surfaceOffset
  return new THREE.Vector3(
    r * Math.cos(latR) * Math.sin(lonR),
    r * Math.sin(latR),
    r * Math.cos(latR) * Math.cos(lonR),
  )
}

/**
 * Inverse: ray-sphere intersection → lat/lon (approximate, assumes Y=up, sphere at origin).
 */
export function vec3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const lat = THREE.MathUtils.radToDeg(Math.asin(v.y / v.length()))
  // Invert lonR = (lon+90)*PI/180 → lon = lonR*180/PI - 90
  const lonR = Math.atan2(v.x, v.z)
  const lon = THREE.MathUtils.radToDeg(lonR) - 90
  return { lat, lon: ((lon + 540) % 360) - 180 }  // normalise to [-180,180]
}

/**
 * Returns the base quaternion that aligns a Three.js object placed at lat/lon on
 * the sphere so that:
 *   local Y  = radially outward (away from sphere centre)
 *   local -Z = geographic north at that point (heading = 0)
 *   local +X = geographic east
 *
 * Apply a subsequent rotateY(-headingRad) to the object to point it in the right direction.
 */
export function sphereSurfaceQuaternion(lat: number, lon: number): THREE.Quaternion {
  const latR = THREE.MathUtils.degToRad(lat)
  const lonR = THREE.MathUtils.degToRad(lon + 90)

  // Radial (local Y — outward from sphere)
  const radial = new THREE.Vector3(
    Math.cos(latR) * Math.sin(lonR),
    Math.sin(latR),
    Math.cos(latR) * Math.cos(lonR),
  ).normalize()

  // North tangent: d(position)/d(lat), normalised
  const north = new THREE.Vector3(
    -Math.sin(latR) * Math.sin(lonR),
     Math.cos(latR),
    -Math.sin(latR) * Math.cos(lonR),
  ).normalize()

  // East tangent: d(position)/d(lon), normalised
  const east = new THREE.Vector3(
    Math.cos(lonR),
    0,
    -Math.sin(lonR),
  ).normalize()

  // Build orthonormal basis: X=east, Y=radial, Z=-north (vessel forward=-Z = north at heading 0)
  const m = new THREE.Matrix4().makeBasis(east, radial, north.clone().negate())
  return new THREE.Quaternion().setFromRotationMatrix(m)
}
